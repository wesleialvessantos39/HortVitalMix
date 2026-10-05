import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
const auth = vi.hoisted(() => ({ userId: "", token: "" }));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T15_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("T15_LOCAL_DATABASE_REQUIRED");
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
      ipPepper: "t15-local-proof-secret-only",
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
import { ProductService } from "../../server/services/ProductService.ts";
import { InventoryService } from "../../server/services/InventoryService.ts";
import { app } from "../../server/app.ts";
import { issueRecentAuthProof } from "../../server/security/recentAuth.ts";
import { productFixture } from "../helpers/productFixtures.ts";
describe.runIf(Boolean(process.env.HVM_T15_LOCAL_DATABASE_URL))(
  "T15 história completa: colheita → HTTP/guardas → PostgreSQL → disponibilidade",
  () => {
    let server: Server,
      baseURL: string,
      fixture: Awaited<ReturnType<typeof productFixture>>;
    const pool = () => dbPool as Pool;
    beforeAll(async () => {
      if (!existsSync("dist/index.html"))
        throw new Error("BUILD_REQUIRED_FOR_T15_STORY");
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
    it("lança colheita, reserva, expira e consome sem duplicar baixa nem alterar preços", async () => {
      const categoryId = (
        await pool().query(
          "SELECT id FROM app_categories WHERE slug='hortalicas-folhosas'",
        )
      ).rows[0].id;
      const audit = { requestId: randomUUID(), ipHash: "d".repeat(64) };
      let product = await ProductService.createProduct(
        fixture.personId,
        {
          categoryId,
          title: "Couve da história T15",
          description: "Couve higienizada da produção familiar.",
          packagingType: "pote_higienizado",
          netWeightGrams: 250,
          unitType: "pote",
          shelfLifeDays: 5,
          conservationNotes: "Manter refrigerado entre 2°C e 6°C",
          priceCents: 1290,
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
      product = await ProductService.togglePublish(
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
      const prices = (
        await pool().query(
          "SELECT * FROM app_price_versions WHERE product_id=$1",
          [product.id],
        )
      ).rows;
      const { chromium, expect: browserExpect } =
          await import("@playwright/test"),
        portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        args: ["--disable-gpu", "--no-zygote"],
      });
      const context = await browser.newContext({
          viewport: { width: 390, height: 950 },
          locale: "pt-BR",
        }),
        page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6LRsAAAAASUVORK5CYII=",
        "base64",
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
        await page.goto(baseURL + "/produtor/produtos");
        await page
          .getByRole("button", { name: "Lotes e colheitas", exact: true })
          .click();
        await browserExpect(
          page.getByText("Nenhum lote registrado"),
        ).toBeVisible();
        await page.getByLabel("Código do lote").fill("H-STORY-15");
        await page.getByLabel("Quantidade", { exact: true }).fill("2");
        await page
          .getByRole("button", { name: "Registrar colheita", exact: true })
          .click();
        await browserExpect(page.getByRole("status")).toContainText(
          "Colheita registrada",
        );
        await browserExpect(
          page.getByRole("heading", { name: "H-STORY-15", exact: true }),
        ).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: "/workspace/scratch/t15-story-mobile.png",
          fullPage: true,
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        const anon = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
          }),
          publicPage = await anon.newPage();
        publicPage.on("pageerror", (e) => errors.push(e.message));
        await anon.route(
          "https://xipbsazvymkqqfmfegwu.supabase.co/storage/**",
          (route) => route.fulfill({ contentType: "image/png", body: png }),
        );
        await publicPage.goto(
          baseURL + "/produtores/" + fixture.store.storeSlug,
        );
        await browserExpect(
          publicPage.getByText("Em estoque", { exact: true }),
        ).toBeVisible();
        const first = await InventoryService.reserveStock(
          product.id,
          2,
          "story-session-15",
        );
        if (first.status !== "reserved") throw Error("stock required");
        await publicPage.reload();
        await browserExpect(
          publicPage.getByText("Esgotado", { exact: true }),
        ).toBeVisible();
        await pool().query(
          "UPDATE app_inventory_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [first.reservations[0].id],
        );
        await publicPage.reload();
        await browserExpect(
          publicPage.getByText("Em estoque", { exact: true }),
        ).toBeVisible();
        await publicPage.screenshot({
          path: "/workspace/scratch/t15-story-desktop.png",
          fullPage: true,
        });
        const last = await InventoryService.reserveStock(
          product.id,
          2,
          "story-final-15",
        );
        if (last.status !== "reserved") throw Error("stock required");
        const orderId = randomUUID();
        await InventoryService.consumeReservation(
          last.reservations[0].id,
          orderId,
          fixture.userId,
        );
        await InventoryService.consumeReservation(
          last.reservations[0].id,
          orderId,
          fixture.userId,
        );
        await page.reload();
        await browserExpect(
          page.getByRole("region", { name: "Histórico de movimentos" }),
        ).toContainText("Venda");
        await publicPage.reload();
        await browserExpect(
          publicPage.getByText("Esgotado", { exact: true }),
        ).toBeVisible();
        expect(
          (
            await pool().query(
              "SELECT * FROM app_price_versions WHERE product_id=$1",
              [product.id],
            )
          ).rows,
        ).toEqual(prices);
        expect(
          (
            await pool().query(
              "SELECT quantity_delta FROM app_inventory_movements WHERE reservation_id=$1",
              [last.reservations[0].id],
            )
          ).rows,
        ).toEqual([{ quantity_delta: -2 }]);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    });
  },
);
