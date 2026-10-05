import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
const auth = vi.hoisted(() => ({ userId: "", token: "" }));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_MEDIA_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("LOCAL_DATABASE_REQUIRED");
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
      from: (bucket: string) => ({
        upload: async () => ({ data: {}, error: null }),
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({
            path,
            signedUrl:
              "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/" +
              bucket +
              "/" +
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
import { ProductService } from "../../server/services/ProductService.ts";
import vercel from "../../vercel.json" with { type: "json" };
import { dbPool } from "../../server/db/pool.ts";
import { app } from "../../server/app.ts";
import { issueRecentAuthProof } from "../../server/security/recentAuth.ts";
import { productFixture } from "../helpers/productFixtures.ts";
describe.runIf(Boolean(process.env.HVM_MEDIA_LOCAL_DATABASE_URL))(
  "Capa da loja: React → HTTP → PostgreSQL → vitrine e destaque regional",
  () => {
    let server: Server,
      baseURL: string,
      fixture: Awaited<ReturnType<typeof productFixture>>;
    const pool = () => dbPool as Pool;
    beforeAll(async () => {
      if (!existsSync("dist/index.html"))
        throw new Error("BUILD_REQUIRED_FOR_MEDIA_STORY");
      fixture = await productFixture(pool());
      const categoryId = (
        await pool().query(
          "SELECT id FROM app_categories WHERE is_active AND parent_id IS NULL ORDER BY id LIMIT 1",
        )
      ).rows[0].id;
      const audit = { requestId: randomUUID(), ipHash: "a".repeat(64) };
      let product = await ProductService.createProduct(
        fixture.personId,
        {
          categoryId,
          title: "Couve da capa local",
          description: "Couve fresca higienizada de produção familiar.",
          packagingType: "pote_higienizado",
          netWeightGrams: 250,
          unitType: "pote",
          shelfLifeDays: 5,
          conservationNotes: "Refrigerar",
          priceCents: 1490,
          commandId: randomUUID(),
        },
        fixture.userId,
        audit,
      );
      product = await ProductService.uploadMedia(
        product.id,
        fixture.personId,
        { commandId: randomUUID(), expectedRevision: product.revision },
        fixture.userId,
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
        "image/png",
        audit,
      );
      await ProductService.togglePublish(
        product.id,
        fixture.personId,
        {
          commandId: randomUUID(),
          expectedRevision: product.revision,
          isPublished: true,
        },
        fixture.userId,
        audit,
      );
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
      const csp = vercel.headers
        .find((rule) => rule.source === "/(.*)")!
        .headers.find(
          (header) => header.key === "Content-Security-Policy",
        )!.value;
      outer.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", csp);
        next();
      });
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
    it("salva fotos e identidade no banco e exibe os mesmos dados na loja e na home", async () => {
      const { chromium, expect: check } = await import("@playwright/test");
      const portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        args: ["--disable-gpu", "--no-zygote"],
      });
      const context = await browser.newContext({
        viewport: { width: 390, height: 900 },
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
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
        await page.goto(baseURL + "/produtor/loja");
        await page.getByRole("tab", { name: "Fotos e capa" }).click();
        await page
          .getByLabel("Nome público do produtor")
          .fill("Maria da colheita local");
        await page.getByRole("radio", { name: /Fotos e produtos/ }).check();
        await page
          .getByRole("button", { name: "Salvar capa e identidade" })
          .click();
        await check(
          page.getByText("Nome público e capa salvos."),
        ).toBeVisible();
        await page
          .getByLabel("Foto do produtor", { exact: true })
          .setInputFiles({
            name: "producer.png",
            mimeType: "image/png",
            buffer: png,
          });
        await check(
          page.getByText("Foto do produtor atualizada."),
        ).toBeVisible();
        await page
          .getByLabel("Adicionar foto de capa", { exact: true })
          .setInputFiles({
            name: "campo.png",
            mimeType: "image/png",
            buffer: png,
          });
        await check(page.getByText("Foto adicionada à capa.")).toBeVisible();
        const saved = (
          await pool().query(
            "SELECT cover_mode,public_producer_name,logo_url FROM app_producer_stores WHERE id=$1",
            [fixture.store.id],
          )
        ).rows[0];
        expect(saved).toMatchObject({
          cover_mode: "mixed",
          public_producer_name: "Maria da colheita local",
        });
        expect(saved.logo_url).toContain("/object/store-media/");
        expect(
          (
            await pool().query(
              "SELECT purpose FROM app_store_media WHERE store_id=$1 ORDER BY purpose",
              [fixture.store.id],
            )
          ).rows,
        ).toEqual([{ purpose: "avatar" }, { purpose: "cover" }]);
        await page.reload();
        await page.getByRole("tab", { name: "Fotos e capa" }).click();
        await check(page.getByLabel("Nome público do produtor")).toHaveValue(
          "Maria da colheita local",
        );
        await context.clearCookies();
        await page.goto(baseURL + "/produtores/" + fixture.store.storeSlug);
        const cover = page.getByRole("region", {
          name: "Capa da loja",
          exact: true,
        });
        await check(cover).toBeVisible();
        await cover.getByRole("button", { name: "Próxima foto" }).click();
        await check(
          cover.getByText("Couve da capa local", { exact: true }),
        ).toBeVisible();
        await check(
          cover.getByText("Maria da colheita local", { exact: true }),
        ).toBeVisible();
        await check(
          cover.getByText("R$ 14,90", { exact: false }),
        ).toBeVisible();
        await page.goto(baseURL + "/");
        const highlights = page.getByRole("region", {
          name: "Produtos da região",
          exact: true,
        });
        await check(
          highlights.getByText("Couve da capa local", { exact: true }),
        ).toBeVisible();
        await check(
          highlights.getByText("Maria da colheita local", { exact: true }),
        ).toBeVisible();
        await highlights.getByRole("link").click();
        await check(page).toHaveURL(
          new RegExp("/produtores/" + fixture.store.storeSlug + "$"),
        );
        expect(errors).toEqual([]);
      } catch (error) {
        console.error(
          "Local story feedback:",
          await page.locator('[role="alert"]').allTextContents(),
        );
        await page.screenshot({
          path: "/workspace/scratch/storefront-story-failure.png",
          fullPage: true,
        });
        throw error;
      } finally {
        await browser.close();
      }
    }, 60000);
  },
);
