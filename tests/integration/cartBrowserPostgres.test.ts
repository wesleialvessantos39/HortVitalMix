import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
const auth = vi.hoisted(() => ({ userId: "", email: "", token: "" }));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T18_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("T18_LOCAL_DATABASE_REQUIRED");
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
      ipPepper: "t18-local-proof-only",
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
import { CartService } from "../../server/services/CartService.ts";
import { InventoryService } from "../../server/services/InventoryService.ts";
import { productFixture } from "../helpers/productFixtures.ts";
import vercel from "../../vercel.json" with { type: "json" };
describe.runIf(Boolean(process.env.HVM_T18_LOCAL_DATABASE_URL))(
  "T18 história real: React → cookies/HTTP → PostgreSQL → login → outro aparelho",
  () => {
    let server: Server,
      baseURL: string,
      a: Awaited<ReturnType<typeof productFixture>>,
      b: typeof a,
      categoryId: string,
      pa: string,
      pb: string,
      consumerId: string;
    const pool = () => dbPool as Pool,
      guests: string[] = [];
    async function product(f: typeof a, title: string, weight: number) {
      const id = randomUUID();
      await pool().query(
        "INSERT INTO app_products(id,store_id,category_id,title,description,packaging_type,net_weight_grams,unit_type) VALUES($1,$2,$3,$4,'Alimento de teste exclusivamente local.','porcao_embalada',$5,'un')",
        [id, f.store.id, categoryId, title, weight],
      );
      await pool().query(
        "INSERT INTO app_price_versions(product_id,price_cents,created_by_user_id) VALUES($1,700,$2)",
        [id, f.userId],
      );
      await pool().query(
        "INSERT INTO app_product_media(product_id,media_url,is_primary) VALUES($1,$2,true)",
        [
          id,
          `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/product-media/${f.store.id}/${id}/${randomUUID()}-${"a".repeat(64)}.png`,
        ],
      );
      await pool().query(
        "UPDATE app_products SET is_published=true WHERE id=$1",
        [id],
      );
      const dates = (
        await pool().query(
          "SELECT current_date::text today,(current_date+5)::text expiry",
        )
      ).rows[0];
      await InventoryService.registerHarvest(
        id,
        f.personId,
        {
          lotCode: "LOCAL-T18",
          harvestDate: dates.today,
          expirationDate: dates.expiry,
          quantity: 100,
          commandId: randomUUID(),
        },
        f.userId,
        { requestId: randomUUID(), ipHash: "a".repeat(64) },
      );
      return id;
    }
    beforeAll(async () => {
      if (!existsSync("dist/index.html"))
        throw Error("BUILD_REQUIRED_FOR_T18_STORY");
      a = await productFixture(pool());
      b = await productFixture(pool());
      await pool().query(
        "UPDATE app_producer_stores SET store_name=$2 WHERE id=$1",
        [a.store.id, "Chácara Sol local"],
      );
      await pool().query(
        "UPDATE app_producer_stores SET store_name=$2 WHERE id=$1",
        [b.store.id, "Sítio Verde local"],
      );
      categoryId = randomUUID();
      await pool().query(
        "INSERT INTO app_categories(id,name,slug,icon_name) VALUES($1,'Teste T18 story',$2,'leaf')",
        [categoryId, "t18-story-" + categoryId],
      );
      pa = await product(a, "Cenoura da história", 300);
      pb = await product(b, "Couve da história", 200);
      consumerId = randomUUID();
      auth.userId = consumerId;
      auth.email = consumerId + "@example.test";
      await pool().query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
        [consumerId, auth.email],
      );
      await pool().query(
        "INSERT INTO app_people(user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,'Consumidor local T18',$2,$3,'+5569999999999')",
        [
          consumerId,
          String(Math.floor(Math.random() * 1e11)).padStart(11, "0"),
          auth.email,
        ],
      );
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'consumer')",
        [consumerId],
      );
      const sessionId = randomUUID();
      await pool().query(
        "INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",
        [sessionId, consumerId],
      );
      auth.token =
        "local." +
        Buffer.from(JSON.stringify({ session_id: sessionId })).toString(
          "base64url",
        ) +
        ".local";
      const nativeFetch = globalThis.fetch;
      vi.stubGlobal("fetch", async (input: any, init: any) => {
        if (String(input).includes("/auth/v1/token?"))
          return new Response(
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
          );
        return nativeFetch(input, init);
      });
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
        await pool().query(
          "DELETE FROM app_carts WHERE session_id=ANY($1::text[])",
          [guests],
        );
        for (const id of [consumerId, a?.userId, b?.userId])
          if (id)
            await pool().query("DELETE FROM auth.users WHERE id=$1", [id]);
        if (categoryId)
          await pool().query("DELETE FROM app_categories WHERE id=$1", [
            categoryId,
          ]);
      } finally {
        await dbPool?.end();
      }
    });
    it("cesta multilojas anônima funde no login real, recupera em outro aparelho e logout isola", async () => {
      const { chromium, expect: check } = await import("@playwright/test"),
        portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        args: ["--disable-gpu", "--no-zygote"],
      });
      const context = await browser.newContext({
        viewport: { width: 390, height: 900 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await context.route(
        "https://xipbsazvymkqqfmfegwu.supabase.co/storage/**",
        (route) =>
          route.fulfill({
            contentType: "image/png",
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6LRsAAAAASUVORK5CYII=",
              "base64",
            ),
          }),
      );
      try {
        // Pre-existing saved basket from another device uses the real service.
        const old = randomUUID();
        guests.push(old);
        await CartService.addItem(
          { sessionId: old, userId: consumerId },
          { productId: pa, quantity: 2, commandId: randomUUID() },
          { requestId: randomUUID(), ipHash: "a".repeat(64) },
        );
        await page.goto(baseURL + "/produtos");
        await check(
          page.getByRole("heading", { name: "Cenoura da história" }),
        ).toBeVisible();
        await page.getByText("Monte seu HortiMix", { exact: true }).tap();
        await page.getByLabel("Alimento", { exact: true }).selectOption(pa);
        await page.getByLabel("Corte", { exact: true }).selectOption("rodelas");
        await page.getByRole("button", { name: "Incluir no mix" }).tap();
        await page.getByLabel("Alimento", { exact: true }).selectOption(pb);
        await page
          .getByLabel("Corte", { exact: true })
          .selectOption("picado_fino");
        await page.getByRole("button", { name: "Incluir no mix" }).tap();
        await page
          .getByRole("button", { name: "Adicionar HortiMix à cesta" })
          .tap();
        await check(
          page.getByText("Seu HortiMix foi adicionado à cesta."),
        ).toBeVisible();
        const cookie = (await context.cookies()).find(
          (c) => c.name === "hvm_cart",
        )!;
        expect(cookie.httpOnly).toBe(true);
        guests.push(cookie.value);
        await page.getByRole("button", { name: "Ver minha cesta" }).tap();
        await check(
          page.getByRole("heading", { name: "Chácara Sol local" }),
        ).toBeVisible();
        await check(
          page.getByRole("heading", { name: "Sítio Verde local" }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Entrar na minha conta" }).tap();
        await page.getByLabel("E-mail", { exact: true }).fill(auth.email);
        await page
          .getByLabel("Senha", { exact: true })
          .fill("local-password-only");
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await check(page).toHaveURL(/\/conta$/);
        await page.goto(baseURL + "/carrinho");
        await check(page.getByRole("article")).toHaveCount(3);
        expect(
          (
            await pool().query(
              "SELECT sum(quantity)::int n FROM app_cart_items i JOIN app_carts c ON c.id=i.cart_id WHERE c.user_id=$1",
              [consumerId],
            )
          ).rows[0].n,
        ).toBe(4);
        expect(
          (
            await pool().query(
              "SELECT count(*)::int n FROM app_carts WHERE user_id=$1",
              [consumerId],
            )
          ).rows[0].n,
        ).toBe(1);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.reload();
        await check(page.getByRole("article")).toHaveCount(3);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const second = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        });
        await second.addCookies([
          { name: "hvm_access", value: auth.token, url: baseURL },
        ]);
        const otherPage = await second.newPage();
        await otherPage.goto(baseURL + "/carrinho");
        await check(otherPage.getByRole("article")).toHaveCount(3);
        guests.push(
          (await second.cookies()).find((c) => c.name === "hvm_cart")!.value,
        );
        await second.close();
        const logout = await context.request.post(
          baseURL + "/api/v1/auth/logout",
          { headers: { "Sec-Fetch-Site": "same-origin" } },
        );
        expect(logout.status()).toBe(204);
        await page.reload();
        await check(
          page.getByText("Sua cesta está esperando o frescor"),
        ).toBeVisible();
        expect(errors).toEqual([]);
        expect(
          (
            await pool().query(
              "SELECT sum(current_quantity)::int n FROM app_inventory_lots WHERE product_id=ANY($1::uuid[])",
              [[pa, pb]],
            )
          ).rows[0].n,
        ).toBe(200);
        expect(
          (
            await pool().query(
              "SELECT count(*)::int n FROM app_inventory_reservations WHERE product_id=ANY($1::uuid[])",
              [[pa, pb]],
            )
          ).rows[0].n,
        ).toBe(0);
      } finally {
        await browser.close();
      }
    }, 30000);
  },
);
