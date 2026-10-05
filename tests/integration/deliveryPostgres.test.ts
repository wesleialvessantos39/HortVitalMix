import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T16_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("T16_LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
import { dbPool } from "../../server/db/pool.ts";
import { DeliveryQuoteService } from "../../server/services/DeliveryQuoteService.ts";
import {
  deliveryFixture,
  deliveryAddress,
  deliveryCommand,
  deliveryAudit,
} from "../helpers/deliveryFixtures.ts";
import { haversineKm } from "../../shared/contracts/delivery.ts";
import manifest from "../../supabase/manifest.json" with { type: "json" };
const pool = () => dbPool as Pool,
  users: string[] = [];
async function fixture(configure = true) {
  const f = await deliveryFixture(pool(), configure);
  users.push(f.userId);
  return f;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const quote = (f: Fixture, addressId = f.addressId, subtotalCents = 3000) =>
  DeliveryQuoteService.calculateQuote(f.store.id, addressId, {
    personId: f.personId,
    userId: f.userId,
    subtotalCents,
  });
const active = (f: Fixture, id: string) =>
  DeliveryQuoteService.getActiveQuote(id, f.personId, f.userId);
async function asRole(
  role: string,
  sql: string,
  values: unknown[] = [],
  userId?: string,
) {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL ROLE ${role}`);
    if (userId)
      await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
        userId,
      ]);
    return await c.query(sql, values);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
describe.runIf(Boolean(process.env.HVM_T16_LOCAL_DATABASE_URL))(
  "T16 PostgreSQL real, segurança e cotações",
  () => {
    beforeAll(async () =>
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations",
          )
        ).rows[0].n,
      ).toBe(manifest.migrations.length),
    );
    afterAll(async () => {
      for (const id of users)
        await pool().query("DELETE FROM auth.users WHERE id=$1", [id]);
      await dbPool?.end();
    });
    it("Haversine SQL coincide com referência independente e é imutável", async () => {
      const r = (
        await pool().query(
          "SELECT fn_haversine_km(-9.9133,-63.0408,-8.7612,-63.9004) AS km, fn_haversine_km(0,0,0,0) AS zero,fn_haversine_km(0,0,0,180) AS antipode",
        )
      ).rows[0];
      // City centers are ~159 km geodesic; ~200 km is the road approximation in the manual.
      expect(Number(r.km)).toBeCloseTo(159.0814, 3);
      expect(Number(r.km)).toBeCloseTo(
        haversineKm(-9.9133, -63.0408, -8.7612, -63.9004),
        8,
      );
      expect(Number(r.zero)).toBe(0);
      expect(Number(r.antipode)).toBeCloseTo(20015.0868, 3);
      expect(
        (
          await pool().query(
            "SELECT provolatile,prosecdef FROM pg_proc WHERE oid='fn_haversine_km(numeric,numeric,numeric,numeric)'::regprocedure",
          )
        ).rows[0],
      ).toEqual({ provolatile: "i", prosecdef: false });
    });
    it("grava a sede T08, sem tocar no imóvel, loja ou cobertura T12", async () => {
      const f = await fixture(false),
        before = (
          await pool().query(
            "SELECT to_jsonb(s) AS store,(SELECT to_jsonb(p) FROM app_properties p WHERE p.id=$2) AS property FROM app_producer_stores s WHERE s.id=$1",
            [f.store.id, f.propertyId],
          )
        ).rows[0];
      const s = await DeliveryQuoteService.saveOwnerSettings(
        f.personId,
        f.userId,
        deliveryCommand(),
        deliveryAudit(),
      );
      expect(s.origin?.centerLatitude).toBe(-9.91);
      expect(s.serviceArea?.centerLongitude).toBe(-63.04);
      expect(s.revision).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT to_jsonb(s) AS store,(SELECT to_jsonb(p) FROM app_properties p WHERE p.id=$2) AS property FROM app_producer_stores s WHERE s.id=$1",
            [f.store.id, f.propertyId],
          )
        ).rows[0],
      ).toEqual(before);
    });
    it("frete exato em centavos, validade de 15 min e mínimo informativo", async () => {
      const f = await fixture(),
        q = await quote(f, f.addressId, 0);
      expect(q.isEligible).toBe(true);
      expect(q.feeCents).toBe(500 + Math.round(q.distanceKm * 100));
      expect(q.minOrderCents).toBe(2000);
      const ttl = (
        await pool().query(
          "SELECT extract(epoch FROM expires_at-created_at)::int AS seconds FROM app_delivery_quotes WHERE id=$1",
          [q.id],
        )
      ).rows[0].seconds;
      expect(ttl).toBe(900);
      expect(await active(f, q.id)).toEqual(q);
    });
    it("fora do raio retorna elegibilidade amigável e não é consumível", async () => {
      const f = await fixture(),
        a = await deliveryAddress(pool(), f.personId, -8.7612, -63.9004),
        q = await quote(f, a);
      expect(q.isEligible).toBe(false);
      expect(q.ineligibilityReason).toBe("fora_da_area_de_entrega");
      expect(q.feeCents).toBe(0);
      await expect(active(f, q.id)).rejects.toMatchObject({
        code: "DELIVERY_QUOTE_INELIGIBLE",
      });
    });
    it("o limite usa distância integral, antes do arredondamento da exibição", async () => {
      const f = await fixture(false);
      await DeliveryQuoteService.saveOwnerSettings(
        f.personId,
        f.userId,
        deliveryCommand({ radiusKm: 10 }),
        deliveryAudit(),
      );
      const a = await deliveryAddress(
          pool(),
          f.personId,
          -9.91 + 10.001 / ((6371 * Math.PI) / 180),
          -63.04,
        ),
        q = await quote(f, a);
      expect(q.distanceKm).toBe(10);
      expect(q.isEligible).toBe(false);
    });
    it("frete grátis a partir do limiar, sem liberar destino fora da área", async () => {
      const f = await fixture(false),
        input = deliveryCommand();
      input.rules.freeDeliveryThresholdCents = 10000;
      await DeliveryQuoteService.saveOwnerSettings(
        f.personId,
        f.userId,
        input,
        deliveryAudit(),
      );
      expect((await quote(f, f.addressId, 9999)).feeCents).toBeGreaterThan(0);
      expect((await quote(f, f.addressId, 10000)).feeCents).toBe(0);
      expect((await quote(f, f.addressId, 10001)).feeCents).toBe(0);
      expect(
        (
          await quote(
            f,
            await deliveryAddress(pool(), f.personId, -8.76, -63.9),
            100000,
          )
        ).isEligible,
      ).toBe(false);
    });
    it("distância zero mantém taxa base e tarifa fracionária arredonda uma vez", async () => {
      const f = await fixture(false),
        input = deliveryCommand();
      input.rules.feePerKmCents = 137;
      await DeliveryQuoteService.saveOwnerSettings(
        f.personId,
        f.userId,
        input,
        deliveryAudit(),
      );
      expect(
        (
          await quote(
            f,
            await deliveryAddress(pool(), f.personId, -9.91, -63.04),
          )
        ).feeCents,
      ).toBe(500);
      const q = await quote(f);
      expect(q.feeCents).toBe(500 + Math.round(q.distanceKm * 137));
    });
    it("endereço sem coordenadas falha sem criar cotação", async () => {
      const f = await fixture(),
        a = await deliveryAddress(pool(), f.personId, null, null);
      await expect(quote(f, a)).rejects.toMatchObject({
        code: "DELIVERY_ADDRESS_GPS_REQUIRED",
      });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS n FROM app_delivery_quotes WHERE destination_address_id=$1",
            [a],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("endereço de outra pessoa e identidade forjada são rejeitados", async () => {
      const f = await fixture(),
        other = await fixture();
      await expect(quote(f, other.addressId)).rejects.toMatchObject({
        code: "DELIVERY_ADDRESS_NOT_FOUND",
      });
      await expect(
        DeliveryQuoteService.calculateQuote(f.store.id, f.addressId, {
          personId: f.personId,
          userId: other.userId,
          subtotalCents: 3000,
        }),
      ).rejects.toMatchObject({ code: "DELIVERY_ADDRESS_NOT_FOUND" });
      const q = await quote(f);
      await expect(active(other, q.id)).rejects.toMatchObject({
        code: "DELIVERY_QUOTE_NOT_FOUND",
      });
    });
    it("cotação expirada é recusada pelo consumidor interno", async () => {
      const f = await fixture(),
        q = await quote(f);
      await pool().query(
        "UPDATE app_delivery_quotes SET created_at=clock_timestamp()-interval '16 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
        [q.id],
      );
      await expect(active(f, q.id)).rejects.toMatchObject({
        code: "DELIVERY_QUOTE_EXPIRED",
      });
    });
    it("cotação que vence enquanto aguarda a loja não pode ser consumida", async () => {
      const f = await fixture(),
        q = await quote(f),
        holder = await pool().connect();
      await pool().query(
        "UPDATE app_delivery_quotes SET expires_at=clock_timestamp()+interval '0.2 seconds' WHERE id=$1",
        [q.id],
      );
      try {
        await holder.query("BEGIN");
        await holder.query(
          "SELECT id FROM app_producer_stores WHERE id=$1 FOR UPDATE",
          [f.store.id],
        );
        const result = active(f, q.id).then(
          (value) => ({ value, error: null }),
          (error) => ({ value: null, error }),
        );
        await new Promise((done) => setTimeout(done, 400));
        await holder.query("COMMIT");
        expect((await result).error).toMatchObject({
          code: "DELIVERY_QUOTE_EXPIRED",
        });
      } finally {
        await holder.query("ROLLBACK");
        holder.release();
      }
    });
    it("mudança de regra invalida cotações anteriores", async () => {
      const f = await fixture(),
        q = await quote(f);
      await DeliveryQuoteService.saveOwnerSettings(
        f.personId,
        f.userId,
        deliveryCommand({ expectedRevision: 1, radiusKm: 20 }),
        deliveryAudit(),
      );
      await expect(active(f, q.id)).rejects.toMatchObject({
        code: "DELIVERY_QUOTE_STALE",
      });
    });
    it("mudança de coordenada do endereço invalida a cotação", async () => {
      const f = await fixture(),
        q = await quote(f);
      await pool().query(
        "UPDATE app_user_addresses SET latitude=-9.96 WHERE id=$1",
        [f.addressId],
      );
      await expect(active(f, q.id)).rejects.toMatchObject({
        code: "DELIVERY_QUOTE_STALE",
      });
    });
    it("preserva o GPS homologado e recusa uma origem em cache desatualizada", async () => {
      const f = await fixture(),
        q = await quote(f);
      await expect(
        pool().query(
          "UPDATE app_properties SET latitude_sede=-9.92 WHERE id=$1",
          [f.propertyId],
        ),
      ).rejects.toMatchObject({
        message: "VERIFIED_PROPERTY_REHOMOLOGATION_REQUIRED",
      });
      await pool().query(
        "UPDATE app_service_areas SET center_latitude=-9.92 WHERE store_id=$1",
        [f.store.id],
      );
      await expect(quote(f)).rejects.toMatchObject({
        code: "DELIVERY_CONFIGURATION_STALE",
      });
      await expect(active(f, q.id)).rejects.toMatchObject({
        code: "DELIVERY_CONFIGURATION_STALE",
      });
      await DeliveryQuoteService.saveOwnerSettings(
        f.personId,
        f.userId,
        deliveryCommand({ expectedRevision: 1 }),
        deliveryAudit(),
      );
      expect((await quote(f)).isEligible).toBe(true);
    });
    it("loja pausada ou área desabilitada não gera cotação", async () => {
      const f = await fixture(false);
      await DeliveryQuoteService.saveOwnerSettings(
        f.personId,
        f.userId,
        deliveryCommand({ isActive: false }),
        deliveryAudit(),
      );
      await expect(quote(f)).rejects.toMatchObject({
        code: "DELIVERY_UNAVAILABLE",
      });
      await pool().query(
        "UPDATE app_producer_stores SET status='paused' WHERE id=$1",
        [f.store.id],
      );
      await expect(
        DeliveryQuoteService.saveOwnerSettings(
          f.personId,
          f.userId,
          deliveryCommand({ expectedRevision: 1 }),
          deliveryAudit(),
        ),
      ).rejects.toMatchObject({ code: "DELIVERY_ORIGIN_REQUIRED" });
    });
    it("configuração idempotente não duplica revisão ou auditoria", async () => {
      const f = await fixture(false),
        input = deliveryCommand(),
        a = await DeliveryQuoteService.saveOwnerSettings(
          f.personId,
          f.userId,
          input,
          deliveryAudit(),
        );
      expect(
        await DeliveryQuoteService.saveOwnerSettings(
          f.personId,
          f.userId,
          input,
          deliveryAudit(),
        ),
      ).toEqual(a);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS n FROM app_audit_events WHERE command_id=$1",
            [input.commandId],
          )
        ).rows[0].n,
      ).toBe(1);
      await expect(
        DeliveryQuoteService.saveOwnerSettings(
          f.personId,
          f.userId,
          { ...input, radiusKm: 20 },
          deliveryAudit(),
        ),
      ).rejects.toMatchObject({ code: "DELIVERY_COMMAND_CONFLICT" });
    });
    it("concorrência de revisão salva um único comando", async () => {
      const f = await fixture(),
        r = await Promise.allSettled(
          [10, 20].map((radiusKm) =>
            DeliveryQuoteService.saveOwnerSettings(
              f.personId,
              f.userId,
              deliveryCommand({ expectedRevision: 1, radiusKm }),
              deliveryAudit(),
            ),
          ),
        );
      expect(r.filter((v) => v.status === "fulfilled")).toHaveLength(1);
      expect(r.find((v) => v.status === "rejected")).toMatchObject({
        reason: { code: "DELIVERY_REVISION_CONFLICT" },
      });
    });
    it("falha na auditoria reverte atomicamente área e regras", async () => {
      const f = await fixture(false);
      await expect(
        DeliveryQuoteService.saveOwnerSettings(
          f.personId,
          f.userId,
          deliveryCommand(),
          { requestId: randomUUID(), ipHash: "invalid" },
        ),
      ).rejects.toMatchObject({ code: "DELIVERY_VALIDATION_FAILED" });
      expect(
        (
          await pool().query(
            "SELECT (SELECT count(*) FROM app_service_areas WHERE store_id=$1)::int AS a,(SELECT count(*) FROM app_delivery_rules WHERE store_id=$1)::int AS r",
            [f.store.id],
          )
        ).rows[0],
      ).toEqual({ a: 0, r: 0 });
    });
    it("replay revalida papel e conta, sem inferir pessoa do payload", async () => {
      const f = await fixture(false),
        input = deliveryCommand();
      await DeliveryQuoteService.saveOwnerSettings(
        f.personId,
        f.userId,
        input,
        deliveryAudit(),
      );
      await pool().query(
        "UPDATE app_user_role_assignments SET revoked_at=now() WHERE user_id=$1 AND role_code='producer'",
        [f.userId],
      );
      await expect(
        DeliveryQuoteService.saveOwnerSettings(
          f.personId,
          f.userId,
          input,
          deliveryAudit(),
        ),
      ).rejects.toMatchObject({ code: "PRODUCER_PROFILE_REQUIRED" });
    });
    it("RLS obrigatório e grants sem mutação autenticada ou privilégios DDL", async () => {
      const rows = (
        await pool().query(
          "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('app_service_areas','app_delivery_rules','app_delivery_quotes')",
        )
      ).rows;
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.relrowsecurity && row.relforcerowsecurity).toBe(true);
        for (const privilege of [
          "INSERT",
          "UPDATE",
          "DELETE",
          "TRUNCATE",
          "REFERENCES",
          "TRIGGER",
        ])
          expect(
            (
              await pool().query(
                "SELECT has_table_privilege('authenticated',$1,$2) AS allowed",
                [row.relname, privilege],
              )
            ).rows[0].allowed,
          ).toBe(false);
        for (const privilege of ["TRUNCATE", "REFERENCES", "TRIGGER"])
          expect(
            (
              await pool().query(
                "SELECT has_table_privilege('service_role',$1,$2) AS allowed",
                [row.relname, privilege],
              )
            ).rows[0].allowed,
          ).toBe(false);
      }
    });
    it("somente o dono do endereço lê a cotação; produtor de outra loja não lê", async () => {
      const f = await fixture(),
        other = await fixture(),
        q = await quote(f);
      expect(
        (
          await asRole(
            "authenticated",
            "SELECT id FROM app_delivery_quotes WHERE id=$1",
            [q.id],
            f.userId,
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await asRole(
            "authenticated",
            "SELECT id FROM app_delivery_quotes WHERE id=$1",
            [q.id],
            other.userId,
          )
        ).rows,
      ).toHaveLength(0);
      await expect(
        asRole("anon", "SELECT * FROM app_delivery_quotes"),
      ).rejects.toMatchObject({ code: "42501" });
      for (const table of ["app_service_areas", "app_delivery_rules"])
        await expect(
          asRole("authenticated", `SELECT * FROM ${table}`, [], f.userId),
        ).rejects.toMatchObject({ code: "42501" });
    });
    it("cotação entre lojas é legível pelo consumidor do endereço, não pelo produtor da origem", async () => {
      const producer = await fixture(),
        consumer = await fixture();
      const q = await DeliveryQuoteService.calculateQuote(
        producer.store.id,
        consumer.addressId,
        {
          personId: consumer.personId,
          userId: consumer.userId,
          subtotalCents: 3000,
        },
      );
      expect(q.isEligible).toBe(true);
      expect(
        (
          await asRole(
            "authenticated",
            "SELECT id FROM app_delivery_quotes WHERE id=$1",
            [q.id],
            consumer.userId,
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await asRole(
            "authenticated",
            "SELECT id FROM app_delivery_quotes WHERE id=$1",
            [q.id],
            producer.userId,
          )
        ).rows,
      ).toHaveLength(0);
      await expect(
        DeliveryQuoteService.getActiveQuote(
          q.id,
          producer.personId,
          producer.userId,
        ),
      ).rejects.toMatchObject({ code: "DELIVERY_QUOTE_NOT_FOUND" });
    });
    it("edição do logradouro sem mudar GPS também invalida cotação", async () => {
      const f = await fixture(),
        q = await quote(f);
      await pool().query(
        "UPDATE app_user_addresses SET street='Rua atualizada' WHERE id=$1",
        [f.addressId],
      );
      await expect(active(f, q.id)).rejects.toMatchObject({
        code: "DELIVERY_QUOTE_STALE",
      });
    });
    it("backend privilegiado calcula distância e insere, sem atualizar cotações", async () => {
      expect(
        Number(
          (await asRole("service_role", "SELECT fn_haversine_km(0,0,0,0) AS d"))
            .rows[0].d,
        ),
      ).toBe(0);
      await expect(
        asRole("authenticated", "SELECT fn_haversine_km(0,0,0,0)"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        asRole("service_role", "UPDATE app_delivery_quotes SET fee_cents=0"),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("aceita transação externa e rollback remove cotação", async () => {
      const f = await fixture(),
        client = await pool().connect();
      let id: string;
      try {
        await client.query("BEGIN");
        id = (
          await DeliveryQuoteService.calculateQuote(
            f.store.id,
            f.addressId,
            { personId: f.personId, userId: f.userId, subtotalCents: 3000 },
            client,
          )
        ).id;
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      expect(
        (
          await pool().query("SELECT 1 FROM app_delivery_quotes WHERE id=$1", [
            id!,
          ])
        ).rowCount,
      ).toBe(0);
    });
    it("exclusão de endereço T07 continua operacional e apaga sua cotação", async () => {
      const f = await fixture(),
        q = await quote(f);
      await pool().query("DELETE FROM app_user_addresses WHERE id=$1", [
        f.addressId,
      ]);
      expect(
        (
          await pool().query("SELECT 1 FROM app_delivery_quotes WHERE id=$1", [
            q.id,
          ])
        ).rowCount,
      ).toBe(0);
    });
    it("exclusão de conta T06 remove área, regras e cotações sem bloquear módulos antigos", async () => {
      const f = await fixture(),
        q = await quote(f);
      await pool().query("DELETE FROM auth.users WHERE id=$1", [f.userId]);
      expect(
        (
          await pool().query(
            "SELECT (SELECT count(*) FROM app_service_areas WHERE store_id=$1)::int AS a,(SELECT count(*) FROM app_delivery_rules WHERE store_id=$1)::int AS r,(SELECT count(*) FROM app_delivery_quotes WHERE id=$2)::int AS q",
            [f.store.id, q.id],
          )
        ).rows[0],
      ).toEqual({ a: 0, r: 0, q: 0 });
    });
  },
);
