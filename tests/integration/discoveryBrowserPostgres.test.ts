import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
const auth = vi.hoisted(() => ({ userId: "", token: "" }));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T17_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("T17_LOCAL_DATABASE_REQUIRED");
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
      ipPepper: "t17-local-proof-secret-only",
    },
  };
});
vi.mock("../../server/supabase/client.ts", () => {
  const client = {
    from: (table: string) => {
      if (table !== "app_global_config")
        throw new Error("UNEXPECTED_DATA_API_TABLE");
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => {
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
                  email: "producer@example.test",
                  email_confirmed_at: "2026-01-01T00:00:00Z",
                }
              : null,
        },
        error: null,
      }),
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: {}, error: null }),
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({
            path,
            signedUrl:
              "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/product-media/" +
              path +
              "?token=local-only",
            error: null,
          })),
          error: null,
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
import { productFixture } from "../helpers/productFixtures.ts";
describe.runIf(Boolean(process.env.HVM_T17_LOCAL_DATABASE_URL))(
  "T17 história completa: React → HTTP → PostgreSQL → favoritos",
  () => {
    let server: Server, baseURL: string;
    const fixtures: Awaited<ReturnType<typeof productFixture>>[] = [];
    const pool = () => dbPool as Pool;
    beforeAll(async () => {
      if (!existsSync("dist/index.html"))
        throw Error("BUILD_REQUIRED_FOR_T17_STORY");
      const outer = express();
      outer.use(["/api", "/_hvm_api"], app);
      outer.use(express.static(resolve("dist")));
      outer.get("*", (_req, res) => res.sendFile(resolve("dist/index.html")));
      server = await new Promise<Server>((done) => {
        const listener = outer.listen(0, "127.0.0.1", () => done(listener));
      });
      baseURL =
        "http://127.0.0.1:" + (server.address() as { port: number }).port;
    });
    afterAll(async () => {
      try {
        if (server)
          await new Promise<void>((done) => server.close(() => done()));
        for (const f of fixtures)
          await pool().query("DELETE FROM auth.users WHERE id=$1", [f.userId]);
      } finally {
        await dbPool?.end();
      }
    });
    it("banco vazio produz home vazia real em mobile e desktop, sem fixtures", async () => {
      expect(
        (await pool().query("SELECT count(*)::int n FROM app_producer_stores"))
          .rows[0].n,
      ).toBe(0);
      const { chromium, expect: browserExpect } =
        await import("@playwright/test");
      const portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        args: ["--disable-gpu", "--no-zygote"],
      });
      try {
        for (const width of [320, 1440]) {
          const page = await browser.newPage({
            viewport: { width, height: 1000 },
          });
          await page.goto(baseURL);
          await browserExpect(
            page.getByRole("heading", { name: "Nenhum produtor encontrado" }),
          ).toBeVisible();
          expect(await page.locator(".hvm-discovery-card").count()).toBe(0);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.close();
        }
      } finally {
        await browser.close();
      }
    });
    it("ordena produtores reais locais, salva/remove favorito, recarrega e abre vitrine T12", async () => {
      const near = await productFixture(pool(), {
        coordinates: { latitude: -9.9133, longitude: -63.0408 },
      });
      fixtures.push(near);
      const far = await productFixture(pool(), {
        coordinates: { latitude: -10.9133, longitude: -63.0408 },
      });
      fixtures.push(far);
      await pool().query(
        "UPDATE app_producer_stores SET store_name=$2 WHERE id=$1",
        [near.store.id, "Produtor próximo T17 local"],
      );
      await pool().query(
        "UPDATE app_producer_stores SET store_name=$2 WHERE id=$1",
        [far.store.id, "Produtor distante T17 local"],
      );
      auth.userId = near.userId;
      const sessionId = randomUUID();
      await pool().query(
        "INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",
        [sessionId, auth.userId],
      );
      auth.token =
        "local." +
        Buffer.from(JSON.stringify({ session_id: sessionId })).toString(
          "base64url",
        ) +
        ".local";
      const { chromium, expect: browserExpect } =
        await import("@playwright/test");
      const portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        args: ["--disable-gpu", "--no-zygote"],
      });
      try {
        for (const width of [390, 1440]) {
          const context = await browser.newContext({
            viewport: { width, height: 1000 },
            isMobile: width === 390,
            hasTouch: width === 390,
          });
          await context.addCookies([
            { name: "hvm_access", value: auth.token, url: baseURL },
            { name: "hvm_portal_role", value: "producer", url: baseURL },
          ]);
          const page = await context.newPage(),
            errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(baseURL + "/produtores");
          await browserExpect(page.locator(".hvm-discovery-card")).toHaveCount(
            2,
          );
          await browserExpect(
            page.locator(".hvm-discovery-card h3").first(),
          ).toHaveText("Produtor próximo T17 local");
          const heart = page.getByRole("button", {
            name: "Adicionar Produtor próximo T17 local aos favoritos",
            exact: true,
          });
          await browserExpect(heart).toBeEnabled();
          if (width === 390) await heart.tap();
          else await heart.click();
          await browserExpect(
            page.getByRole("button", {
              name: "Remover Produtor próximo T17 local dos favoritos",
              exact: true,
            }),
          ).toHaveAttribute("aria-pressed", "true");
          expect(
            (
              await pool().query(
                "SELECT target_id FROM app_favorites WHERE person_id=$1",
                [near.personId],
              )
            ).rows,
          ).toEqual([{ target_id: near.store.id }]);
          await page.reload();
          const remove = page.getByRole("button", {
            name: "Remover Produtor próximo T17 local dos favoritos",
            exact: true,
          });
          await browserExpect(remove).toBeEnabled();
          if (width === 390) await remove.tap();
          else await remove.click();
          await browserExpect(
            page.getByRole("button", {
              name: "Adicionar Produtor próximo T17 local aos favoritos",
              exact: true,
            }),
          ).toHaveAttribute("aria-pressed", "false");
          expect(
            (
              await pool().query(
                "SELECT target_id FROM app_favorites WHERE person_id=$1",
                [near.personId],
              )
            ).rows,
          ).toEqual([]);
          const link = page
            .getByRole("link", { name: "Ver Produtos", exact: true })
            .first();
          await browserExpect(link).toHaveAttribute(
            "href",
            "/produtores/" + near.store.storeSlug,
          );
          await link.click();
          await browserExpect(page).toHaveURL(
            baseURL + "/produtores/" + near.store.storeSlug,
          );
          await browserExpect(
            page.getByRole("heading", {
              name: "Produtor próximo T17 local",
              exact: true,
            }),
          ).toBeVisible();
          expect(errors).toEqual([]);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await context.close();
        }
      } finally {
        await browser.close();
      }
    }, 60000);
  },
);
