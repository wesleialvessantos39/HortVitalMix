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
  const value = process.env.HVM_T25_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const u = new URL(value);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55432" ||
    u.pathname !== "/postgres"
  )
    throw Error("T25_LOCAL_DATABASE_REQUIRED");
  const pg = (await import("pg")).default;
  return { dbPool: new pg.Pool({ connectionString: value, max: 8 }) };
});
import vercel from "../../vercel.json" with { type: "json" };
import { app } from "../../server/app.ts";
import { dbPool } from "../../server/db/pool.ts";
import { reviewFixtures } from "../helpers/reviewFixtures.ts";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";

import { issueRecentAuthProof } from "../../server/security/recentAuth.ts";
import { OrderService } from "../../server/services/OrderService.ts";
import { checkoutAudit } from "../helpers/checkoutFixtures.ts";
vi.mock("../../server/config/runtime.ts", async (original) => {
  const actual =
    await original<typeof import("../../server/config/runtime.ts")>();
  return {
    ...actual,
    runtime: {
      ...actual.runtime,
      appEnv: "development",
      ipPepper: "t25-local-story-proof",
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
describe.runIf(!!process.env.HVM_T25_LOCAL_DATABASE_URL)(
  "T25 história real: avião → IndexedDB → HTTP → PostgreSQL → BI",
  () => {
    let f: Awaited<ReturnType<typeof reviewFixtures>>,
      a: Awaited<
        ReturnType<Awaited<ReturnType<typeof reviewFixtures>>["paid"]>
      >,
      b: typeof a,
      root: AdminActorContext,
      sectorAdmin: AdminActorContext,
      server: Server,
      baseURL: string;
    const tokens = new Map<string, string>();
    const pool = () => dbPool as Pool;
    async function session(uid: string) {
      const id = randomUUID();
      await pool().query(
        "INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",
        [id, uid],
      );
      const token =
        "local." +
        Buffer.from(JSON.stringify({ session_id: id })).toString("base64url") +
        ".local";
      tokens.set(uid, token);
      auth.users.set(token, { id: uid, email: uid + "@example.test" });
    }
    beforeAll(async () => {
      if (!existsSync("dist/offline-worker.js"))
        throw Error("BUILD_REQUIRED_FOR_T25_STORY");
      auth.pool = pool();
      f = await reviewFixtures(pool());
      a = await f.paid();
      b = await f.paid();
      await f.delivered();
      root = await f.admin();
      sectorAdmin = await f.admin("platform_admin", true);
      for (const uid of [
        f.catalog.a.userId,
        f.catalog.b.userId,
        a.b.userId,
        root.userId,
        sectorAdmin.userId,
      ])
        await session(uid);
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
        await pool().query("DELETE FROM app_kpi_metrics");
      } finally {
        await dbPool?.end();
      }
    }, 20000);
    it("cache estático não guarda APIs; ações sobrevivem reload, conflitos isolados e KPI via painel", async () => {
      const { chromium, expect: check } = await import("@playwright/test"),
        portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
          executablePath: await portable.executablePath(),
          args: ["--disable-gpu", "--no-zygote"],
        }),
        errors: string[] = [];
      const directory =
        process.env.HVM_T25_STORY_SCREENSHOTS ?? "/workspace/scratch/t25-story";
      mkdirSync(directory, { recursive: true });
      async function cookies(context: any, uid: string, role: string) {
        await context.addCookies([
          {
            name: "hvm_access",
            value: tokens.get(uid)!,
            url: baseURL,
            httpOnly: true,
          },
          { name: "hvm_portal_role", value: role, url: baseURL },
          {
            name: "hvm_reauth",
            value: issueRecentAuthProof(uid, tokens.get(uid)!),
            url: baseURL,
            httpOnly: true,
          },
        ]);
      }
      async function actor(uid: string, role: string) {
        const c = await browser.newContext({
          viewport: { width: 390, height: 920 },
        });
        await cookies(c, uid, role);
        const page = await c.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        return page;
      }
      async function request(
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
                ? { "Content-Type": "application/json" }
                : undefined,
              body: body ? JSON.stringify(body) : undefined,
            });
            return { status: r.status, body: await r.json() };
          },
          { path, method, body },
        );
      }
      async function queued(page: Page) {
        return page.evaluate(
          () =>
            new Promise<any[]>((resolve, reject) => {
              const r = indexedDB.open("hvm-rural-v1");
              r.onsuccess = () => {
                const db = r.result;
                const read = db
                  .transaction("pending_commands")
                  .objectStore("pending_commands")
                  .getAll();
                read.onsuccess = () => {
                  db.close();
                  resolve(
                    read.result.sort(
                      (a: any, b: any) => a.sequence - b.sequence,
                    ),
                  );
                };
                read.onerror = () => reject(read.error);
              };
              r.onerror = () => reject(r.error);
            }),
        );
      }
      async function responsive(page: Page, name: string) {
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 920 });
          await page.evaluate(() => scrollTo(0, 0));
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          ).toBe(true);
          const banner = page.getByRole("complementary", {
            name: "Conexão e ações do produtor",
          });
          if (await banner.count()) {
            await page.evaluate(() => scrollTo(0, 600));
            await check.poll(() => banner.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              return bounds.top >= 0 && bounds.bottom <= innerHeight;
            })).toBe(true);
            await page.evaluate(() => scrollTo(0, 0));
          }
          await page.screenshot({
            path: directory + `/${name}-${width}.png`,
            fullPage: true,
          });
        }
      }
      try {
        const producer = await actor(f.catalog.a.userId, "producer");
        let replay: any;
        producer.on("request", (r) => {
          if (r.url().endsWith("/producer/sync") && r.method() === "POST")
            replay = r.postDataJSON();
        });
        await producer.goto(baseURL + "/produtor/pedidos");
        await check(
          producer.getByRole("heading", {
            name: "Pedidos da minha loja",
            exact: true,
          }),
        ).toBeVisible();
        await check(producer.locator(".order-card")).toHaveCount(3);
        const aNumber = (
            await OrderService.get(a.id, f.catalog.a.userId, "producer")
          ).orderNumber,
          bNumber = (
            await OrderService.get(b.id, f.catalog.a.userId, "producer")
          ).orderNumber;
        await producer.goto(
          baseURL + `/produtor/produtos/${f.catalog.pa}/lotes`,
        );
        await check(
          producer.getByRole("button", {
            name: "Registrar colheita",
            exact: true,
          }),
        ).toBeEnabled();
        await producer.waitForFunction(
          () => !!navigator.serviceWorker.controller,
          undefined,
          { timeout: 20000 },
        );
        const cacheKeys = await producer.evaluate(async () => {
          const names = (await caches.keys()).filter((k) =>
            k.startsWith("hvm-rural-assets-"),
          );
          const keys = [];
          for (const name of names)
            for (const r of await (await caches.open(name)).keys())
              keys.push(new URL(r.url).pathname);
          return keys;
        });
        expect(cacheKeys.length).toBeGreaterThan(10);
        expect(
          cacheKeys.some(
            (k) =>
              k !== "/index.html" && !/^\/assets\/[^/]+\.(js|css)$/.test(k),
          ),
        ).toBe(false);
        // An already open tab may still request a chunk from the previous
        // build after a worker update. Only its cached static asset is served.
        await producer.evaluate(async () => {
          const prior = await caches.open("hvm-rural-assets-previous-test");
          await prior.put("/assets/t25-previous-build.js", new Response(
            "/* previous static build */", { headers: { "Content-Type": "application/javascript" } },
          ));
        });
        await producer.context().setOffline(true);
        expect(await producer.evaluate(async () => (await fetch(
          "/assets/t25-previous-build.js",
        )).text())).toBe("/* previous static build */");
        await check(
          producer.getByText(/Modo offline — 0 ações pendentes/),
        ).toBeVisible();
        await producer.getByLabel("Código do lote").fill("OFFLINE-STORY-T25");
        await producer.getByLabel("Quantidade", { exact: true }).fill("7");
        await producer
          .getByRole("button", { name: "Registrar colheita", exact: true })
          .click();
        await check(
          producer.getByText(
            "Colheita salva neste aparelho; aguardando sincronização e confirmação do servidor.",
          ),
        ).toBeVisible();
        await check.poll(async () => (await queued(producer)).length).toBe(1);
        expect(
          (
            await pool().query(
              "select count(*)::int n from app_inventory_lots where lot_code='OFFLINE-STORY-T25'",
            )
          ).rows[0].n,
        ).toBe(0);
        await producer.reload();
        await check(
          producer.getByRole("heading", {
            name: "Lotes e colheitas",
            exact: true,
          }),
        ).toBeVisible();
        await check(
          producer.getByRole("button", {
            name: "Registrar colheita",
            exact: true,
          }),
        ).toBeEnabled();
        await check(
          producer.getByText(/Modo offline — 1 ação pendente/),
        ).toBeVisible();
        await responsive(producer, "offline-harvest");
        await producer.goto(baseURL + "/produtor/pedidos");
        await check(producer.locator(".order-card")).toHaveCount(3);
        for (const number of [aNumber, bNumber])
          await producer
            .locator(".order-card")
            .filter({
              has: producer.getByRole("heading", { name: number, exact: true }),
            })
            .getByRole("button", { name: "Iniciar preparo" })
            .click();
        await check.poll(async () => (await queued(producer)).length).toBe(3);
        const original = (await queued(producer)).map((v) => v.command);
        expect(JSON.stringify(await queued(producer))).not.toMatch(
          /hvm_access|hvm_reauth|password|accessToken|refreshToken/,
        );
        await OrderService.cancelOrder(
          a.id,
          f.catalog.a.userId,
          "Cancelamento em outra sessão isolada",
          1,
          randomUUID(),
          checkoutAudit(),
        );
        await producer.reload();
        await check(
          producer.getByText(/Modo offline — 3 ações pendentes/),
        ).toBeVisible();
        await check(
          producer
            .locator(".order-card")
            .filter({
              has: producer.getByRole("heading", {
                name: bNumber,
                exact: true,
              }),
            })
            .getByRole("button", { name: "Iniciar preparo" }),
        ).toBeDisabled();
        await producer.context().setOffline(false);
        await check
          .poll(
            async () =>
              (
                await pool().query(
                  "select count(*)::int n from app_sync_command_journal",
                )
              ).rows[0].n,
            { timeout: 20000 },
          )
          .toBe(3);
        await check.poll(async () => (await queued(producer)).length).toBe(1);
        await check(
          producer.getByText(/Ações aguardando confirmação — 0 ações pendentes/),
        ).toBeVisible();
        const remaining = await queued(producer);
        expect(remaining[0].result).toMatchObject({
          status: "conflict",
          conflictDetails: { status: "cancelled", revision: 2 },
        });
        expect(
          (
            await pool().query(
              "select count(*)::int n from app_inventory_lots where lot_code='OFFLINE-STORY-T25'",
            )
          ).rows[0].n,
        ).toBe(1);
        expect(
          (await OrderService.get(b.id, f.catalog.a.userId, "producer")).status,
        ).toBe("in_preparation");
        await producer
          .getByRole("button", { name: "Revisar ações", exact: true })
          .click();
        await check(producer.getByText(/O servidor mudou/)).toBeVisible();
        await responsive(producer, "conflict-orders");
        const before = (
          await pool().query(
            "select (select count(*) from app_order_events)::int events,(select count(*) from app_inventory_lots)::int lots,(select count(*) from app_notifications)::int notices",
          )
        ).rows[0];
        const response = await request(producer, "/producer/sync", "POST", {
          deviceFingerprint: replay.deviceFingerprint,
          commands: original,
        });
        expect(response.status).toBe(200);
        expect(response.body.results.map((v: any) => v.status)).toEqual([
          "confirmed",
          "conflict",
          "confirmed",
        ]);
        expect(
          (
            await pool().query(
              "select (select count(*) from app_order_events)::int events,(select count(*) from app_inventory_lots)::int lots,(select count(*) from app_notifications)::int notices",
            )
          ).rows[0],
        ).toEqual(before);
        // Same device storage, different authenticated account: no other user's queue
        // or cached orders are rendered or sent by the new producer.
        await cookies(producer.context(), f.catalog.b.userId, "producer");
        await producer.goto(baseURL + "/produtor/pedidos");
        await check(producer.getByRole("complementary",{name:"Conexão e ações do produtor"})).toHaveCount(0);
        await check(producer.getByRole("complementary",{name:"Ações aguardando confirmação"})).toHaveCount(0);
        expect(
          await producer
            .getByRole("button", { name: "Revisar ações", exact: true })
            .count(),
        ).toBe(0);
        expect((await queued(producer))[0].userId).toBe(f.catalog.a.userId);
        const consumer = await actor(a.b.userId, "consumer");
        await consumer.goto(baseURL + "/conta");
        expect(await consumer.locator(".hvm-offline-banner").count()).toBe(0);
        expect(
          (
            await request(consumer, "/producer/sync", "POST", {
              deviceFingerprint: "isolated-other-device",
              commands: original,
            })
          ).status,
        ).toBe(403);
        const executive = await actor(root.userId, "platform_super_admin");
        await executive.goto(baseURL + "/admin/bi");
        await check(
          executive.getByRole("heading", { name: "BI executivo", exact: true }),
        ).toBeVisible();
        await check(executive.getByText("Não calculado").first()).toBeVisible();
        const today = (
          await pool().query(
            "select (clock_timestamp() at time zone timezone)::date::text today from app_global_config where singleton_guard",
          )
        ).rows[0].today;
        await executive.getByLabel("Data inicial").fill(today);
        await executive.getByLabel("Data final").fill(today);
        await executive
          .getByRole("button", { name: "Consultar período", exact: true })
          .click();
        await check(
          executive.getByRole("button", {
            name: "Calcular período",
            exact: true,
          }),
        ).toBeEnabled();
        await executive
          .getByRole("button", { name: "Calcular período", exact: true })
          .click();
        await check(
          executive.getByText(/Métricas calculadas e salvas/),
        ).toBeVisible();
        await check(
          executive.getByText(/1 de 1 dias calculados/),
        ).toBeVisible();
        const rows = (
          await pool().query(
            "select kpi_code,metric_value::float8 value from app_kpi_metrics where reference_date=$1 order by kpi_code",
            [today],
          )
        ).rows;
        expect(rows).toHaveLength(8);
        expect(rows.find((v) => v.kpi_code === "delivered_orders")!.value).toBe(
          1,
        );
        expect(
          rows.find((v) => v.kpi_code === "gmv_cents")!.value,
        ).toBeGreaterThan(0);
        await executive
          .getByRole("button", { name: "Calcular período", exact: true })
          .click();
        await check(
          executive.getByRole("button", {
            name: "Calcular período",
            exact: true,
          }),
        ).toBeEnabled();
        expect(
          (
            await pool().query(
              "select kpi_code,metric_value::float8 value from app_kpi_metrics where reference_date=$1 order by kpi_code",
              [today],
            )
          ).rows,
        ).toEqual(rows);
        await responsive(executive, "executive-bi");
        expect(
          (
            await request(
              consumer,
              "/admin/bi?startDate=" + today + "&endDate=" + today,
            )
          ).status,
        ).toBe(401);
        const adminPage = await actor(sectorAdmin.userId, "platform_admin");
        await adminPage.goto(baseURL + "/admin/painel");
        expect(
          (
            await request(
              adminPage,
              "/admin/bi?startDate=" + today + "&endDate=" + today,
            )
          ).status,
        ).toBe(403);
        expect(errors).toEqual([]);
        writeFileSync(
          directory + "/result.json",
          JSON.stringify(
            {
              story:
                "browser → IndexedDB → HTTP → PostgreSQL → browser; BI via Super Admin",
              offlineReload: true,
              immutableRetry: true,
              perItemConflict: true,
              queueAccountIsolation: true,
              apiNeverCached: true,
              widths: [320, 390, 768, 1440],
              pageErrors: errors,
            },
            null,
            2,
          ),
        );
      } finally {
        await browser.close();
      }
    }, 120000);
  },
);
