import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import type { Pool } from "pg";
import type { Page } from "@playwright/test";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  users: new Map<string, { id: string; email: string }>(),
  pool: null as Pool | null,
}));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_NOTIFICATIONS_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const u = new URL(value);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55432" ||
    u.pathname !== "/postgres"
  )
    throw Error("NOTIFICATIONS_LOCAL_DATABASE_REQUIRED");
  const pg = (await import("pg")).default;
  return { dbPool: new pg.Pool({ connectionString: value, max: 8 }) };
});
import vercel from "../../vercel.json" with { type: "json" };
import { app } from "../../server/app.ts";
import { dbPool } from "../../server/db/pool.ts";
import { reviewFixtures } from "../helpers/reviewFixtures.ts";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
describe.runIf(!!process.env.HVM_NOTIFICATIONS_LOCAL_DATABASE_URL)(
  "História completa das correções: quatro papéis, venda, reembolso privado, avisos e cesta",
  () => {
    let f: Awaited<ReturnType<typeof reviewFixtures>>,
      order: Awaited<
        ReturnType<Awaited<ReturnType<typeof reviewFixtures>>["paid"]>
      >,
      root: AdminActorContext,
      refundAdmin: AdminActorContext,
      complaintAdmin: AdminActorContext,
      server: Server,
      baseURL: string;
    const pool = () => dbPool as Pool,
      tokens = new Map<string, string>();
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
        throw Error("BUILD_REQUIRED_FOR_NOTIFICATIONS_STORY");
      auth.pool = pool();
      f = await reviewFixtures(pool());
      order = await f.paid();
      root = await f.admin();
      refundAdmin = await f.admin("platform_admin", false);
      complaintAdmin = await f.admin("platform_admin", true);
      await pool().query(
        "INSERT INTO app_admin_sector_members(user_id,sector_code) VALUES($1,'refund_management')",
        [refundAdmin.userId],
      );
      refundAdmin.sectors = ["refund_management"];
      for (const id of [
        order.b.userId,
        f.catalog.a.userId,
        root.userId,
        refundAdmin.userId,
        complaintAdmin.userId,
      ])
        await session(id);
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
    it("tela → HTTP → PostgreSQL → tela, isolamento por papel, leitura persistente e quatro larguras", async () => {
      const { chromium, expect: check } = await import("@playwright/test"),
        portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
          executablePath: await portable.executablePath(),
          args: ["--disable-gpu", "--no-zygote"],
        }),
        errors: string[] = [],
        directory = "/workspace/scratch/corrections-story",
        contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
      mkdirSync(directory, { recursive: true });
      async function context(userId: string, role: string) {
        const c = await browser.newContext({
          viewport: { width: 390, height: 950 },
        });
        contexts.push(c);
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
        return p;
      }
      async function api(
        page: Page,
        path: string,
        method = "GET",
        body?: unknown,
      ) {
        return page.evaluate(
          async ({ path, method, body }) => {
            const r = await fetch("/api/v1" + path, {
              method,
              headers: body
                ? {
                    "Content-Type": "application/json",
                    "X-Command-Id": crypto.randomUUID(),
                  }
                : undefined,
              body: body ? JSON.stringify(body) : undefined,
            });
            return { status: r.status, body: await r.json() };
          },
          { path, method, body },
        );
      }
      async function responsive(page: Page, name: string) {
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 950 });
          const overflow = await page.evaluate(() =>
            Array.from(document.querySelectorAll("body *"))
              .map((e) => ({
                tag: e.tagName,
                cls: e.className,
                x: e.getBoundingClientRect().x,
                right: e.getBoundingClientRect().right,
              }))
              .filter((e) => e.right > innerWidth + 1 || e.x < -1),
          );
          if (
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            )
          ) {
            writeFileSync(
              directory + `/overflow-${name}-${width}.json`,
              JSON.stringify(overflow, null, 2),
            );
            await page.screenshot({
              path: directory + `/overflow-${name}-${width}.png`,
              fullPage: true,
            });
          }
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
            name + " width " + width,
          ).toBe(false);
          if (width === 320 || width === 1440)
            await page.screenshot({
              path: directory + `/${name}-${width}.png`,
              fullPage: true,
            });
        }
        await page.setViewportSize({ width: 390, height: 950 });
      }
      try {
        const consumer = await context(order.b.userId, "consumer"),
          producer = await context(f.catalog.a.userId, "producer"),
          admin = await context(refundAdmin.userId, "platform_admin"),
          superAdmin = await context(root.userId, "platform_super_admin"),
          complaint = await context(complaintAdmin.userId, "platform_admin");
        await producer.goto(baseURL + "/conta");
        await check(
          producer.getByRole("button", { name: /^Minhas vendas/ }),
        ).toBeVisible();
        await check(
          producer.getByRole("button", { name: /^Minhas compras/ }),
        ).toHaveCount(0);
        await check(
          producer.getByRole("button", { name: /^Acompanhar pedido/ }),
        ).toHaveCount(0);
        expect((await api(producer, "/commerce/purchases")).status).toBe(403);
        await producer.goto(baseURL + "/compras");
        await check(
          producer.getByRole("heading", { name: "Compras para consumidores" }),
        ).toBeVisible();
        await check(
          producer.getByRole("button", {
            name: "Cadastrar-se como consumidor",
          }),
        ).toBeVisible();
        await producer.goto(baseURL + "/produtor/vendas?orderId=" + order.id);
        await check(
          producer.getByRole("heading", { name: "Minhas vendas", exact: true }),
        ).toBeVisible();
        await check(
          producer.getByRole("button", { name: "Gerenciar pedido da loja" }),
        ).toBeVisible();
        await check(
          producer.getByRole("button", {
            name: "Caixa do produtor",
            exact: true,
          }),
        ).toBeVisible();
        await responsive(producer, "vendas");
        await producer
          .getByRole("button", { name: "Gerenciar pedido da loja" })
          .click();
        await check(
          producer.getByRole("heading", { name: "Pedidos da minha loja" }),
        ).toBeVisible();
        expect(
          (await api(producer, "/producer/orders?orderId=" + order.id)).body
            .orders[0].id,
        ).toBe(order.id);
        await consumer.goto(baseURL + "/reembolsos?orderId=" + order.id);
        await check(
          consumer.getByRole("heading", { name: "Meus reembolsos" }),
        ).toBeVisible();
        await check(
          consumer.getByRole("combobox", { name: "Compra", exact: true }),
        ).toHaveValue(order.id);
        await consumer.getByLabel("Valor solicitado (R$)").fill("1,00");
        await consumer
          .getByLabel("Descreva o que aconteceu")
          .fill(
            "Relato sigiloso do consumidor na história real de testes locais.",
          );
        await consumer
          .getByRole("button", { name: "Enviar solicitação" })
          .click();
        await check(
          consumer.getByText(
            "Solicitação registrada. O repasse permanece bloqueado durante a análise.",
          ),
        ).toBeVisible();
        const refund = (
          await pool().query(
            "SELECT id FROM app_refund_requests WHERE order_id=$1",
            [order.id],
          )
        ).rows[0];
        expect(refund.id).toBeTruthy();
        await consumer
          .getByLabel("Adicionar informação", { exact: true })
          .fill("Conversa sigilosa entre consumidor e administração.");
        await consumer
          .getByRole("button", { name: "Enviar mensagem", exact: true })
          .click();
        await check(
          consumer.getByText("Mensagem enviada à solicitação."),
        ).toBeVisible();
        await admin.goto(baseURL + "/admin/reembolsos?caseId=" + refund.id);
        await check(
          admin.getByRole("heading", { name: "Gestão de reembolsos" }),
        ).toBeVisible();
        await check(admin.getByLabel("Orientação ao vendedor")).toBeVisible();
        await admin
          .getByLabel("Orientação ao vendedor")
          .fill("Orientação exclusiva da administração para o vendedor.");
        await admin.getByRole("button", { name: "Enviar ao vendedor" }).click();
        await check(
          admin.getByText("Contato registrado para o vendedor acompanhar."),
        ).toBeVisible();
        await admin
          .getByLabel("Justificativa e orientação ao solicitante")
          .fill("Nota privada da análise administrativa neste atendimento.");
        await admin.getByRole("button", { name: "Registrar decisão" }).click();
        await check(
          admin.getByText("Decisão registrada com autor e data no histórico."),
        ).toBeVisible();
        await responsive(admin, "admin-reembolso");
        await producer.goto(
          baseURL + "/produtor/reembolsos?caseId=" + refund.id,
        );
        await check(
          producer.getByRole("heading", {
            name: "Reembolsos das minhas vendas",
          }),
        ).toBeVisible();
        await check(
          producer.getByText(
            "Orientação exclusiva da administração para o vendedor.",
            { exact: true },
          ),
        ).toBeVisible();
        for (const text of [
          "Relato sigiloso",
          "Conversa sigilosa",
          "Nota privada",
        ])
          expect(await producer.locator("body").innerText()).not.toContain(
            text,
          );
        await check(producer.locator("textarea")).toHaveCount(0);
        await check(
          producer.getByRole("button", { name: "Registrar decisão" }),
        ).toHaveCount(0);
        await responsive(producer, "produtor-reembolso");
        await complaint.goto(baseURL + "/admin/notificacoes");
        const privateView = await api(
          producer,
          "/commerce/refunds/" + refund.id,
        );
        expect(privateView.status).toBe(403);
        expect(
          (await api(complaint, "/admin/commerce/refunds/" + refund.id)).status,
        ).toBe(403);
        for (const [page, path, label, name] of [
          [consumer, "/notificacoes", "Consumidor", "consumidor"],
          [producer, "/notificacoes", "Produtor", "produtor"],
          [admin, "/admin/notificacoes", "Administrador", "administrador"],
          [
            superAdmin,
            "/admin/notificacoes",
            "Super administrador",
            "superadministrador",
          ],
        ] as const) {
          await page.goto(baseURL + path);
          await check(
            page.getByRole("heading", { name: "Notificações", exact: true }),
          ).toBeVisible();
          await check(
            page.locator(".hvm-notifications .eyebrow").first(),
          ).toHaveText(label);
          await check(
            page.locator(".hvm-notification-list li").first(),
          ).toBeVisible();
          await responsive(page, "notificacoes-" + name);
        }
        await producer
          .getByRole("combobox", { name: "Assunto", exact: true })
          .selectOption("refunds");
        await check(
          producer
            .locator(".hvm-notification-list h2")
            .filter({ hasText: "Contato da administração" }),
        ).toBeVisible();
        const contactRow = producer
          .locator(".hvm-notification-list li")
          .filter({
            has: producer.getByRole("heading", {
              name: "Contato da administração",
              exact: true,
            }),
          });
        await contactRow
          .getByRole("button", { name: "Ver atualização" })
          .click();
        await check(
          producer.getByText(
            "Orientação exclusiva da administração para o vendedor.",
            { exact: true },
          ),
        ).toBeVisible();
        const contacts = (
          await pool().query(
            "SELECT read_at FROM app_notifications WHERE recipient_user_id=$1 AND title='Contato da administração'",
            [f.catalog.a.userId],
          )
        ).rows;
        expect(contacts[0].read_at).not.toBeNull();
        await consumer.goto(baseURL + "/notificacoes");
        await check(
          consumer.getByRole("button", { name: "Marcar todas como lidas" }),
        ).toBeEnabled();
        await consumer
          .getByRole("button", { name: "Marcar todas como lidas" })
          .click();
        await check(
          consumer.getByRole("button", { name: "Não lidas (0)" }),
        ).toBeVisible();
        expect(
          (
            await pool().query(
              "SELECT count(*)::int n FROM app_notifications WHERE recipient_user_id=$1 AND recipient_role='consumer' AND read_at IS NULL",
              [order.b.userId],
            )
          ).rows[0].n,
        ).toBe(0);
        await consumer.goto(baseURL + "/carrinho");
        await check(
          consumer.getByRole("heading", { name: "Minha cesta", exact: true }),
        ).toBeVisible();
        expect(
          (
            await api(consumer, "/cart/items", "POST", {
              productId: f.catalog.pa,
              quantity: 1,
              commandId: randomUUID(),
            })
          ).status,
        ).toBe(200);
        await consumer.reload();
        const badge = consumer
          .getByRole("button", { name: "Carrinho", exact: true })
          .locator(".hvm-cart-count");
        await check(badge).toHaveText("1");
        await consumer
          .getByRole("button", { name: "Aumentar Cenoura T19", exact: true })
          .click();
        await check(
          consumer
            .getByRole("group", {
              name: "Quantidade de Cenoura T19",
              exact: true,
            })
            .locator("span"),
        ).toHaveText("2");
        await check(badge).toHaveText("1");
        expect(
          (
            await api(consumer, "/cart/items", "POST", {
              productId: f.catalog.pb,
              quantity: 3,
              commandId: randomUUID(),
            })
          ).status,
        ).toBe(200);
        await consumer.reload();
        await check(badge).toHaveText("2");
        const cart = (await api(consumer, "/cart")).body;
        expect(cart.itemCount).toBe(2);
        expect(
          cart.stores
            .flatMap((s: any) => s.items)
            .reduce((n: number, i: any) => n + i.quantity, 0),
        ).toBe(5);
        expect(errors).toEqual([]);
        writeFileSync(
          directory + "/evidence.json",
          JSON.stringify(
            {
              story:
                "Browser → actual Express/services → local PostgreSQL → browser; auth/Data API transport adapter only",
              roles: [
                "consumer",
                "producer",
                "platform_admin",
                "platform_super_admin",
              ],
              widths: [320, 390, 768, 1440],
              saleLinkedToStoreOrders: true,
              producerRequiresConsumerRegistration: true,
              sellerRefundReadOnly: true,
              privateConversationPreserved: true,
              administrativeContactVisible: true,
              notificationReadPersisted: true,
              cartDistinctOptions: 2,
              cartQuantity: 5,
              pageErrors: errors,
            },
            null,
            2,
          ),
        );
      } finally {
        for (const c of contexts) await c.close();
        await browser.close();
      }
    }, 180000);
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
      ipPepper: "corrections-local-story-proof",
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
