import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
const auth = vi.hoisted(() => ({ userId: "", token: "" }));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T16_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("T16_LOCAL_DATABASE_REQUIRED");
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
      ipPepper: "t16-local-proof-secret-only",
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
import { DeliveryQuoteService } from "../../server/services/DeliveryQuoteService.ts";
import { app } from "../../server/app.ts";
import { issueRecentAuthProof } from "../../server/security/recentAuth.ts";
import {
  deliveryFixture,
  deliveryAddress,
} from "../helpers/deliveryFixtures.ts";
describe.runIf(Boolean(process.env.HVM_T16_LOCAL_DATABASE_URL))(
  "T16 história completa: configuração → HTTP → PostgreSQL → cotação",
  () => {
    let server: Server,
      baseURL: string,
      fixture: Awaited<ReturnType<typeof deliveryFixture>>;
    const pool = () => dbPool as Pool;
    beforeAll(async () => {
      if (!existsSync("dist/index.html"))
        throw Error("BUILD_REQUIRED_FOR_T16_STORY");
      fixture = await deliveryFixture(pool(), false);
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
    it("salva área/tarifas em mobile e desktop, calcula e protege a cotação real", async () => {
      const before = (
        await pool().query(
          "SELECT to_jsonb(s) AS store,(SELECT to_jsonb(p) FROM app_properties p WHERE p.id=$2) AS property FROM app_producer_stores s WHERE s.id=$1",
          [fixture.store.id, fixture.propertyId],
        )
      ).rows[0];
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
        for (const width of [390, 1440]) {
          await page.setViewportSize({ width, height: 950 });
          await page.goto(baseURL + "/produtor/loja/entrega");
          await browserExpect(
            page.getByRole("heading", {
              name: "Área de entrega e frete",
              exact: true,
            }),
          ).toBeVisible();
          await browserExpect(
            page.getByText("GPS da sede já cadastrado:", { exact: false }),
          ).toContainText("-9.91000");
          await page.getByLabel("Taxa base (R$)", { exact: true }).fill("7.50");
          await page
            .getByLabel("Valor por km (R$)", { exact: true })
            .fill("1.37");
          await page
            .getByLabel("Frete grátis a partir de (R$)", { exact: true })
            .fill("100");
          await page
            .getByRole("button", { name: "Salvar área e tarifas", exact: true })
            .click();
          await browserExpect(
            page
              .getByRole("status")
              .filter({ hasText: "Área de entrega e tarifas salvas" }),
          ).toBeVisible();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          ).toBe(true);
        }
        const config = (
          await pool().query(
            "SELECT a.revision,a.center_latitude,a.center_longitude,r.base_fee_cents,r.fee_per_km_cents FROM app_service_areas a JOIN app_delivery_rules r USING(store_id) WHERE a.store_id=$1",
            [fixture.store.id],
          )
        ).rows[0];
        expect(config).toMatchObject({
          revision: 2,
          base_fee_cents: 750,
          fee_per_km_cents: 137,
        });
        expect(Number(config.center_latitude)).toBe(-9.91);
        const identity = {
          personId: fixture.personId,
          userId: fixture.userId,
          subtotalCents: 3000,
        };
        const q = await DeliveryQuoteService.calculateQuote(
          fixture.store.id,
          fixture.addressId,
          identity,
        );
        expect(q.isEligible).toBe(true);
        expect(q.feeCents).toBe(750 + Math.round(q.distanceKm * 137));
        expect(
          await DeliveryQuoteService.getActiveQuote(
            q.id,
            fixture.personId,
            fixture.userId,
          ),
        ).toEqual(q);
        const free = await DeliveryQuoteService.calculateQuote(
          fixture.store.id,
          fixture.addressId,
          { ...identity, subtotalCents: 10000 },
        );
        expect(free.feeCents).toBe(0);
        const far = await deliveryAddress(
          pool(),
          fixture.personId,
          -8.7612,
          -63.9004,
        );
        const outside = await DeliveryQuoteService.calculateQuote(
          fixture.store.id,
          far,
          identity,
        );
        expect(outside).toMatchObject({
          isEligible: false,
          ineligibilityReason: "fora_da_area_de_entrega",
        });
        await pool().query(
          "UPDATE app_delivery_quotes SET created_at=clock_timestamp()-interval '16 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
          [q.id],
        );
        await expect(
          DeliveryQuoteService.getActiveQuote(
            q.id,
            fixture.personId,
            fixture.userId,
          ),
        ).rejects.toMatchObject({ code: "DELIVERY_QUOTE_EXPIRED" });
        expect(
          (
            await pool().query(
              "SELECT to_jsonb(s) AS store,(SELECT to_jsonb(p) FROM app_properties p WHERE p.id=$2) AS property FROM app_producer_stores s WHERE s.id=$1",
              [fixture.store.id, fixture.propertyId],
            )
          ).rows[0],
        ).toEqual(before);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
        await browser.close();
      }
    }, 60000);
  },
);
