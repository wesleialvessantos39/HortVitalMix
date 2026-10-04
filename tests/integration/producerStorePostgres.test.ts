import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

// This suite uses an empty, disposable local PostgreSQL bootstrapped with ALL
// repository migrations. It never accepts a Supabase or non-loopback URL.
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T12_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("T12_LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
import { dbPool } from "../../server/db/pool.ts";
import { ProducerStoreService } from "../../server/services/ProducerStoreService.ts";
import type { StoreOwner } from "../../shared/contracts/producerStore.ts";

const pool = () => dbPool as Pool;
const context = () => ({ requestId: randomUUID(), ipHash: "a".repeat(64) });
const command = (store: StoreOwner) => ({
  expectedRevision: store.revision,
  commandId: randomUUID(),
});
const settings = (store: StoreOwner, propertyId: string) => ({
  ...command(store),
  propertyId,
  storeName: "Chácara Boa Colheita",
  storeSlug: "chacara-" + randomUUID(),
  bio: "Produção local com cuidado e colheita responsável.",
  minOrderAmountCents: 2000,
  cutoffHour: "14:00",
});
async function fixture(verification = "verified", trust = 2) {
  const userId = randomUUID(),
    personId = randomUUID(),
    profileId = randomUUID(),
    propertyId = randomUUID(),
    requestId = randomUUID();
  await pool().query(
    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
    [userId, userId + "@example.test"],
  );
  await pool().query(
    "INSERT INTO public.app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,$3,$4,$5,'+5569999999999')",
    [
      personId,
      userId,
      "Produtor " + personId,
      String(Math.floor(Math.random() * 1e11)).padStart(11, "0"),
      userId + "@example.test",
    ],
  );
  await pool().query(
    "INSERT INTO public.app_user_role_assignments(user_id,role_code) VALUES($1,'producer')",
    [userId],
  );
  await pool().query(
    "INSERT INTO public.app_producer_profiles(id,person_id,verification_status,trust_level) VALUES($1,$2,$3,$4)",
    [profileId, personId, verification, trust],
  );
  await pool().query(
    `INSERT INTO public.app_properties(id,producer_id,property_name,municipality,state,line_vicinal,
    status,wizard_current_step,total_area_hectares,cultivated_area_hectares,rural_zone_sector,latitude_sede,longitude_sede,water_source,irrigation_system)
    VALUES($1,$2,'Chácara Boa Colheita','Ariquemes','RO','Linha C-65','verified',6,10,4,'Gleba Jamari',-9.91,-63.04,'poco_artesiano','gotejamento')`,
    [propertyId, profileId],
  );
  await pool().query(
    "INSERT INTO public.app_verification_requests(id,property_id,producer_id,status,archived_at) VALUES($1,$2,$3,'approved',now())",
    [requestId, propertyId, profileId],
  );
  await pool().query(
    `INSERT INTO public.app_verification_decisions(request_id,auditor_id,decision,technical_opinion,assigned_trust_level,
    checklist_environmental_ok,checklist_land_tenure_ok,checklist_water_quality_ok) VALUES($1,$2,'approved','Homologação técnica de teste local.',2,true,true,true)`,
    [requestId, userId],
  );
  const store = await ProducerStoreService.getOrCreateDraftStore(
    userId,
    randomUUID(),
    context(),
  );
  const saved = await ProducerStoreService.saveStoreSettings(
    store.id,
    userId,
    settings(store, propertyId),
    context(),
  );
  return { userId, personId, profileId, propertyId, requestId, store: saved };
}
async function asRole(
  role: "anon" | "authenticated",
  userId: string | null,
  query: string,
  values: unknown[] = [],
) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      userId ?? "",
    ]);
    await client.query(
      role === "anon" ? "SET LOCAL ROLE anon" : "SET LOCAL ROLE authenticated",
    );
    return await client.query(query, values);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

