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
  const value = process.env.HVM_T23_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("T23_LOCAL_DATABASE_REQUIRED");
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
import { SubscriptionService } from "../../server/services/SubscriptionService.ts";
import vercel from "../../vercel.json" with { type: "json" };
import { DeliveryLogisticsService } from "../../server/services/DeliveryLogisticsService.ts";
import { app } from "../../server/app.ts";
import { dbPool } from "../../server/db/pool.ts";
import {
  checkoutCatalog,
  checkoutBuyer,
  checkoutAudit,
} from "../helpers/checkoutFixtures.ts";
const billing = vi.hoisted(() => ({
  calls: 0,
  events: new Map<string, any>(),
}));
vi.mock("../../server/payments/gateway.ts", () => ({
  getPaymentGateway: () => ({
    provider: "t23_local_story",
    supportsPlatformRetention: true,
    createPayment: async (v: any) => {
      billing.calls++;
      return {
        reference: "local-" + v.intentId,
        pixCopyPaste: "LOCAL_STORY_ONLY",
        pixQrCodeBase64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII=",
        hostedPaymentUrl: null,
      };
    },
    verifyAndRetrievePayment: async (input: any) => {
      const p = billing.events.get(input.body.eventId);
      if (!p) throw Error("UNVERIFIED_LOCAL_EVENT");
      return p;
    },
  }),
}));
describe.runIf(!!process.env.HVM_T23_LOCAL_DATABASE_URL)(
  "T23 história: administrador → assinatura → pausa → Pix → banco",
  () => {
    let server: Server,
      baseURL: string,
      catalog: Awaited<ReturnType<typeof checkoutCatalog>>,
      buyer: Awaited<ReturnType<typeof checkoutBuyer>>,
      adminPerson: Awaited<ReturnType<typeof checkoutBuyer>>,
      adminId: string,
      windowId: string;
    const pool = () => dbPool as Pool,
      tokens = new Map<string, string>(),
      planIds: string[] = [];
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
        throw Error("BUILD_REQUIRED_FOR_T23_STORY");
      auth.pool = pool();
      catalog = await checkoutCatalog(pool());
      buyer = await checkoutBuyer(pool(), []);
      adminPerson = await checkoutBuyer(pool(), []);
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
        [adminId, adminPerson.personId, adminId + "@example.test"],
      );
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'platform_super_admin')",
        [adminId],
      );
      windowId = (
        await DeliveryLogisticsService.saveWindow(
          catalog.a.userId,
          null,
          {
            dayOfWeek: 2,
            startTime: "08:00",
            endTime: "12:00",
            maxOrdersCapacity: 15,
            isActive: true,
          },
          randomUUID(),
          checkoutAudit(),
        )
      ).id;
      for (const id of [adminId, buyer.userId, catalog.a.userId])
        await session(id);
      const outer = express();
      const csp = vercel.headers
        .find((x) => x.source === "/(.*)")!
        .headers.find((x) => x.key === "Content-Security-Policy")!.value;
      outer.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", csp);
        next();
      });
      outer.use(["/api", "/_hvm_api"], app);
      outer.use(express.static(resolve("dist")));
      outer.get("*", (_req, res) => res.sendFile(resolve("dist/index.html")));
      server = await new Promise<Server>((resolve) => {
        const s = outer.listen(0, "127.0.0.1", () => resolve(s));
      });
      baseURL = "http://127.0.0.1:" + (server.address() as any).port;
    }, 20000);
    afterAll(async () => {
      try {
        if (server)
          await new Promise<void>((resolve) => server.close(() => resolve()));
        if (adminId)
          await pool().query("DELETE FROM auth.users WHERE id=$1", [adminId]);
        if (buyer) await buyer.cleanup();
        if (adminPerson) await adminPerson.cleanup();
        if (catalog) await catalog.cleanup();
        await pool().query("DELETE FROM app_plans WHERE id=ANY($1::uuid[])", [
          planIds,
        ]);
      } finally {
        await dbPool?.end();
      }
    }, 20000);
    it("planos separados, cadastro real, pausa preserva fatura, Pix único ativa assinatura, trial e telas responsivas", async () => {
      const { chromium, expect: check } = await import("@playwright/test"),
        portable = (await import("@sparticuz/chromium")).default,
        browser = await chromium.launch({
          executablePath: await portable.executablePath(),
          args: ["--disable-gpu", "--no-zygote"],
        });
      const errors: string[] = [];
      async function context(userId: string, role: string) {
        const c = await browser.newContext({
          viewport: { width: 390, height: 950 },
        });
        await c.addCookies([
          {
            name: "hvm_access",
            value: tokens.get(userId)!,
            url: baseURL,
            httpOnly: true,
          },
          { name: "hvm_portal_role", value: role, url: baseURL },
        ]);
        const p = await c.newPage();
        p.on("pageerror", (e) => errors.push(e.message));
        return { c, p };
      }
      const admin = await context(adminId, "platform_super_admin"),
        consumer = await context(buyer.userId, "consumer"),
        producer = await context(catalog.a.userId, "producer");
      try {
        await admin.p.goto(baseURL + "/admin/assinaturas");
        await check(
          admin.p.getByRole("heading", {
            name: "Planos de assinatura",
            exact: true,
          }),
        ).toBeVisible();
        async function createPlan(
          name: string,
          audience: "consumer" | "producer",
          price: string,
        ) {
          await admin.p.getByLabel("Nome do plano", { exact: true }).fill(name);
          await admin.p
            .getByLabel("Identificador", { exact: true })
            .fill("story-" + randomUUID());
          await admin.p
            .getByLabel("Público", { exact: true })
            .selectOption(audience);
          await admin.p
            .getByLabel("Preço por ciclo (R$)", { exact: true })
            .fill(price);
          await admin.p
            .getByLabel("Período da cobrança", { exact: true })
            .selectOption("weekly");
          if (audience === "consumer")
            await admin.p
              .getByLabel("Loja responsável", { exact: true })
              .selectOption(catalog.a.store.id);
          await admin.p
            .getByLabel("Descrição e benefícios", { exact: true })
            .fill("Condições do operador no banco descartável.");
          await admin.p.getByLabel("Disponível para novas assinaturas").check();
          await admin.p
            .getByRole("button", { name: "Salvar plano", exact: true })
            .click();
          await check(
            admin.p.getByRole("status").filter({ hasText: "Plano salvo" }),
          ).toBeVisible();
          const row = (
            await pool().query("SELECT id FROM app_plans WHERE name=$1", [name])
          ).rows[0];
          planIds.push(row.id);
          return row.id as string;
        }
        const free = await createPlan("Cesta gratuita T23", "consumer", "0"),
          paid = await createPlan("Cesta Pix T23", "consumer", "39"),
          producerPlan = await createPlan(
            "Clube produtor T23",
            "producer",
            "49",
          );
        for (const width of [320, 390, 768, 1440]) {
          await admin.p.setViewportSize({ width, height: 950 });
          expect(
            await admin.p.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
          ).toBe(false);
        }
        await consumer.p.goto(baseURL + "/assinaturas");
        await check(
          consumer.p.getByRole("heading", {
            name: "Clube de hortifrúti",
            exact: true,
          }),
        ).toBeVisible();
        await check(
          consumer.p.getByRole("heading", {
            name: "Clube produtor T23",
            exact: true,
          }),
        ).toHaveCount(0);
        async function choose(name: string) {
          await consumer.p
            .locator("article")
            .filter({
              has: consumer.p.getByRole("heading", {
                name,
                exact: true,
                level: 2,
              }),
            })
            .getByRole("button", { name: "Escolher plano" })
            .click();
          await consumer.p
            .getByLabel("Endereço de entrega")
            .selectOption(buyer.addressId);
          await consumer.p
            .getByLabel("Horário preferencial")
            .selectOption(windowId);
          await consumer.p.getByLabel("Cenoura T19", { exact: true }).check();
          await consumer.p
            .getByRole("button", { name: "Confirmar assinatura", exact: true })
            .click();
          await check(
            consumer.p.getByRole("heading", { name, exact: true, level: 3 }),
          ).toBeVisible();
        }
        await choose("Cesta gratuita T23");
        const card = consumer.p
          .locator("article")
          .filter({
            has: consumer.p.getByRole("heading", {
              name: "Cesta gratuita T23",
              exact: true,
              level: 3,
            }),
          });
        await card
          .getByRole("button", { name: "Registrar ciclo gratuito" })
          .click();
        await check(card.getByText(/Ciclo 1/)).toBeVisible();
        const invoice = (
          await pool().query(
            "SELECT to_jsonb(b) AS data FROM app_billing_cycles b JOIN app_subscriptions s ON s.id=b.subscription_id WHERE s.user_id=$1 AND s.plan_id=$2",
            [buyer.userId, free],
          )
        ).rows[0].data;
        await card
          .getByRole("button", { name: "Pausar por até 14 dias" })
          .click();
        await check(card.getByText("Pausada", { exact: true })).toBeVisible();
        expect(
          (
            await pool().query(
              "SELECT to_jsonb(b) AS data FROM app_billing_cycles b WHERE id=$1",
              [invoice.id],
            )
          ).rows[0].data,
        ).toEqual(invoice);
        await card.getByRole("button", { name: "Retomar entregas" }).click();
        await check(
          card.getByRole("button", { name: "Pausar por até 14 dias" }),
        ).toBeDisabled();
        await choose("Cesta Pix T23");
        const paidCard = consumer.p
          .locator("article")
          .filter({
            has: consumer.p.getByRole("heading", {
              name: "Cesta Pix T23",
              exact: true,
              level: 3,
            }),
          });
        await paidCard
          .getByRole("button", { name: "Gerar Pix do ciclo" })
          .click();
        await check(
          consumer.p.getByRole("heading", {
            name: "Pagamento do ciclo da assinatura",
          }),
        ).toBeVisible();
        await check(consumer.p.getByLabel("Pix Copia e Cola")).toHaveValue(
          "LOCAL_STORY_ONLY",
        );
        await consumer.p.getByRole("checkbox").check();
        await consumer.p
          .getByRole("button", { name: "Registrar aceite dos termos" })
          .click();
        await check(
          consumer.p.getByRole("button", { name: "Termos registrados" }),
        ).toBeVisible();
        const intent = (
            await pool().query(
              "SELECT p.* FROM app_payment_intents p JOIN app_billing_cycles b ON b.id=p.billing_cycle_id JOIN app_subscriptions s ON s.id=b.subscription_id WHERE s.user_id=$1 AND s.plan_id=$2",
              [buyer.userId, paid],
            )
          ).rows[0],
          eventId = randomUUID();
        billing.events.set(eventId, {
          provider: "t23_local_story",
          eventId,
          paymentReference: intent.gateway_reference,
          intentId: intent.id,
          status: "approved",
          amountCents: intent.amount_cents,
          currency: "BRL",
          method: "pix",
          paidAt: new Date().toISOString(),
        });
        const approved = await consumer.c.request.post(
          baseURL + "/api/v1/payments/webhook",
          { data: { eventId } },
        );
        expect(approved.status()).toBe(200);
        expect(
          (
            await consumer.c.request.post(
              baseURL + "/api/v1/payments/webhook",
              { data: { eventId } },
            )
          ).status(),
        ).toBe(200);
        await consumer.p.bringToFront();
        await check(consumer.p).toHaveURL(/\/assinaturas\/minhas$/, {
          timeout: 15000,
        });
        await check(
          consumer.p
            .locator("article")
            .filter({
              has: consumer.p.getByRole("heading", {
                name: "Cesta Pix T23",
                exact: true,
                level: 3,
              }),
            })
            .getByText("Ativa", { exact: true }),
        ).toBeVisible();
        expect(billing.calls).toBe(1);
        expect(
          (
            await pool().query(
              "SELECT count(*)::int n FROM app_orders WHERE customer_user_id=$1",
              [buyer.userId],
            )
          ).rows[0].n,
        ).toBe(0);
        await producer.p.goto(baseURL + "/produtor/assinaturas");
        await check(
          producer.p.getByLabel("Período gratuito do produtor"),
        ).toBeVisible();
        await check(
          producer.p.getByRole("heading", {
            name: "Clube produtor T23",
            exact: true,
          }),
        ).toBeVisible();
        await check(
          producer.p.getByRole("heading", {
            name: "Cesta Pix T23",
            exact: true,
          }),
        ).toHaveCount(0);
        await producer.p
          .getByRole("button", { name: "Escolher plano", exact: true })
          .click();
        await check(producer.p.getByLabel("Endereço de entrega")).toHaveCount(
          0,
        );
        await producer.p
          .getByRole("button", { name: "Confirmar assinatura", exact: true })
          .click();
        await check(producer.p.getByRole("heading",{name:"Clube produtor T23",exact:true,level:3})).toBeVisible();
        expect(
          (await SubscriptionService.mine(catalog.a.userId)).subscriptions.find(
            (s) => s.plan.id === producerPlan,
          )?.status,
        ).toBe("trialing");
        for (const width of [320, 390, 768, 1440]) {
          for (const p of [consumer.p, producer.p]) {
            await p.setViewportSize({ width, height: 950 });
            expect(
              await p.evaluate(
                () => document.documentElement.scrollWidth > innerWidth + 1,
              ),
            ).toBe(false);
          }
        }
        const s = (
          await SubscriptionService.mine(buyer.userId)
        ).subscriptions.find((s) => s.plan.id === paid)!;
        expect(s.recurrences[0].preferredWindowId).toBe(windowId);
        expect(s.recurrences[0].basketTemplate).toEqual([catalog.pa]);
        expect(errors).toEqual([]);
        mkdirSync("/workspace/scratch/t23-browser", { recursive: true });
        await consumer.p.screenshot({
          path: "/workspace/scratch/t23-browser/consumer-desktop.png",
          fullPage: true,
        });
        await producer.p.setViewportSize({ width: 390, height: 950 });
        await producer.p.screenshot({
          path: "/workspace/scratch/t23-browser/producer-mobile.png",
          fullPage: true,
        });
      } finally {
        await admin.c.close();
        await consumer.c.close();
        await producer.c.close();
        await browser.close();
      }
    }, 90000);
  },
);
