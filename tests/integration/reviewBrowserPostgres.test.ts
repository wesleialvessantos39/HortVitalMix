import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  users: new Map<string, { id: string; email: string }>(),
  pool: null as Pool | null,
}));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T24_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("T24_LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
import vercel from "../../vercel.json" with { type: "json" };
import { app } from "../../server/app.ts";
import { dbPool } from "../../server/db/pool.ts";
import { reviewFixtures } from "../helpers/reviewFixtures.ts";
import { checkoutAudit } from "../helpers/checkoutFixtures.ts";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
describe.runIf(!!process.env.HVM_T24_LOCAL_DATABASE_URL)(
  "T24 história real: pedido entregue → avaliação → reputação → moderação",
  () => {
    let server: Server,
      baseURL: string,
      f: Awaited<ReturnType<typeof reviewFixtures>>,
      order: Awaited<
        ReturnType<Awaited<ReturnType<typeof reviewFixtures>>["paid"]>
      >,
      admin: AdminActorContext;
    const pool = () => dbPool as Pool,
      tokens = new Map<string, string>(),
      sessions = new Map<string, string>();
    async function session(userId: string) {
      const id = randomUUID();
      await pool().query(
        "INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",
        [id, userId],
      );
      const token =
        "local." +
        Buffer.from(JSON.stringify({ session_id: id })).toString("base64url") +
        ".local";
      tokens.set(userId, token);
      sessions.set(userId, id);
      auth.users.set(token, { id: userId, email: userId + "@example.test" });
    }
    beforeAll(async () => {
      if (!existsSync("dist/index.html"))
        throw Error("BUILD_REQUIRED_FOR_T24_STORY");
      auth.pool = pool();
      f = await reviewFixtures(pool());
      order = await f.paid();
      admin = await f.admin();
      for (const id of [order.b.userId, admin.userId]) await session(id);
      const outer = express(),
        csp = vercel.headers
          .find((x) => x.source === "/(.*)")!
          .headers.find((x) => x.key === "Content-Security-Policy")!.value;
      outer.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", csp);
        next();
      });
      outer.use(["/api", "/_hvm_api"], app);
      outer.use(express.static(resolve("dist")));
      outer.get("*", (_req, res) => res.sendFile(resolve("dist/index.html")));
      server = await new Promise<Server>((done) => {
        const s = outer.listen(0, "127.0.0.1", () => done(s));
      });
      baseURL = "http://127.0.0.1:" + (server.address() as any).port;
    }, 20000);
    afterAll(async () => {
      try {
        if (server)
          await new Promise<void>((done) => server.close(() => done()));
        if (f) await f.cleanup();
      } finally {
        await dbPool?.end();
      }
    }, 20000);
    it("UI/HTTP/Postgres completos, motivo obrigatório, sessão recente, histórico preservado e quatro larguras", async () => {
      const { chromium, expect: check } = await import("@playwright/test"),
        portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        args: ["--disable-gpu", "--no-zygote"],
      });
      const errors: string[] = [];
      async function context(id?: string, role?: string) {
        const c = await browser.newContext({
          viewport: { width: 390, height: 950 },
        });
        if (id)
          await c.addCookies([
            {
              name: "hvm_access",
              value: tokens.get(id)!,
              url: baseURL,
              httpOnly: true,
            },
            { name: "hvm_portal_role", value: role!, url: baseURL },
          ]);
        const p = await c.newPage();
        p.on("pageerror", (e) => errors.push(e.message));
        return { c, p };
      }
      const consumer = await context(order.b.userId, "consumer"),
        moderator = await context(admin.userId, "platform_super_admin"),
        guest = await context();
      const directory = "/workspace/scratch/t24-story";
      mkdirSync(directory, { recursive: true });
      try {
        await consumer.p.goto(baseURL + "/pedidos/" + order.id);
        await check(
          consumer.p.getByRole("heading", { name: "Da horta até você" }),
        ).toBeVisible();
        await check(
          consumer.p.getByRole("button", {
            name: "Avaliar compra",
            exact: true,
          }),
        ).toHaveCount(0);
        const before = await consumer.p.evaluate(
          async ({ id, key }) => {
            const r = await fetch("/api/v1/reviews", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Command-Id": key,
              },
              body: JSON.stringify({ orderId: id, rating: 5 }),
            });
            return { status: r.status, body: await r.json() };
          },
          { id: order.id, key: randomUUID() },
        );
        expect(before).toMatchObject({
          status: 422,
          body: { error: "REVIEW_NOT_DELIVERED" },
        });
        await f.advance(order);
        await consumer.p.reload();
        await consumer.p
          .getByRole("button", { name: "Avaliar compra", exact: true })
          .click();
        const dialog = consumer.p.getByRole("dialog", {
          name: "Avaliar sua compra",
        });
        await check(dialog).toBeVisible();
        await check(
          dialog.getByRole("button", { name: "Publicar avaliação" }),
        ).toBeDisabled();
        for (const width of [320, 390, 768, 1440]) {
          await consumer.p.setViewportSize({ width, height: 950 });
          expect(
            await consumer.p.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
          ).toBe(false);
          const box = await dialog.boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
          if (width === 320 || width === 1440)
            await consumer.p.screenshot({
              path: directory + `/modal-${width}.png`,
              fullPage: true,
            });
        }
        await consumer.p.keyboard.press("Escape");
        await check(dialog).toHaveCount(0);
        await check(
          consumer.p.getByRole("button", {
            name: "Avaliar compra",
            exact: true,
          }),
        ).toBeFocused();
        await consumer.p
          .getByRole("button", { name: "Avaliar compra", exact: true })
          .click();
        await consumer.p
          .getByRole("radio", { name: "5 estrelas", exact: true })
          .check();
        const comment =
          "Colheita excelente. <script>window.t24Injected=true</script>";
        await consumer.p.getByLabel("Comentário opcional").fill(comment);
        const response = consumer.p.waitForResponse(
          (r) =>
            r.url().endsWith("/v1/reviews") && r.request().method() === "POST",
        );
        await consumer.p
          .getByRole("button", { name: "Publicar avaliação", exact: true })
          .click();
        expect((await response).status()).toBe(200);
        await check(
          consumer.p.getByText(
            "Obrigado! Sua avaliação de compra verificada foi registrada.",
          ),
        ).toBeVisible();
        await check(
          consumer.p.getByRole("button", {
            name: "Avaliar compra",
            exact: true,
          }),
        ).toHaveCount(0);
        const r = (
          await pool().query("SELECT * FROM app_reviews WHERE order_id=$1", [
            order.id,
          ])
        ).rows[0];
        expect(r).toMatchObject({ rating: 5, comment, is_moderated: false });
        expect(
          (
            await pool().query(
              "SELECT average_rating::float,total_reviews FROM app_reputation_projections WHERE store_id=$1",
              [f.catalog.a.store.id],
            )
          ).rows[0],
        ).toEqual({ average_rating: 5, total_reviews: 1 });
        await guest.p.goto(
          baseURL + "/produtores/" + f.catalog.a.store.storeSlug,
        );
        const block = guest.p.getByRole("region", {
          name: "Avaliações verificadas da loja",
        });
        await check(
          block.getByText("1 avaliação verificada", { exact: true }),
        ).toBeVisible();
        await check(block.getByText(comment, { exact: true })).toBeVisible();
        expect(
          await guest.p.evaluate(() => (window as any).t24Injected),
        ).toBeUndefined();
        await moderator.p.goto(baseURL + "/admin/avaliacoes");
        await check(
          moderator.p.getByRole("heading", { name: "Moderação de avaliações" }),
        ).toBeVisible();
        await moderator.p
          .getByRole("button", { name: /Moderar avaliação do pedido/ })
          .click();
        await moderator.p
          .getByRole("button", { name: "Confirmar moderação", exact: true })
          .click();
        expect(
          (
            await pool().query(
              "SELECT is_moderated FROM app_reviews WHERE id=$1",
              [r.id],
            )
          ).rows[0].is_moderated,
        ).toBe(false);
        for (const width of [320, 390, 768, 1440]) {
          for (const p of [guest.p, moderator.p]) {
            await p.setViewportSize({ width, height: 950 });
            expect(
              await p.evaluate(
                () => document.documentElement.scrollWidth > innerWidth + 1,
              ),
            ).toBe(false);
          }
          if (width === 320 || width === 1440) {
            await moderator.p.screenshot({
              path: directory + `/admin-${width}.png`,
              fullPage: true,
            });
            await guest.p.screenshot({
              path: directory + `/store-${width}.png`,
              fullPage: true,
            });
          }
        }
        await pool().query(
          "UPDATE auth.sessions SET created_at=now()-interval '16 minutes' WHERE id=$1",
          [sessions.get(admin.userId)],
        );
        const stale = await moderator.p.evaluate(
          async ({ id, key }) => {
            const response = await fetch(
              `/api/v1/admin/reviews/${id}/moderate`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Command-Id": key,
                },
                body: JSON.stringify({
                  reason: "Motivo administrativo de teste.",
                }),
              },
            );
            return { status: response.status, body: await response.json() };
          },
          { id: r.id, key: randomUUID() },
        );
        expect(stale).toMatchObject({
          status: 401,
          body: { error: "ADMIN_REAUTHENTICATION_REQUIRED" },
        });
        await pool().query(
          "UPDATE auth.sessions SET created_at=now() WHERE id=$1",
          [sessions.get(admin.userId)],
        );
        const reason =
          "Remoção de conteúdo de teste incompatível com as regras.";
        await moderator.p.getByLabel("Motivo da moderação").fill(reason);
        await moderator.p
          .getByRole("button", { name: "Confirmar moderação", exact: true })
          .click();
        await check(
          moderator.p.getByText(
            "Avaliação ocultada. O conteúdo e o motivo permanecem no histórico de moderação.",
          ),
        ).toBeVisible();
        await moderator.p
          .getByLabel("Exibir avaliações", { exact: true })
          .selectOption("moderated");
        await check(
          moderator.p.getByText("Motivo: " + reason, { exact: true }),
        ).toBeVisible();
        const hidden = (
          await pool().query("SELECT * FROM app_reviews WHERE id=$1", [r.id])
        ).rows[0];
        expect(hidden).toMatchObject({
          id: r.id,
          rating: 5,
          comment,
          is_moderated: true,
          moderation_reason: reason,
          moderated_by: admin.userId,
        });
        expect(hidden.moderated_at).toBeTruthy();
        expect(
          (
            await pool().query(
              "SELECT count(*)::int n FROM app_audit_events WHERE action='review.moderated' AND target_id=$1",
              [r.id],
            )
          ).rows[0].n,
        ).toBe(1);
        await guest.p.reload();
        await check(
          block.getByText(
            "Ainda não há avaliações verificadas para esta loja.",
          ),
        ).toBeVisible();
        await check(block.getByText(comment, { exact: true })).toHaveCount(0);
        await consumer.p.reload();
        await check(
          consumer.p.getByText(
            "Avaliação registrada e retirada da exibição pública pela moderação.",
          ),
        ).toBeVisible();
        await check(
          consumer.p.getByRole("button", {
            name: "Avaliar compra",
            exact: true,
          }),
        ).toHaveCount(0);
        expect(
          (
            await pool().query(
              "SELECT average_rating::float,total_reviews FROM app_reputation_projections WHERE store_id=$1",
              [f.catalog.a.store.id],
            )
          ).rows[0],
        ).toEqual({ average_rating: 0, total_reviews: 0 });
        expect(errors).toEqual([]);
        writeFileSync(
          directory + "/result.json",
          JSON.stringify(
            {
              status: "pass",
              widths: [320, 390, 768, 1440],
              realReactHttpPostgres: true,
              authAdapter: "local only",
              gateway: "isolated settlement only",
              reviewPreserved: true,
              lastModerationResetsMean: true,
              pageErrors: errors,
            },
            null,
            2,
          ),
        );
      } finally {
        await consumer.c.close();
        await moderator.c.close();
        await guest.c.close();
        await browser.close();
      }
    }, 90000);
  },
);
vi.mock("../../server/config/runtime.ts", async (original) => {
  const actual =
    await original<typeof import("../../server/config/runtime.ts")>();
  return {
    ...actual,
    runtime: {
      ...actual.runtime,
      appEnv: "development",
      ipPepper: "t24-local-story-proof",
      secureCookies: false,
    },
  };
});
vi.mock("../../server/supabase/client.ts", () => {
  const client = {
    from: (table: string) => {
      let value = "";
      const query: any = {
        select: () => query,
        eq: (_key: string, input: string) => {
          value = input;
          return query;
        },
        is: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          const dbPool = auth.pool;
          if (table === "app_global_config")
            return {
              data: (
                await dbPool!.query(
                  "SELECT * FROM app_global_config WHERE singleton_guard=true",
                )
              ).rows[0],
              error: null,
            };
          if (table === "app_users")
            return {
              data: (
                await dbPool!.query("SELECT * FROM app_users WHERE id=$1", [
                  value,
                ])
              ).rows[0],
              error: null,
            };
          if (table === "app_admin_principals")
            return {
              data: (
                await dbPool!.query(
                  "SELECT * FROM app_admin_principals WHERE admin_user_id=$1",
                  [value],
                )
              ).rows[0],
              error: null,
            };
          return { data: null, error: { message: "local Data API adapter" } };
        },
        then: (done: any) =>
          Promise.resolve({
            data: [],
            error: { message: "local Data API adapter" },
          }).then(done),
      };
      return query;
    },
    auth: {
      getUser: async (token: string) => {
        const user = auth.users.get(token);
        return {
          data: {
            user: user
              ? { ...user, email_confirmed_at: "2026-01-01T00:00:00Z" }
              : null,
          },
          error: null,
        };
      },
      admin: { signOut: async () => ({ error: null }) },
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[]) => ({
          error: null,
          data: paths.map((path) => ({
            signedUrl: `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=local`,
          })),
        }),
      }),
    },
  };
  return {
    supabaseAdmin: client,
    supabasePublic: client,
    createSupabasePublicClient: () => client,
    createSupabaseUserClient: () => client,
  };
});