describe.runIf(Boolean(process.env.HVM_T12_LOCAL_DATABASE_URL))(
  "T12 PostgreSQL real e regressão da base",
  () => {
    beforeAll(async () => {
      await pool().query(
        "INSERT INTO public.app_municipalities(ibge_code,name,name_normalized,state) VALUES('1100023','Ariquemes','ariquemes','RO') ON CONFLICT DO NOTHING",
      );
      const result = await pool().query(
        "SELECT count(*)::int AS count FROM supabase_migrations.schema_migrations",
      );
      expect(result.rows[0].count).toBe(52);
    });
    afterAll(async () => {
      await dbPool?.end();
    });
    it.each([
      ["declared", 2],
      ["verified", 1],
    ])("não publica perfil %s / confiança %i", async (status, trust) => {
      const f = await fixture(status as string, trust as number);
      await expect(
        ProducerStoreService.publishStore(
          f.store.id,
          f.userId,
          command(f.store),
          context(),
        ),
      ).rejects.toMatchObject({ code: "STORE_PUBLISH_FORBIDDEN", status: 403 });
      expect(
        (await ProducerStoreService.getStoreSettings(f.userId)).store?.status,
      ).toBe("draft");
    });
    it("publica homologado, responde somente com campos públicos e permite pausa/reabertura", async () => {
      const f = await fixture();
      const opened = await ProducerStoreService.publishStore(
        f.store.id,
        f.userId,
        command(f.store),
        context(),
      );
      const view = await ProducerStoreService.getPublicStore(opened.storeSlug);
      expect(view.verification).toEqual({ isVerified: true, trustLevel: 2 });
      for (const key of [
        "cpf",
        "phone",
        "email",
        "propertyId",
        "producerProfileId",
        "personId",
      ])
        expect(view).not.toHaveProperty(key);
      const paused = await ProducerStoreService.pauseStore(
        opened.id,
        f.userId,
        { ...command(opened), reason: "Chuva forte" },
        context(),
      );
      await expect(
        ProducerStoreService.getPublicStore(paused.storeSlug),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (
          await ProducerStoreService.publishStore(
            paused.id,
            f.userId,
            command(paused),
            context(),
          )
        ).status,
      ).toBe("active");
    });
    it("sanitiza a bio antes de persistir e rejeita bio composta só por script", async () => {
      const f = await fixture();
      const input = {
        ...settings(f.store, f.propertyId),
        bio: "<script>alert(1)</script>Produção <b>local</b> com cuidado.",
      };
      const saved = await ProducerStoreService.saveStoreSettings(
        f.store.id,
        f.userId,
        input,
        context(),
      );
      expect(saved.bio).toBe("Produção local com cuidado.");
      const result = await pool().query(
        "SELECT bio_clean FROM public.app_producer_stores WHERE id=$1",
        [saved.id],
      );
      expect(result.rows[0].bio_clean).toBe(saved.bio);
      await expect(
        ProducerStoreService.saveStoreSettings(
          saved.id,
          f.userId,
          {
            ...settings(saved, f.propertyId),
            bio: "<script>alert(1)</script>",
          },
          context(),
        ),
      ).rejects.toMatchObject({ code: "STORE_BIO_INVALID" });
    });
    it("slug duplicado falha e preserva a primeira loja", async () => {
      const a = await fixture(),
        b = await fixture();
      await expect(
        ProducerStoreService.saveStoreSettings(
          b.store.id,
          b.userId,
          { ...settings(b.store, b.propertyId), storeSlug: a.store.storeSlug },
          context(),
        ),
      ).rejects.toMatchObject({ status: 409, code: "STORE_SLUG_CONFLICT" });
      expect(
        (await ProducerStoreService.getStoreSettings(a.userId)).store
          ?.storeSlug,
      ).toBe(a.store.storeSlug);
      expect(
        (await ProducerStoreService.getStoreSettings(b.userId)).store?.revision,
      ).toBe(b.store.revision);
    });
    it("dois saves simultâneos têm um sucesso e um conflito", async () => {
      const f = await fixture();
      const responses = await Promise.allSettled([
        ProducerStoreService.saveStoreSettings(
          f.store.id,
          f.userId,
          settings(f.store, f.propertyId),
          context(),
        ),
        ProducerStoreService.saveStoreSettings(
          f.store.id,
          f.userId,
          settings(f.store, f.propertyId),
          context(),
        ),
      ]);
      expect(
        responses.filter((response) => response.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        responses.find((response) => response.status === "rejected"),
      ).toMatchObject({
        reason: { code: "STORE_REVISION_CONFLICT", status: 409 },
      });
    });
    it("replay concorrente grava uma única revisão/auditoria e rejeita payload diferente", async () => {
      const f = await fixture(),
        input = settings(f.store, f.propertyId);
      const results = await Promise.all([
        ProducerStoreService.saveStoreSettings(
          f.store.id,
          f.userId,
          input,
          context(),
        ),
        ProducerStoreService.saveStoreSettings(
          f.store.id,
          f.userId,
          input,
          context(),
        ),
      ]);
      expect(results[0].revision).toBe(results[1].revision);
      const audit = await pool().query(
        "SELECT count(*)::int AS count FROM public.app_audit_events WHERE command_id=$1",
        [input.commandId],
      );
      expect(audit.rows[0].count).toBe(1);
      await expect(
        ProducerStoreService.saveStoreSettings(
          f.store.id,
          f.userId,
          { ...input, storeName: "Outra loja" },
          context(),
        ),
      ).rejects.toMatchObject({ code: "STORE_COMMAND_CONFLICT" });
    });
    it("criação concorrente e repetição não duplicam loja nem sete dias", async () => {
      const f = await fixture();
      const stores = await Promise.all(
        Array.from({ length: 3 }, () =>
          ProducerStoreService.getOrCreateDraftStore(
            f.userId,
            randomUUID(),
            context(),
          ),
        ),
      );
      expect(new Set(stores.map((store) => store.id)).size).toBe(1);
      expect(stores[0].operatingHours).toHaveLength(7);
    });
    it("horários atualizam os sete dias na mesma revisão e na mesma transação do formulário", async () => {
      const f = await fixture();
      const days = f.store.operatingHours.map((day) => ({
        ...day,
        cutoffTime: "12:30",
        isHarvestDay: day.dayOfWeek < 5,
      }));
      const saved = await ProducerStoreService.saveStoreSettings(
        f.store.id,
        f.userId,
        { ...settings(f.store, f.propertyId), operatingHours: days },
        context(),
      );
      expect(saved.revision).toBe(f.store.revision + 1);
      expect(saved.operatingHours).toEqual(days);
      const updated = await ProducerStoreService.updateOperatingHours(
        saved.id,
        f.userId,
        { ...command(saved), days: f.store.operatingHours },
        context(),
      );
      expect(updated.revision).toBe(saved.revision + 1);
    });
    it("RLS: anon só vê ativa elegível; titular vê pausada e horários; outro titular não", async () => {
      const f = await fixture(),
        other = await fixture();
      const count = async (
        role: "anon" | "authenticated",
        userId: string | null,
      ) =>
        (
          await asRole(
            role,
            userId,
            "SELECT id FROM public.app_producer_stores WHERE id=$1",
            [f.store.id],
          )
        ).rowCount;
      expect(await count("anon", null)).toBe(0);
      expect(await count("authenticated", f.userId)).toBe(1);
      expect(await count("authenticated", other.userId)).toBe(0);
      const active = await ProducerStoreService.publishStore(
        f.store.id,
        f.userId,
        command(f.store),
        context(),
      );
      expect(await count("anon", null)).toBe(1);
      expect(
        (
          await asRole(
            "anon",
            null,
            "SELECT day_of_week FROM public.app_store_operating_hours WHERE store_id=$1",
            [f.store.id],
          )
        ).rowCount,
      ).toBe(7);
      await ProducerStoreService.pauseStore(
        active.id,
        f.userId,
        { ...command(active), reason: "Chuva" },
        context(),
      );
      expect(await count("anon", null)).toBe(0);
      expect(
        (
          await asRole(
            "authenticated",
            f.userId,
            "SELECT day_of_week FROM public.app_store_operating_hours WHERE store_id=$1",
            [f.store.id],
          )
        ).rowCount,
      ).toBe(7);
    });
    it("anon/authenticated não possuem mutação direta e não acessam a função de elegibilidade privada", async () => {
      const f = await fixture();
      for (const role of ["anon", "authenticated"] as const) {
        await expect(
          asRole(
            role,
            f.userId,
            "UPDATE public.app_producer_stores SET status='active' WHERE id=$1",
            [f.store.id],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          asRole(
            role,
            f.userId,
            "SELECT hvm_store_private.property_is_eligible($1,$2)",
            [f.profileId, f.propertyId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      }
    });
    it("outro titular não altera loja nem pode vincular imóvel alheio", async () => {
      const f = await fixture(),
        other = await fixture();
      await expect(
        ProducerStoreService.saveStoreSettings(
          f.store.id,
          other.userId,
          settings(f.store, other.propertyId),
          context(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        ProducerStoreService.saveStoreSettings(
          f.store.id,
          f.userId,
          settings(f.store, other.propertyId),
          context(),
        ),
      ).rejects.toMatchObject({ status: 404, code: "PROPERTY_NOT_FOUND" });
    });
    it.each([
      "coverage",
      "account",
      "profile",
      "property_block",
      "region_block",
      "approval",
      "delivery_scope",
    ])(
      "revogação de %s oculta imediatamente a loja já publicada",
      async (kind) => {
        const f = await fixture();
        const active = await ProducerStoreService.publishStore(
          f.store.id,
          f.userId,
          command(f.store),
          context(),
        );
        const client = await pool().connect();
        try {
          await client.query("BEGIN");
          if (kind === "coverage")
            await client.query(
              "UPDATE public.app_municipalities SET is_active=false,deactivated_at=now(),deactivated_by=$1 WHERE ibge_code='1100023'",
              [f.userId],
            );
          if (kind === "account")
            await client.query(
              "UPDATE public.app_users SET status='suspended' WHERE id=$1",
              [f.userId],
            );
          if (kind === "profile")
            await client.query(
              "UPDATE public.app_producer_profiles SET trust_level=1 WHERE id=$1",
              [f.profileId],
            );
          if (kind === "approval")
            await client.query(
              "UPDATE public.app_verification_requests SET superseded_at=now() WHERE id=$1",
              [f.requestId],
            );
          if (kind === "delivery_scope")
            await client.query(
              "INSERT INTO public.app_producer_delivery_scopes(producer_id,scope) VALUES($1,'custom')",
              [f.profileId],
            );
          if (kind === "property_block" || kind === "region_block") {
            const block = randomUUID();
            await client.query(
              "INSERT INTO public.app_access_partial_blocks(id,user_id,subject,scope,reason,created_by,command_id) VALUES($1,$2,'producer_publishing','custom','Bloqueio local de teste',$2,$3)",
              [block, f.userId, randomUUID()],
            );
            if (kind === "property_block")
              await client.query(
                "INSERT INTO public.app_access_partial_block_properties(block_id,property_id) VALUES($1,$2)",
                [block, f.propertyId],
              );
            else
              await client.query(
                "INSERT INTO public.app_access_partial_block_municipalities(block_id,municipality_id) SELECT $1,id FROM public.app_municipalities WHERE ibge_code='1100023'",
                [block],
              );
          }
          const result = await client.query(
            "SELECT hvm_store_private.store_is_visible($1) AS visible",
            [active.id],
          );
          expect(result.rows[0].visible).toBe(false);
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      },
    );
    it("exclusão de imóvel v46 permanece operacional e pausa/desvincula a loja", async () => {
      const f = await fixture();
      const active = await ProducerStoreService.publishStore(
        f.store.id,
        f.userId,
        command(f.store),
        context(),
      );
      await pool().query("DELETE FROM public.app_properties WHERE id=$1", [
        f.propertyId,
      ]);
      const view = await ProducerStoreService.getStoreSettings(f.userId);
      expect(view.store).toMatchObject({
        status: "paused",
        propertyId: null,
        revision: active.revision + 1,
      });
      await expect(
        ProducerStoreService.getPublicStore(active.storeSlug),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (
          await pool().query(
            "SELECT 1 FROM public.app_property_deletion_archive WHERE property_id=$1",
            [f.propertyId],
          )
        ).rowCount,
      ).toBe(1);
    });
    it("retirada de aprovação pausa a loja e exige nova aprovação para reabrir", async () => {
      const f = await fixture();
      const active = await ProducerStoreService.publishStore(
        f.store.id,
        f.userId,
        command(f.store),
        context(),
      );
      await pool().query(
        "UPDATE public.app_properties SET status='withdrawn' WHERE id=$1",
        [f.propertyId],
      );
      const view = await ProducerStoreService.getStoreSettings(f.userId);
      expect(view.store?.status).toBe("paused");
      await expect(
        ProducerStoreService.publishStore(
          active.id,
          f.userId,
          command(view.store!),
          context(),
        ),
      ).rejects.toMatchObject({ code: "STORE_PUBLISH_FORBIDDEN" });
    });
    it("exclusão Auth v46 continua eliminando perfil, loja e horários pelo trigger canônico", async () => {
      const f = await fixture();
      await pool().query("DELETE FROM auth.users WHERE id=$1", [f.userId]);
      expect(
        (await pool().query("SELECT 1 FROM auth.users WHERE id=$1", [f.userId]))
          .rowCount,
      ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM public.app_producer_stores WHERE id=$1",
            [f.store.id],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM public.app_store_operating_hours WHERE store_id=$1",
            [f.store.id],
          )
        ).rowCount,
      ).toBe(0);
    });
  },
);
