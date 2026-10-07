import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
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
  const value = process.env.HVM_T21_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("T21_LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
vi.mock("../../server/config/runtime.ts", async (original) => {
  const actual =
    await original<typeof import("../../server/config/runtime.ts")>();
  return {
    ...actual,
    runtime: {
      ...actual.runtime,
      appEnv: "development",
      ipPepper: "t20-local-story-proof",
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
import { dbPool } from "../../server/db/pool.ts";
import { app } from "../../server/app.ts";
import {
  checkoutCatalog,
  checkoutBuyer,
  checkoutAudit,
} from "../helpers/checkoutFixtures.ts";
import { CheckoutService } from "../../server/services/CheckoutService.ts";
import { CommerceService } from "../../server/services/CommerceService.ts";
import {
  PaymentService,
  settleVerifiedPayment,
} from "../../server/services/PaymentService.ts";
import { commerceTransaction } from "../../server/services/CommerceSupport.ts";
import { CartService } from "../../server/services/CartService.ts";
import vercel from "../../vercel.json" with { type: "json" };
describe.runIf(!!process.env.HVM_T21_LOCAL_DATABASE_URL)(
  "T21 história real: produtor → API → PostgreSQL → rastreamento do comprador",
  () => {
    let server: Server,
      baseURL: string,
      catalog: Awaited<ReturnType<typeof checkoutCatalog>>,
      buyer: Awaited<ReturnType<typeof checkoutBuyer>>;
    const pool = () => dbPool as Pool;
    const tokens = new Map<string, string>();
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
      auth.users.set(token, { id: userId, email: userId + "@example.test" });
    }
    beforeAll(async () => {
      if (!existsSync("dist/index.html"))
        throw Error("BUILD_REQUIRED_FOR_T21_STORY");
      auth.pool = pool();
      catalog = await checkoutCatalog(pool());
      buyer = await checkoutBuyer(pool(), [catalog.pa]);
      for (const userId of [catalog.a.userId, buyer.userId])
        await session(userId);
      const outer = express();
      const csp = vercel.headers
        .find((entry) => entry.source === "/(.*)")!
        .headers.find(
          (entry) => entry.key === "Content-Security-Policy",
        )!.value;
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
    }, 20000);
    afterAll(async () => {
      try {
        if (server)
          await new Promise<void>((done) => server.close(() => done()));
        if (buyer) await buyer.cleanup();
        if (catalog) await catalog.cleanup();
      } finally {
        await dbPool?.end();
      }
    }, 20000);

    it("produtor prepara e cancela; comprador acompanha snapshots e proteção financeira via HTTP real", async () => {
      const { chromium, expect: check } = await import("@playwright/test");
      const portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        args: ["--disable-gpu", "--no-zygote"],
      });
      const errors: string[] = [];
      async function context(userId: string, role: string, width: number) {
        const ctx = await browser.newContext({
          viewport: { width, height: 950 },
        });
        await ctx.addCookies([
          {
            name: "hvm_access",
            value: tokens.get(userId)!,
            url: baseURL,
            httpOnly: true,
          },
          {
            name: "hvm_portal_role",
            value: role,
            url: baseURL,
            httpOnly: true,
          },
        ]);
        const page = await ctx.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        return { ctx, page };
      }
      async function purchase() {
        const quote = await CheckoutService.createQuote(
          buyer.userId,
          buyer.cartId,
          buyer.addressId,
          checkoutAudit(),
        );
        const receipt = await CheckoutService.confirmCheckout(
          randomUUID(),
          { quoteId: quote.id, paymentMethod: "pix" },
          buyer.userId,
          checkoutAudit(),
        );
        await PaymentService.acceptPolicy(
          buyer.userId,
          receipt.body.paymentIntentId,
          (await CommerceService.policy()).policy.version,
          checkoutAudit(),
        );
        const payment = {
          provider: "isolated_test",
          eventId: randomUUID(),
          paymentReference: randomUUID(),
          intentId: receipt.body.paymentIntentId,
          status: "approved" as const,
          amountCents: receipt.body.totalCents,
          currency: "BRL" as const,
          method: "pix" as const,
          paidAt: new Date().toISOString(),
        };
        await pool().query(
          "UPDATE app_payment_intents SET gateway_reference=$2 WHERE id=$1",
          [payment.intentId, payment.paymentReference],
        );
        const result = await commerceTransaction((c) =>
          settleVerifiedPayment(c, payment, checkoutAudit()),
        );
        return result.orderIds![0];
      }
      try {
        const orderId = await purchase(),
          producer = await context(catalog.a.userId, "producer", 1440),
          customer = await context(buyer.userId, "consumer", 390);
        await producer.page.goto(baseURL + "/produtor/pedidos");
        await customer.page.goto(baseURL + "/pedidos/" + orderId);
        await check(
          customer.page.locator('.order-timeline [aria-current="step"]'),
        ).toContainText("Pagamento confirmado");
        await producer.page
          .getByRole("button", { name: "Iniciar preparo", exact: true })
          .click();
        await check(
          producer.page.getByRole("button", {
            name: "Marcar como pronto",
            exact: true,
          }),
        ).toBeVisible();
        await customer.page.evaluate(() =>
          window.dispatchEvent(new Event("focus")),
        );
        await check(
          customer.page.locator('.order-timeline [aria-current="step"]'),
        ).toContainText("Em preparo");
        mkdirSync("test-results", { recursive: true });
        await producer.page.screenshot({
          path: "test-results/t21-real-producer-1440.png",
          fullPage: true,
        });
        await customer.page.screenshot({
          path: "test-results/t21-real-tracking-390.png",
          fullPage: true,
        });
        await producer.page
          .getByRole("button", { name: "Marcar como pronto", exact: true })
          .click();
        await producer.page
          .getByRole("button", { name: "Saiu para entrega", exact: true })
          .click();
        producer.page.once("dialog", (d) => d.accept());
        await producer.page
          .getByRole("button", { name: "Confirmar entrega", exact: true })
          .click();
        await check(
          producer.page.locator(".order-card .order-status-delivered"),
        ).toBeVisible();
        await customer.page
          .getByRole("button", { name: "Atualizar", exact: true })
          .click();
        await check(
          customer.page.locator('.order-timeline [aria-current="step"]'),
        ).toContainText("Entregue");
        const events = (
          await pool().query(
            "SELECT from_status,to_status,revision FROM app_order_events WHERE order_id=$1 ORDER BY revision",
            [orderId],
          )
        ).rows;
        expect(events.map((e) => e.to_status)).toEqual([
          "confirmed",
          "in_preparation",
          "ready_for_dispatch",
          "out_for_delivery",
          "delivered",
        ]);
        expect(events.map((e) => e.revision)).toEqual([1, 2, 3, 4, 5]);
        expect(
          (
            await pool().query(
              "SELECT release_after FROM app_financial_holds WHERE order_id=$1",
              [orderId],
            )
          ).rows[0].release_after,
        ).toBeNull();
        await customer.page.goto(baseURL + "/compras");
        customer.page.once("dialog", (d) => d.accept());
        await customer.page
          .getByRole("button", { name: "Recebi meus produtos", exact: true })
          .click();
        await check(
          customer.page.getByText("Recebimento confirmado", { exact: true }),
        ).toBeVisible();
        expect(
          (
            await pool().query(
              "SELECT status FROM app_order_fulfillment WHERE order_id=$1",
              [orderId],
            )
          ).rows[0].status,
        ).toBe("delivered");
        await CartService.addItem(
          { sessionId: buyer.sessionId, userId: buyer.userId },
          { productId: catalog.pa, quantity: 2, commandId: randomUUID() },
          checkoutAudit(),
        );
        const cancelId = await purchase();
        await producer.page.goto(baseURL + "/produtor/pedidos");
        await producer.page
          .getByRole("button", { name: "Cancelar pedido", exact: true })
          .click();
        await producer.page
          .getByLabel("Motivo do cancelamento")
          .fill("A colheita não passou no controle de qualidade.");
        await producer.page
          .getByRole("button", { name: "Confirmar cancelamento", exact: true })
          .click();
        await check(
          producer.page.locator(".order-card .order-status-cancelled"),
        ).toBeVisible();
        await customer.page.goto(baseURL + "/pedidos/" + cancelId);
        await check(
          customer.page.getByRole("heading", {
            name: "Pedido cancelado",
            exact: true,
          }),
        ).toBeVisible();
        expect(
          (
            await pool().query(
              "SELECT sum(quantity)::int quantity FROM app_order_stock_returns WHERE order_id=$1",
              [cancelId],
            )
          ).rows[0].quantity,
        ).toBe(2);
        expect(
          (
            await pool().query(
              "SELECT status,requester_user_id FROM app_refund_requests WHERE order_id=$1",
              [cancelId],
            )
          ).rows[0],
        ).toEqual({ status: "requested", requester_user_id: buyer.userId });
        for (const page of [producer.page, customer.page])
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          ).toBe(true);
        await customer.page.goto(baseURL + "/compras");
        await check(
          customer.page.getByRole("button", {
            name: "Recebi meus produtos",
            exact: true,
          }),
        ).toHaveCount(0);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    }, 90000);
  },
);
