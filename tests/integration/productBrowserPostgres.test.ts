import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
const auth = vi.hoisted(() => ({ userId: "", token: "" }));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T14_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("T14_LOCAL_DATABASE_REQUIRED");
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
      ipPepper: "t14-local-proof-secret-only",
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
import { issueRecentAuthProof } from "../../server/security/recentAuth.ts";
import { productFixture } from "../helpers/productFixtures.ts";
describe.runIf(Boolean(process.env.HVM_T14_LOCAL_DATABASE_URL))(
  "T14 história completa: React compilado → HTTP/guardas → PostgreSQL → vitrine",
  () => {
    let server: Server,
      baseURL: string,
      fixture: Awaited<ReturnType<typeof productFixture>>;
    const pool = () => dbPool as Pool;
    beforeAll(async () => {
      if (!existsSync("dist/index.html"))
        throw new Error("BUILD_REQUIRED_FOR_T14_STORY");
      fixture = await productFixture(pool());
      auth.userId = fixture.userId;
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
        if (fixture)
          await pool().query("DELETE FROM auth.users WHERE id=$1", [
            fixture.userId,
          ]);
      } finally {
        await dbPool?.end();
      }
    });
    it("cria, muda preço imutavelmente, exige foto, publica e despublica com sessões reais locais", async () => {
      const { chromium, expect: browserExpect } =
          await import("@playwright/test"),
        portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        args: ["--disable-gpu", "--no-zygote"],
      });
      const context = await browser.newContext({
          viewport: { width: 390, height: 900 },
        }),
        page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6LRsAAAAASUVORK5CYII=",
        "base64",
      );
      await context.route(
        "https://xipbsazvymkqqfmfegwu.supabase.co/storage/**",
        (route) => route.fulfill({ contentType: "image/png", body: png }),
      );
      try {
        await context.addCookies([
          { name: "hvm_access", value: auth.token, url: baseURL },
          { name: "hvm_portal_role", value: "producer", url: baseURL },
          {
            name: "hvm_reauth",
            value: issueRecentAuthProof(auth.userId, auth.token),
            url: baseURL,
          },
        ]);
        await page.goto(baseURL + "/produtor/produtos/novo");
        await browserExpect(
          page.getByRole("heading", { name: "Novo produto", exact: true }),
        ).toBeVisible();
        await page
          .getByLabel("Nome do produto", { exact: true })
          .fill("Couve da história T14");
        await page
          .getByRole("combobox", { name: "Categoria", exact: true })
          .selectOption({ label: "Hortaliças folhosas" });
        await page
          .getByLabel("Descrição", { exact: true })
          .fill("Couve picada e higienizada de produção familiar.");
        await page.getByLabel("Peso líquido (g)").fill("250");
        await page.getByLabel("Preço inicial (R$)").fill("12,99");
        await page.getByRole("button", { name: "Criar rascunho" }).click();
        await browserExpect(
          page.getByRole("heading", { name: "Editar produto", exact: true }),
        ).toBeVisible();
        const productId = page.url().match(/\/produtos\/([^/]+)\/editar/)![1];
        const original = (
          await pool().query(
            "SELECT * FROM app_price_versions WHERE product_id=$1",
            [productId],
          )
        ).rows;
        expect(original[0].price_cents).toBe(1299);
        await page.getByLabel("Novo preço (R$)").fill("15,90");
        await page.getByRole("button", { name: "Salvar novo preço" }).click();
        await browserExpect(
          page.getByText(
            "Novo preço salvo. As versões anteriores foram preservadas.",
          ),
        ).toBeVisible();
        expect(
          (
            await pool().query("SELECT * FROM app_price_versions WHERE id=$1", [
              original[0].id,
            ])
          ).rows,
        ).toEqual(original);
        expect(
          (
            await pool().query(
              "SELECT count(*)::int AS count FROM app_price_versions WHERE product_id=$1",
              [productId],
            )
          ).rows[0].count,
        ).toBe(2);
        await page
          .getByRole("button", { name: "Publicar produto", exact: true })
          .click();
        await browserExpect(page.getByRole("alert")).toContainText(
          "Adicione uma foto principal",
        );
        await page.getByLabel("Adicionar foto").setInputFiles({
          name: "couve.png",
          mimeType: "image/png",
          buffer: png,
        });
        await page.getByRole("button", { name: "Enviar foto" }).click();
        await browserExpect(
          page.getByText("Foto principal", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Publicar produto", exact: true })
          .click();
        await browserExpect(
          page.getByText("Produto publicado na sua vitrine."),
        ).toBeVisible();
        await browserExpect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          )
          .toBe(true);
        await page.screenshot({
          path: "/workspace/scratch/t14-editor-story-mobile.png",
          fullPage: true,
        });
        const anon = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        });
        await anon.route(
          "https://xipbsazvymkqqfmfegwu.supabase.co/storage/**",
          (route) => route.fulfill({ contentType: "image/png", body: png }),
        );
        const publicPage = await anon.newPage();
        await publicPage.goto(
          baseURL + "/produtores/" + fixture.store.storeSlug,
        );
        await browserExpect(
          publicPage.getByRole("heading", {
            name: "Couve da história T14",
            exact: true,
          }),
        ).toBeVisible();
        await browserExpect(publicPage.getByText(/15,90/)).toBeVisible();
        await publicPage.screenshot({
          path: "/workspace/scratch/t14-public-story-desktop.png",
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Despublicar produto", exact: true })
          .click();
        await browserExpect(
          page.getByText("Produto despublicado.", { exact: true }),
        ).toBeVisible();
        await publicPage.reload();
        await browserExpect(
          publicPage.getByText("Novas colheitas em breve"),
        ).toBeVisible();
        await browserExpect(
          publicPage.getByRole("heading", {
            name: "Couve da história T14",
            exact: true,
          }),
        ).toHaveCount(0);
        expect(
          (
            await pool().query(
              "SELECT action FROM app_audit_events WHERE target_id=$1 ORDER BY occurred_at",
              [productId],
            )
          ).rows.map((r) => r.action),
        ).toEqual([
          "product.created",
          "product.price_changed",
          "product.media_added",
          "product.published",
          "product.unpublished",
        ]);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    }, 60000);
  },
);
