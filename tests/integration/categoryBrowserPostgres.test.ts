import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
const auth = vi.hoisted(() => ({ userId: "", sessionId: "", token: "" }));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T13_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("T13_LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
// Only Supabase Auth's external getUser is adapted. Real HTTP middleware,
// Zod, CategoryService, PostgreSQL/RLS and the built React application run here.
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: null,
  createSupabasePublicClient: () => ({
    auth: {
      getUser: async (token: string) => ({
        data: {
          user:
            token === auth.token
              ? {
                  id: auth.userId,
                  email_confirmed_at: "2026-01-01T00:00:00Z",
                  last_sign_in_at: new Date().toISOString(),
                }
              : null,
        },
        error: null,
      }),
    },
  }),
}));
import { dbPool } from "../../server/db/pool.ts";
import { categoryRouter } from "../../server/routes/categoryRoutes.ts";
import { adminSessionMiddleware } from "../../server/middleware/adminSession.ts";
describe.runIf(Boolean(process.env.HVM_T13_LOCAL_DATABASE_URL))(
  "T13 história completa: navegador → API real → PostgreSQL → navegador",
  () => {
    let server: Server, baseURL: string, categoryId: string | undefined;
    const pool = () => dbPool as Pool;
    beforeAll(async () => {
      if (!existsSync("dist/index.html"))
        throw new Error("BUILD_REQUIRED_FOR_T13_STORY");
      auth.userId = randomUUID();
      auth.sessionId = randomUUID();
      auth.token = "header." + Buffer.from(JSON.stringify({ session_id: auth.sessionId })).toString("base64url") + ".local-auth-adapter";
      const personId = randomUUID();
      await pool().query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
        [auth.userId, auth.userId + "@example.test"],
      );
      await pool().query(
        "INSERT INTO app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,'Super Admin local',$3,$4,'+5569999999999')",
        [
          personId,
          auth.userId,
          String(Math.floor(Math.random() * 1e11)).padStart(11, "0"),
          auth.userId + "@example.test",
        ],
      );
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'platform_super_admin')",
        [auth.userId],
      );
      await pool().query(
        "INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role) VALUES($1,$2,$3,'platform_super_admin')",
        [auth.userId, personId, auth.userId + "@example.test"],
      );
      await pool().query("INSERT INTO auth.sessions(id,user_id,created_at) VALUES($1,$2,now())", [auth.sessionId, auth.userId]);
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        req.requestId = randomUUID();
        req.clientIpHash = "c".repeat(64);
        res.locals.requestId = req.requestId;
        next();
      });
      for (const prefix of ["/api/v1", "/_hvm_api/v1"]) {
        app.get(prefix + "/config", (_req, res) =>
          res.json({
            platformName: "HortiVitalMix",
            slogan: "Tudo fresco. Tudo da sua região.",
            defaultMunicipality: "Ariquemes",
            defaultState: "RO",
            currency: "BRL",
            timezone: "America/Porto_Velho",
            supportEmail: "support@example.test",
            supportPhone: null,
            revision: 1,
          }),
        );
        app.get(prefix + "/auth/session", (_req, res) =>
          res.status(401).json({ error: "AUTH_REQUIRED" }),
        );
        app.get(prefix + "/localities", (_req, res) =>
          res.json({ municipalities: [], activeMunicipalityIds: [] }),
        );
        app.get(
          prefix + "/admin/auth/verify-session",
          adminSessionMiddleware,
          (req, res) =>
            res.json({
              authorized: true,
              role: req.adminActor!.role,
              sectors: req.adminActor!.sectors,
              requiresReauth: false,
            }),
        );
        app.use(prefix, categoryRouter);
      }
      app.use(express.static(resolve("dist")));
      app.get("*", (_req, res) => res.sendFile(resolve("dist/index.html")));
      server = await new Promise<Server>((resolveServer) => {
        const listener = app.listen(0, "127.0.0.1", () =>
          resolveServer(listener),
        );
      });
      baseURL =
        "http://127.0.0.1:" + (server.address() as { port: number }).port;
    });
    afterAll(async () => {
      try {
        if (categoryId)
          await pool().query("DELETE FROM app_categories WHERE id=$1", [
            categoryId,
          ]);
        if (server)
          await new Promise<void>((done) => server.close(() => done()));
      } finally {
        await dbPool?.end();
      }
    });
    it("cria, edita slug, desativa e reativa com auditoria e menu público reais", async () => {
      const { chromium, expect: browserExpect } =
          await import("@playwright/test"),
        portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        args: portable.args,
      });
      const context = await browser.newContext({
        viewport: { width: 390, height: 900 },
      });
      const page = await context.newPage();
      const errors: string[] = [];
      const responses: Array<{ path: string; status: number }> = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => {
        if (response.url().includes("/v1/"))
          responses.push({
            path: new URL(response.url()).pathname,
            status: response.status(),
          });
      });
      try {
        await page.addInitScript((accessToken: string) =>
          localStorage.setItem(
            "hvm.admin.session",
            JSON.stringify({
              accessToken,
              refreshToken: "local-only",
              expiresAt: Date.now() + 3600000,
            }),
          ),
          auth.token,
        );
        await page.goto(baseURL + "/admin/categorias");
        await browserExpect
          .poll(() =>
            page
              .getByRole("heading", { name: "Categorias", exact: true })
              .count(),
          )
          .toBe(1);
        const name = "Categoria local " + randomUUID();
        await page.getByLabel("Nome", { exact: true }).fill(name);
        await page.getByLabel("Ordem de exibição").fill("50");
        await page
          .getByRole("button", { name: "Criar categoria", exact: true })
          .click();
        await browserExpect
          .poll(() =>
            page
              .getByText(
                "Categoria salva. A alteração foi registrada na auditoria.",
              )
              .count(),
          )
          .toBe(1);
        categoryId = (
          await pool().query("SELECT id FROM app_categories WHERE name=$1", [
            name,
          ])
        ).rows[0].id;
        const editedSlug = "alterada-" + randomUUID();
        await page.getByLabel("Slug", { exact: false }).fill(editedSlug);
        await page.getByRole("button", { name: "Salvar alterações" }).click();
        await browserExpect
          .poll(
            async () =>
              (
                await pool().query(
                  "SELECT slug FROM app_categories WHERE id=$1",
                  [categoryId],
                )
              ).rows[0].slug,
          )
          .toBe(editedSlug);
        await page
          .getByRole("button", { name: "Desativar " + name, exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Confirmar desativação" })
          .click();
        await browserExpect
          .poll(
            async () =>
              (
                await pool().query(
                  "SELECT is_active FROM app_categories WHERE id=$1",
                  [categoryId],
                )
              ).rows[0].is_active,
          )
          .toBe(false);
        const publicResponse = await fetch(baseURL + "/_hvm_api/v1/categories");
        expect(publicResponse.status).toBe(200);
        expect((await publicResponse.json()).categories).toHaveLength(5);
        const publicPage = await context.newPage();
        publicPage.on("pageerror", (error) => errors.push(error.message));
        publicPage.on("response", (response) => {
          if (response.url().includes("/v1/"))
            responses.push({
              path: "public:" + new URL(response.url()).pathname,
              status: response.status(),
            });
        });
        publicPage.on("requestfailed", (request) =>
          errors.push(
            "public_request_failed:" +
              new URL(request.url()).pathname +
              ":" +
              request.failure()?.errorText,
          ),
        );
        await publicPage.goto(baseURL + "/");
        await browserExpect
          .poll(() =>
            publicPage
              .getByRole("navigation", { name: "Categorias de produtos" })
              .getByRole("button")
              .count(),
          )
          .toBe(6);
        expect(
          await publicPage.getByRole("button", { name, exact: true }).count(),
        ).toBe(0);
        await page
          .getByRole("button", { name: "Reativar " + name, exact: true })
          .click();
        await browserExpect
          .poll(
            async () =>
              (
                await pool().query(
                  "SELECT is_active FROM app_categories WHERE id=$1",
                  [categoryId],
                )
              ).rows[0].is_active,
          )
          .toBe(true);
        await publicPage.reload();
        await browserExpect
          .poll(() =>
            publicPage.getByRole("button", { name, exact: true }).count(),
          )
          .toBe(1);
        await publicPage.getByRole("button", { name, exact: true }).click();
        await browserExpect
          .poll(() =>
            publicPage.getByRole("heading", { name, exact: true }).count(),
          )
          .toBe(1);
        expect(
          (
            await pool().query(
              "SELECT action FROM app_audit_events WHERE target_id=$1 ORDER BY occurred_at",
              [categoryId],
            )
          ).rows.map((row) => row.action),
        ).toEqual([
          "category.created",
          "category.updated",
          "category.deactivated",
          "category.reactivated",
        ]);
        expect(errors).toEqual([]);
      } catch (error) {
        console.error(
          JSON.stringify({
            url: page.url(),
            text: (await page.locator("body").innerText()).slice(0, 1200),
            errors,
            responses,
          }),
        );
        throw error;
      } finally {
        await browser.close();
      }
    }, 60000);
  },
);
