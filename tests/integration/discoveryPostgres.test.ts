import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T17_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("T17_LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
import { dbPool } from "../../server/db/pool.ts";
import { DiscoveryService } from "../../server/services/DiscoveryService.ts";
import { productFixture } from "../helpers/productFixtures.ts";
import { ARIQUEMES_CENTER } from "../../shared/contracts/delivery.ts";
const pool = () => dbPool as Pool;
const context = () => ({ requestId: randomUUID(), ipHash: "f".repeat(64) });
type Fixture = Awaited<ReturnType<typeof productFixture>>;
describe.runIf(Boolean(process.env.HVM_T17_LOCAL_DATABASE_URL))(
  "T17 PostgreSQL real: ranking, atomicidade, RLS e preservação",
  () => {
    const fixtures: Fixture[] = [];
    let near: Fixture,
      far: Fixture,
      tie: Fixture,
      categoryId: string,
      productId: string;
    const tag = "T17 " + randomUUID();
    const search = (extra: Record<string, unknown> = {}) =>
      DiscoveryService.searchStores({ query: tag, page: 1, ...extra });
    const favorite = (
      f: Fixture,
      targetId = near.store.id,
      commandId = randomUUID(),
      targetType: "store" | "product" = "store",
    ) =>
      DiscoveryService.toggleFavorite(
        f.personId,
        f.userId,
        { targetId, targetType, commandId },
        context(),
      );
    async function fixture(name: string, latitude: number, trust = 2) {
      const f = await productFixture(pool(), {
        coordinates: { latitude, longitude: ARIQUEMES_CENTER.longitude },
      });
      fixtures.push(f);
      await pool().query(
        "UPDATE app_producer_stores SET store_name=$2 WHERE id=$1",
        [f.store.id, tag + " " + name],
      );
      await pool().query(
        "UPDATE app_producer_profiles SET trust_level=$2 WHERE id=$1",
        [f.profileId, trust],
      );
      return f;
    }
    async function asRole(
      role: "anon" | "authenticated" | "service_role",
      userId: string,
      query: string,
      values: unknown[] = [],
    ) {
      const client = await pool().connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true)",
          [userId],
        );
        await client.query("SET LOCAL ROLE " + role);
        return await client.query(query, values);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    }
    beforeAll(async () => {
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS n FROM app_producer_stores",
          )
        ).rows[0].n,
      ).toBe(0);
      expect((await DiscoveryService.searchStores({ page: 1 })).stores).toEqual(
        [],
      );
      near = await fixture("próximo", -9.9133);
      far = await fixture("distante", -10.9133);
      tie = await fixture("confiança", -9.9133, 3);
      categoryId = randomUUID();
      productId = randomUUID();
      await pool().query(
        "INSERT INTO app_categories(id,name,slug,icon_name) VALUES($1,$2,$3,'leaf')",
        [categoryId, tag, "t17-" + categoryId],
      );
      await pool().query(
        "INSERT INTO app_products(id,store_id,category_id,title,description,packaging_type,net_weight_grams,unit_type,shelf_life_days,conservation_notes) VALUES($1,$2,$3,'Couve exclusiva T17','Couve de teste local.','pote_higienizado',250,'pote',5,'Manter refrigerado')",
        [productId, far.store.id, categoryId],
      );
      await pool().query(
        "INSERT INTO app_price_versions(product_id,price_cents,created_by_user_id) VALUES($1,1200,$2)",
        [productId, far.userId],
      );
      await pool().query(
        "INSERT INTO app_product_media(product_id,media_url,is_primary) VALUES($1,$2,true)",
        [
          productId,
          "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/product-media/" +
            far.store.id +
            "/" +
            productId +
            "/" +
            randomUUID() +
            "-" +
            "a".repeat(64) +
            ".png",
        ],
      );
      await pool().query(
        "UPDATE app_products SET is_published=true WHERE id=$1",
        [productId],
      );
    });
    afterAll(async () => {
      try {
        for (const f of fixtures)
          await pool().query("DELETE FROM auth.users WHERE id=$1", [f.userId]);
        if (categoryId)
          await pool().query("DELETE FROM app_categories WHERE id=$1", [
            categoryId,
          ]);
      } finally {
        await dbPool?.end();
      }
    });
    it("ordena por distância integral, confiança e ID determinístico", async () => {
      const result = await search();
      expect(result.stores.map((s) => s.id)).toEqual([
        tie.store.id,
        near.store.id,
        far.store.id,
      ]);
      expect(result.stores[0].distanceKm).toBeCloseTo(0, 8);
      expect(result.stores[2].distanceKm).toBeCloseTo(111.19493, 4);
      expect(result.distanceReference).toBe("ariquemes");
    });
    it("coordenadas do consumidor alteram a ordem sem gravar endereço", async () => {
      const result = await search({ latitude: -10.9133, longitude: -63.0408 });
      expect(result.stores[0].id).toBe(far.store.id);
      expect(result.distanceReference).toBe("consumer");
    });
    it("busca título apenas em produto publicado e categoria ativa", async () => {
      expect(
        (
          await DiscoveryService.searchStores({
            query: "Couve exclusiva T17",
            page: 1,
          })
        ).stores.map((s) => s.id),
      ).toEqual([far.store.id]);
      await pool().query(
        "UPDATE app_products SET is_published=false WHERE id=$1",
        [productId],
      );
      expect(
        (
          await DiscoveryService.searchStores({
            query: "Couve exclusiva T17",
            page: 1,
          })
        ).stores,
      ).toEqual([]);
      await pool().query(
        "UPDATE app_products SET is_published=true WHERE id=$1",
        [productId],
      );
    });
    it("categoria e município filtram dados reais, sem fallback silencioso", async () => {
      expect(
        (await search({ categorySlug: "t17-" + categoryId })).stores.map(
          (s) => s.id,
        ),
      ).toEqual([far.store.id]);
      const municipality = (
        await pool().query(
          "SELECT id FROM app_municipalities WHERE ibge_code='1100023'",
        )
      ).rows[0].id;
      expect(
        (await search({ municipalityId: municipality })).stores,
      ).toHaveLength(3);
      expect((await search({ municipalityId: randomUUID() })).stores).toEqual(
        [],
      );
    });
    it("trata %, _ e texto de SQL como texto literal", async () => {
      expect(
        (await DiscoveryService.searchStores({ query: "%", page: 1 })).stores,
      ).toEqual([]);
      expect(
        (await DiscoveryService.searchStores({ query: "_", page: 1 })).stores,
      ).toEqual([]);
      expect(
        (
          await DiscoveryService.searchStores({
            query: "' OR true --",
            page: 1,
          })
        ).stores,
      ).toEqual([]);
    });
    it("mantém o gate T12: pausado ou produtor rebaixado desaparece", async () => {
      await pool().query(
        "UPDATE app_producer_stores SET status='paused' WHERE id=$1",
        [near.store.id],
      );
      expect((await search()).stores.map((s) => s.id)).not.toContain(
        near.store.id,
      );
      await pool().query(
        "UPDATE app_producer_stores SET status='active' WHERE id=$1",
        [near.store.id],
      );
      await pool().query(
        "UPDATE app_producer_profiles SET trust_level=1 WHERE id=$1",
        [near.profileId],
      );
      expect((await search()).stores.map((s) => s.id)).not.toContain(
        near.store.id,
      );
      await pool().query(
        "UPDATE app_producer_profiles SET trust_level=2 WHERE id=$1",
        [near.profileId],
      );
    });
    it("DTO público não contém pessoa, imóvel, GPS, telefone ou documento", async () => {
      const card = (await search()).stores[0];
      expect(Object.keys(card).sort()).toEqual(
        [
          "id",
          "slug",
          "name",
          "avatarUrl",
          "location",
          "distanceKm",
          "isVerified",
          "trustLevel",
        ].sort(),
      );
      expect(card.location).toBe("Ariquemes/RO");
    });
    it("comandos distintos adicionam e removem sem duplicar; retry não retoggle", async () => {
      const command = randomUUID();
      const first = await favorite(near, near.store.id, command);
      expect(first.isFavorite).toBe(true);
      expect(first.replayed).toBe(false);
      expect(await favorite(near, near.store.id, command)).toEqual({
        ...first,
        replayed: true,
      });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_favorites WHERE person_id=$1",
            [near.personId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect((await favorite(near)).isFavorite).toBe(false);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_favorites WHERE person_id=$1",
            [near.personId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("comando concorrente igual gera uma linha e uma auditoria", async () => {
      const command = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => favorite(far, near.store.id, command)),
      );
      expect(results.every((r) => r.isFavorite)).toBe(true);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_audit_events WHERE command_id=$1",
            [command],
          )
        ).rows[0].n,
      ).toBe(1);
      expect((await favorite(far)).isFavorite).toBe(false);
    });
    it("comando reutilizado por outra pessoa ou alvo falha sem mutação", async () => {
      const command = randomUUID();
      await favorite(near, near.store.id, command);
      await expect(favorite(far, near.store.id, command)).rejects.toMatchObject(
        { code: "FAVORITE_COMMAND_CONFLICT", status: 409 },
      );
      await expect(favorite(near, far.store.id, command)).rejects.toMatchObject(
        { code: "FAVORITE_COMMAND_CONFLICT", status: 409 },
      );
      await favorite(near);
    });
    it("valida alvo e identidade no backend, com rollback da auditoria", async () => {
      const command = randomUUID();
      await expect(favorite(near, randomUUID(), command)).rejects.toMatchObject(
        { code: "FAVORITE_TARGET_NOT_FOUND", status: 404 },
      );
      expect(
        (
          await pool().query(
            "SELECT id FROM app_audit_events WHERE command_id=$1",
            [command],
          )
        ).rows,
      ).toEqual([]);
      await expect(
        DiscoveryService.toggleFavorite(
          far.personId,
          near.userId,
          {
            targetType: "store",
            targetId: near.store.id,
            commandId: randomUUID(),
          },
          context(),
        ),
      ).rejects.toMatchObject({ code: "FAVORITE_OWNER_REQUIRED" });
    });
    it("favorito de produto respeita publicação e pode ser removido após ocultação", async () => {
      expect(
        (await favorite(near, productId, randomUUID(), "product")).isFavorite,
      ).toBe(true);
      await pool().query(
        "UPDATE app_products SET is_published=false WHERE id=$1",
        [productId],
      );
      expect(
        (await DiscoveryService.listFavorites(near.personId, near.userId))
          .favorites,
      ).toEqual([]);
      expect(
        (await favorite(near, productId, randomUUID(), "product")).isFavorite,
      ).toBe(false);
      await pool().query(
        "UPDATE app_products SET is_published=true WHERE id=$1",
        [productId],
      );
    });
    it("RLS A não lê B; authenticated tem SELECT e não tem nenhuma mutação", async () => {
      await favorite(near);
      await favorite(far, far.store.id);
      const own = await asRole(
        "authenticated",
        near.userId,
        "SELECT person_id,target_id FROM app_favorites",
      );
      expect(own.rows).toEqual([
        { person_id: near.personId, target_id: near.store.id },
      ]);
      expect(
        (
          await asRole(
            "authenticated",
            far.userId,
            "SELECT target_id FROM app_favorites WHERE person_id=$1",
            [near.personId],
          )
        ).rows,
      ).toEqual([]);
      await expect(
        asRole("anon", "", "SELECT * FROM app_favorites"),
      ).rejects.toMatchObject({ code: "42501" });
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
              "SELECT has_table_privilege('authenticated','app_favorites',$1) allowed",
              [privilege],
            )
          ).rows[0].allowed,
        ).toBe(false);
      await expect(
        asRole("authenticated", near.userId, "DELETE FROM app_favorites"),
      ).rejects.toMatchObject({ code: "42501" });
      await favorite(near);
      await favorite(far, far.store.id);
    });
    it("RLS FORCE, grants privilégiés mínimos e ambos índices GIN", async () => {
      expect(
        (
          await pool().query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='app_favorites'::regclass",
          )
        ).rows[0],
      ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      for (const p of ["UPDATE", "TRUNCATE", "REFERENCES", "TRIGGER"])
        expect(
          (
            await pool().query(
              "SELECT has_table_privilege('service_role','app_favorites',$1) allowed",
              [p],
            )
          ).rows[0].allowed,
        ).toBe(false);
      expect(
        (
          await pool().query(
            "SELECT indexdef FROM pg_indexes WHERE indexname IN ('ix_app_products_title_trgm','ix_app_stores_name_trgm')",
          )
        ).rows,
      ).toHaveLength(2);
    });
    it("descoberta/favoritos mantêm tabelas e valores T12–T16", async () => {
      const sql =
        "SELECT (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM app_producer_stores s) stores,(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM app_properties p) properties,(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM app_products p) products,(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM app_price_versions p) prices,(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM app_inventory_lots i) lots,(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM app_service_areas i) areas,(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM app_delivery_rules i) delivery";
      const before = (await pool().query(sql)).rows[0];
      await search();
      await favorite(near);
      await favorite(near);
      expect((await pool().query(sql)).rows[0]).toEqual(before);
    });
    it("exclusão operacional da conta preserva cascata dos favoritos", async () => {
      const disposable = await fixture("descartável", -9.92);
      await favorite(disposable);
      await pool().query("DELETE FROM auth.users WHERE id=$1", [
        disposable.userId,
      ]);
      expect(
        (
          await pool().query("SELECT * FROM app_favorites WHERE person_id=$1", [
            disposable.personId,
          ])
        ).rows,
      ).toEqual([]);
    });
    it("páginas geodésicas são contíguas, sem duplicação entre empates", async () => {
      for (let i = 0; i < 21; i++) await fixture("paginação " + i, -9.9133);
      const first = await search({ query: tag + " paginação", page: 1 });
      const second = await search({ query: tag + " paginação", page: 2 });
      expect(first.stores).toHaveLength(20);
      expect(first.hasMore).toBe(true);
      expect(second.stores).toHaveLength(1);
      expect(second.hasMore).toBe(false);
      const ids = [...first.stores, ...second.stores].map((s) => s.id);
      expect(new Set(ids).size).toBe(21);
      expect(ids).toEqual([...ids].sort());
    });
    it("comandos distintos concorrentes alternam atomicamente sem 23505", async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => favorite(near)),
      );
      expect(results.filter((r) => r.isFavorite)).toHaveLength(3);
      expect(
        (
          await pool().query(
            "SELECT id FROM app_favorites WHERE person_id=$1",
            [near.personId],
          )
        ).rows,
      ).toEqual([]);
    });
  },
);
