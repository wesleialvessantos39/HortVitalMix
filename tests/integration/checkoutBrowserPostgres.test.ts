import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
const auth = vi.hoisted(() => ({ userId: "", email: "", token: "" }));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T19_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("T19_LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
vi.mock("../../server/config/runtime.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/config/runtime.ts")>();
  return {
    ...actual,
    runtime: {
      ...actual.runtime,
      appEnv: "development",
      ipPepper: "t19-local-proof-only",
      secureCookies: false,
    },
  };
});
vi.mock("../../server/supabase/client.ts", () => {
  const client = {
    from: (table: string) => {
      // An unavailable external Data API falls back to real local SQL identity.
      const query: any = {
        select: () => query,
        eq: () => query,
        is: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          if (table !== "app_global_config")
            return { data: null, error: { message: "local Data API adapter" } };
          const { dbPool } = await import("../../server/db/pool.ts");
          return {
            data: (
              await dbPool!.query(
                "SELECT * FROM app_global_config WHERE singleton_guard=true",
              )
            ).rows[0],
            error: null,
          };
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
      getUser: async (token: string) => ({
        data: {
          user:
            token === auth.token
              ? {
                  id: auth.userId,
                  email: auth.email,
                  email_confirmed_at: "2026-01-01T00:00:00Z",
                }
              : null,
        },
        error: null,
      }),
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
import { dbPool } from "../../server/db/pool.ts";
import { app } from "../../server/app.ts";
import { checkoutCatalog, checkoutBuyer } from "../helpers/checkoutFixtures.ts";
import vercel from "../../vercel.json" with { type: "json" };
describe.runIf(Boolean(process.env.HVM_T19_LOCAL_DATABASE_URL))(
  "T19 história real: React → cookies/HTTP → cotação/estoque/recibo PostgreSQL",
  () => {
    let server: Server, baseURL: string;
    let catalog: Awaited<ReturnType<typeof checkoutCatalog>>;
    let buyer: Awaited<ReturnType<typeof checkoutBuyer>>;
    const pool = () => dbPool as Pool;
    beforeAll(async () => {
      if (!existsSync("dist/index.html"))
        throw Error("BUILD_REQUIRED_FOR_T19_STORY");
      catalog = await checkoutCatalog(pool());
      buyer = await checkoutBuyer(pool(), [catalog.pa, catalog.pb]);
      auth.userId = buyer.userId;
      auth.email = buyer.userId + "@example.test";
      const sessionId = randomUUID();
      await pool().query(
        "INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",
        [sessionId, buyer.userId],
      );
      auth.token =
        "local." +
        Buffer.from(JSON.stringify({ session_id: sessionId })).toString(
          "base64url",
        ) +
        ".local";
      const nativeFetch = globalThis.fetch;
      vi.stubGlobal("fetch", async (input: any, init: any) =>
        String(input).includes("/auth/v1/token?")
          ? new Response(
              JSON.stringify({
                access_token: auth.token,
                refresh_token: "local-refresh",
                expires_in: 3600,
                user: {
                  id: auth.userId,
                  email: auth.email,
                  email_confirmed_at: "2026-01-01T00:00:00Z",
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            )
          : nativeFetch(input, init),
      );
      const outer = express(),
        csp = vercel.headers
          .find((r) => r.source === "/(.*)")!
          .headers.find((h) => h.key === "Content-Security-Policy")!.value;
      outer.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", csp);
        next();
      });
      outer.use(["/api", "/_hvm_api"], app);
      outer.use(express.static(resolve("dist")));
      outer.get("*", (_req, res) => res.sendFile(resolve("dist/index.html")));
      server = await new Promise((done) => {
        const listener = outer.listen(0, "127.0.0.1", () => done(listener));
      });
      baseURL =
        "http://127.0.0.1:" + (server.address() as { port: number }).port;
    });
    afterAll(async () => {
      vi.unstubAllGlobals();
      try {
        if (server)
          await new Promise<void>((done) => server.close(() => done()));
        if (buyer) await buyer.cleanup();
        if (catalog) await catalog.cleanup();
      } finally {
        await dbPool?.end();
      }
    });
    it("revisão multilojas, resposta perdida/replay e recuperação em outro aparelho sem duplicar", async () => {
      const { chromium, expect: check } = await import("@playwright/test"),
        portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        args: ["--disable-gpu", "--no-zygote"],
      });
      const context = await browser.newContext({
        viewport: { width: 390, height: 950 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage(),
        errors: string[] = [],
        commands: string[] = [],
        receipts: any[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const images = async (c: typeof context) =>
        c.route("https://xipbsazvymkqqfmfegwu.supabase.co/storage/**", (r) =>
          r.fulfill({
            contentType: "image/png",
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6LRsAAAAASUVORK5CYII=",
              "base64",
            ),
          }),
        );
      await images(context);
      let lost = true;
      await context.route("**/v1/checkout/confirm", async (r) => {
        commands.push(r.request().headers()["x-command-id"]);
        const reply = await r.fetch();
        expect(reply.status()).toBe(201);
        receipts.push(await reply.json());
        if (lost) {
          lost = false;
          return r.abort("failed");
        }
        return r.fulfill({ response: reply });
      });
      try {
        await page.goto(baseURL + "/checkout");
        await check(
          page.getByRole("heading", { name: "Entre para revisar sua seleção" }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Entrar na minha conta", exact: true })
          .tap();
        await page.getByLabel("E-mail", { exact: true }).fill(auth.email);
        await page
          .getByLabel("Senha", { exact: true })
          .fill("local-password-only");
        await page.getByRole("button", { name: "Entrar", exact: true }).tap();
        await check(page).toHaveURL(/\/conta$/);
        expect(
          (await context.cookies()).find((c) => c.name === "hvm_access")
            ?.httpOnly,
        ).toBe(true);
        await page.goto(baseURL + "/carrinho");
        await page
          .getByRole("button", { name: "Revisar pedido", exact: true })
          .tap();
        await page
          .getByRole("button", {
            name: "Calcular frete e revisar",
            exact: true,
          })
          .tap();
        await check(
          page.getByText("Cotação congelada", { exact: true }),
        ).toBeVisible();
        const frozen = (
          await pool().query(
            "SELECT * FROM app_checkout_quotes WHERE user_id=$1",
            [buyer.userId],
          )
        ).rows;
        expect(frozen).toHaveLength(1);
        expect(frozen[0].items_snapshot).toHaveLength(2);
        expect(frozen[0].is_consumed).toBe(false);
        await page
          .getByRole("button", { name: "Confirmar Pedido", exact: true })
          .tap();
        await check(
          page.getByRole("heading", {
            name: "Vamos recuperar sua confirmação",
          }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Recuperar confirmação", exact: true })
          .tap();
        await check(
          page.getByRole("heading", {
            name: "Checkout confirmado",
            exact: true,
          }),
        ).toBeVisible();
        await check(
          page.getByText("Pagamento pendente", { exact: true }),
        ).toBeVisible();
        expect(commands).toHaveLength(2);
        expect(commands[0]).toBe(commands[1]);
        expect(receipts[0]).toEqual(receipts[1]);
        const persisted = (
          await pool().query(
            "SELECT r.response_body,r.status_code,p.status,p.amount_cents,q.is_consumed FROM app_command_receipts r JOIN app_payment_intents p ON p.command_id=r.command_id JOIN app_checkout_quotes q ON q.id=p.quote_id WHERE r.command_id=$1",
            [commands[0]],
          )
        ).rows;
        expect(persisted).toHaveLength(1);
        expect(persisted[0].response_body).toEqual(receipts[0]);
        expect(persisted[0].status).toBe("pending");
        expect(persisted[0].status_code).toBe(201);
        expect(persisted[0].is_consumed).toBe(true);
        expect(
          (
            await pool().query(
              "SELECT sum(quantity)::int n FROM app_inventory_reservations WHERE cart_session_id=$1 AND NOT is_released AND NOT is_consumed",
              ["checkout_" + frozen[0].id],
            )
          ).rows[0].n,
        ).toBe(4);
        expect(
          (
            await pool().query(
              "SELECT sum(current_quantity)::int n FROM app_inventory_lots WHERE product_id=ANY($1::uuid[])",
              [[catalog.pa, catalog.pb]],
            )
          ).rows[0].n,
        ).toBe(196);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: "/workspace/scratch/t19-story-mobile.png",
          fullPage: true,
        });
        await page.reload();
        await check(
          page.getByRole("heading", {
            name: "Checkout confirmado",
            exact: true,
          }),
        ).toBeVisible();
        expect(commands).toHaveLength(2);
        const second = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        });
        await images(second);
        await second.addCookies([
          {
            name: "hvm_access",
            value: auth.token,
            url: baseURL,
            httpOnly: true,
          },
        ]);
        const other = await second.newPage();
        await other.goto(baseURL + "/checkout");
        await check(
          other.getByRole("heading", {
            name: "Checkout confirmado",
            exact: true,
          }),
        ).toBeVisible();
        expect(
          await other.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await other.screenshot({
          path: "/workspace/scratch/t19-story-desktop.png",
          fullPage: true,
        });
        await second.close();
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    }, 60000);
  },
);
