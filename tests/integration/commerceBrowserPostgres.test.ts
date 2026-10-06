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
  const value = process.env.HVM_T20_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("T20_LOCAL_DATABASE_REQUIRED");
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
import { issueRecentAuthProof } from "../../server/security/recentAuth.ts";
import vercel from "../../vercel.json" with { type: "json" };
describe.runIf(!!process.env.HVM_T20_LOCAL_DATABASE_URL)(
  "T20 história real: navegador → HTTP e permissões → PostgreSQL",
  () => {
    let server: Server,
      baseURL: string,
      catalog: Awaited<ReturnType<typeof checkoutCatalog>>,
      buyer: Awaited<ReturnType<typeof checkoutBuyer>>,
      adminId: string;
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
        throw Error("BUILD_REQUIRED_FOR_T20_STORY");
      auth.pool = pool();
      catalog = await checkoutCatalog(pool());
      buyer = await checkoutBuyer(pool(), [catalog.pa]);
      adminId = randomUUID();
      await pool().query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
        [adminId, adminId + "@example.test"],
      );
      await pool().query("UPDATE app_users SET status='active' WHERE id=$1", [
        adminId,
      ]);
      await pool().query(
        "INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role,email_verified_at) VALUES($1,$2,$3,'platform_super_admin',now())",
        [adminId, buyer.personId, adminId + "@example.test"],
      );
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'platform_super_admin')",
        [adminId],
      );
      for (const userId of [catalog.a.userId, buyer.userId, adminId])
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
        if (adminId)
          await pool().query("DELETE FROM auth.users WHERE id=$1", [adminId]);
        if (buyer) await buyer.cleanup();
        if (catalog) await catalog.cleanup();
      } finally {
        await dbPool?.end();
      }
    }, 20000);
    it("caixa, revisão pelo cliente, solicitação e decisão administrativa sem simular dinheiro", async () => {
      const { chromium, expect: check } = await import("@playwright/test"),
        portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        args: ["--disable-gpu", "--no-zygote"],
      });
      const errors: string[] = [];
      async function context(userId: string, role: string, width = 390) {
        const value = await browser.newContext({
            viewport: { width, height: 950 },
          }),
          token = tokens.get(userId)!;
        await value.addCookies([
          { name: "hvm_access", value: token, url: baseURL, httpOnly: true },
          {
            name: "hvm_portal_role",
            value: role,
            url: baseURL,
            httpOnly: true,
          },
          {
            name: "hvm_reauth",
            value: issueRecentAuthProof(userId, token),
            url: baseURL,
            httpOnly: true,
          },
        ]);
        await value.route(
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
        return value;
      }
      try {
        const producerContext = await context(catalog.a.userId, "producer"),
          producerPage = await producerContext.newPage();
        producerPage.on("pageerror", (e) => errors.push(e.message));
        await producerPage.goto(baseURL + "/produtor/caixa");
        await check(
          producerPage.getByRole("heading", {
            name: "Caixa do produtor",
            exact: true,
          }),
        ).toBeVisible();
        await producerPage.getByLabel("Quantidade de Cenoura T19").fill("1");
        await producerPage
          .getByLabel("Cartão de débito · maquininha", { exact: true })
          .check();
        await producerPage
          .getByRole("button", {
            name: "Preparar venda presencial",
            exact: true,
          })
          .click();
        await check(
          producerPage.getByRole("heading", { name: "Revisão para o cliente" }),
        ).toBeVisible();
        const sale = (
          await pool().query(
            "SELECT * FROM app_pos_sales WHERE producer_user_id=$1 ORDER BY created_at DESC LIMIT 1",
            [catalog.a.userId],
          )
        ).rows[0];
        expect(sale.payment_method).toBe("debit_card");
        expect(sale.reservation_ids).toEqual([]);
        const buyerContext = await context(buyer.userId, "consumer"),
          buyerPage = await buyerContext.newPage();
        buyerPage.on("pageerror", (e) => errors.push(e.message));
        await buyerPage.goto(baseURL + "/pos/venda/" + sale.code);
        await check(
          buyerPage.getByRole("heading", {
            name: "Revise sua compra presencial",
          }),
        ).toBeVisible();
        await buyerPage.getByRole("checkbox").check();
        await buyerPage
          .getByRole("button", {
            name: "Confirmar revisão e termos",
            exact: true,
          })
          .click();
        await check(
          buyerPage.getByRole("button", {
            name: "Revisão registrada",
            exact: true,
          }),
        ).toBeDisabled();
        expect(
          (
            await pool().query(
              "SELECT customer_user_id,status FROM app_pos_sales WHERE id=$1",
              [sale.id],
            )
          ).rows[0],
        ).toEqual({ customer_user_id: buyer.userId, status: "accepted" });
        // A trusted payment fixture is inserted only in this disposable database.
        // Production has no adapter and cannot produce this financial confirmation.
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
        const policy = (await CommerceService.policy()).policy;
        await PaymentService.acceptPolicy(
          buyer.userId,
          receipt.body.paymentIntentId,
          policy.version,
          checkoutAudit(),
        );
        const reference = randomUUID();
        await pool().query(
          "UPDATE app_payment_intents SET gateway_reference=$2 WHERE id=$1",
          [receipt.body.paymentIntentId, reference],
        );
        await commerceTransaction((client) =>
          settleVerifiedPayment(
            client,
            {
              provider: "isolated_test",
              eventId: randomUUID(),
              paymentReference: reference,
              intentId: receipt.body.paymentIntentId,
              status: "approved",
              amountCents: receipt.body.totalCents,
              currency: "BRL",
              method: "pix",
              paidAt: new Date().toISOString(),
            },
            checkoutAudit(),
          ),
        );
        await buyerPage.goto(baseURL + "/compras");
        await check(
          buyerPage.getByRole("heading", {
            name: "Minhas compras",
            exact: true,
          }),
        ).toBeVisible();
        await buyerPage
          .getByRole("button", { name: "Solicitar reembolso", exact: true })
          .first()
          .click();
        await check(
          buyerPage.getByRole("heading", {
            name: "Meus reembolsos",
            exact: true,
          }),
        ).toBeVisible();
        await buyerPage
          .getByRole("combobox", { name: "Motivo", exact: true })
          .selectOption("quality");
        await buyerPage
          .getByLabel("Descreva o que aconteceu", { exact: true })
          .fill(
            "Os alimentos apresentaram um problema de qualidade registrado neste teste local.",
          );
        await buyerPage
          .getByRole("button", { name: "Enviar solicitação", exact: true })
          .click();
        await check(
          buyerPage.getByText(
            "Solicitação registrada. O repasse permanece bloqueado durante a análise.",
          ),
        ).toBeVisible();
        const refund = (
          await pool().query(
            "SELECT * FROM app_refund_requests WHERE requester_user_id=$1 ORDER BY created_at DESC LIMIT 1",
            [buyer.userId],
          )
        ).rows[0];
        expect(refund.status).toBe("requested");
        expect(
          (
            await pool().query(
              "SELECT state FROM app_financial_holds WHERE order_id=$1",
              [refund.order_id],
            )
          ).rows[0].state,
        ).toBe("disputed");
        mkdirSync("/workspace/scratch", { recursive: true });
        await buyerPage.screenshot({
          path: "/workspace/scratch/t20-refund-mobile.png",
          fullPage: true,
        });
        const adminContext = await context(
            adminId,
            "platform_super_admin",
            1440,
          ),
          adminPage = await adminContext.newPage();
        adminPage.on("pageerror", (e) => errors.push(e.message));
        const verifiedSession = await adminContext.request.get(
          baseURL + "/api/v1/admin/auth/verify-session",
        );
        expect({
          status: verifiedSession.status(),
          body: await verifiedSession.json(),
        }).toMatchObject({
          status: 200,
          body: { authorized: true, role: "platform_super_admin" },
        });
        await adminPage.goto(baseURL + "/admin/reembolsos");
        await check(
          adminPage.getByRole("heading", {
            name: "Gestão de reembolsos",
            exact: true,
          }),
        ).toBeVisible();
        await adminPage
          .getByRole("button", { name: /Qualidade ou defeito/ })
          .click();
        await adminPage
          .getByRole("combobox", { name: "Etapa", exact: true })
          .selectOption("approve");
        await adminPage
          .getByLabel("Justificativa e orientação ao solicitante", {
            exact: true,
          })
          .fill(
            "Após conferir os fatos, o valor foi aprovado para estorno pelo provedor.",
          );
        await adminPage
          .getByRole("button", { name: "Registrar decisão", exact: true })
          .click();
        await check(
          adminPage.getByText(
            "Decisão registrada com autor e data no histórico.",
          ),
        ).toBeVisible();
        expect(
          (
            await pool().query(
              "SELECT status FROM app_refund_requests WHERE id=$1",
              [refund.id],
            )
          ).rows[0].status,
        ).toBe("approved");
        expect(
          (
            await pool().query(
              "SELECT state,refunded_cents FROM app_financial_holds WHERE order_id=$1",
              [refund.order_id],
            )
          ).rows[0],
        ).toEqual({ state: "refund_pending", refunded_cents: 0 });
        expect(
          (
            await pool().query(
              "SELECT actor_user_id FROM app_case_history WHERE refund_id=$1 ORDER BY created_at DESC LIMIT 1",
              [refund.id],
            )
          ).rows[0].actor_user_id,
        ).toBe(adminId);
        await adminPage.screenshot({
          path: "/workspace/scratch/t20-refund-admin-desktop.png",
          fullPage: true,
        });
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    }, 90000);
  },
);
