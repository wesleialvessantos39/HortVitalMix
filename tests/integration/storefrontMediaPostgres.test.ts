import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
const storage = vi.hoisted(() => ({
  uploads: [] as string[],
  signs: 0,
  fail: false,
  signFail: false,
}));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_MEDIA_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          storage.uploads.push(path);
          return {
            data: null,
            error: storage.fail ? { message: "offline" } : null,
          };
        },
        createSignedUrls: async (paths: string[]) => {
          storage.signs++;
          return {
            error: storage.signFail ? { message: "offline" } : null,
            data: paths.map((path) => ({
              path,
              signedUrl: `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=local-only`,
              error: null,
            })),
          };
        },
      }),
    },
  },
  createSupabasePublicClient: () => null,
}));
import { dbPool } from "../../server/db/pool.ts";
import { productFixture } from "../helpers/productFixtures.ts";
import { ProducerStoreService } from "../../server/services/ProducerStoreService.ts";
import { StoreMediaService } from "../../server/services/StoreMediaService.ts";
import { ProductService } from "../../server/services/ProductService.ts";
import type { StoreOwner } from "../../shared/contracts/producerStore.ts";
const pool = () => dbPool as Pool,
  context = () => ({ requestId: randomUUID(), ipHash: "d".repeat(64) });
type Fixture = Awaited<ReturnType<typeof productFixture>>;
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
describe.runIf(Boolean(process.env.HVM_MEDIA_LOCAL_DATABASE_URL))(
  "Fotos, capas e destaque regional com PostgreSQL real",
  () => {
    const fixtures: Fixture[] = [],
      extraMunicipalities: string[] = [];
    let a: Fixture,
      b: Fixture,
      c: Fixture,
      categoryId: string,
      regionA: string,
      regionB: string;
    async function fixture(municipality = "Ariquemes") {
      const f = await productFixture(pool(), { municipality });
      fixtures.push(f);
      return f;
    }
    async function fresh(f = a) {
      return (await ProducerStoreService.getStoreSettings(f.userId)).store!;
    }
    function upload(
      f: Fixture,
      store: StoreOwner,
      purpose: "avatar" | "cover" = "cover",
      commandId = randomUUID(),
    ) {
      return StoreMediaService.upload(
        store.id,
        f.userId,
        { purpose, expectedRevision: store.revision, commandId },
        png,
        "image/png",
        context(),
      );
    }
    async function product(f: Fixture, title: string) {
      const id = randomUUID();
      await pool().query(
        `INSERT INTO app_products(id,store_id,category_id,title,description,packaging_type,net_weight_grams,unit_type,shelf_life_days,conservation_notes) VALUES($1,$2,$3,$4,'Produto de teste local','pote_higienizado',250,'pote',5,'Refrigerar')`,
        [id, f.store.id, categoryId, title],
      );
      await pool().query(
        "INSERT INTO app_price_versions(product_id,price_cents,created_by_user_id) VALUES($1,1290,$2)",
        [id, f.userId],
      );
      await pool().query(
        "INSERT INTO app_product_media(product_id,media_url,is_primary) VALUES($1,$2,true)",
        [
          id,
          `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/product-media/${f.store.id}/${id}/${randomUUID()}-${"a".repeat(64)}.png`,
        ],
      );
      await pool().query(
        "UPDATE app_products SET is_published=true WHERE id=$1",
        [id],
      );
      return id;
    }
    async function asRole(userId: string, sql: string, role = "authenticated") {
      const client = await pool().connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true)",
          [userId],
        );
        await client.query("SET LOCAL ROLE " + role);
        return await client.query(sql);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    }
    beforeAll(async () => {
      expect(
        (await pool().query("SELECT count(*)::int n FROM app_producer_stores"))
          .rows[0].n,
      ).toBe(0);
      a = await fixture();
      b = await fixture("Cujubim");
      const name = (
        await pool().query(
          "SELECT name FROM app_municipalities WHERE name_normalized LIKE 'machadinho%'",
        )
      ).rows[0].name;
      c = await fixture(name);
      regionA = (
        await pool().query(
          "SELECT id FROM app_municipalities WHERE name_normalized='ariquemes'",
        )
      ).rows[0].id;
      regionB = (
        await pool().query(
          "SELECT id FROM app_municipalities WHERE name_normalized='cujubim'",
        )
      ).rows[0].id;
      categoryId = randomUUID();
      await pool().query(
        "INSERT INTO app_categories(id,name,slug,icon_name) VALUES($1,'Categoria de mídia local',$2,'leaf')",
        [categoryId, "media-" + categoryId],
      );
      for (let i = 0; i < 3; i++) {
        await product(a, "Ariquemes " + i);
        await product(b, "Cujubim " + i);
        await product(c, "Machadinho " + i);
      }
    });
    afterAll(async () => {
      try {
        for (const f of fixtures)
          await pool().query("DELETE FROM auth.users WHERE id=$1", [f.userId]);
        if (categoryId)
          await pool().query("DELETE FROM app_categories WHERE id=$1", [
            categoryId,
          ]);
        for (const id of extraMunicipalities)
          await pool().query("DELETE FROM app_municipalities WHERE id=$1", [
            id,
          ]);
      } finally {
        await dbPool?.end();
      }
    });
    it("alterna regiões e filtra todos os produtos de uma região", async () => {
      const all = await ProductService.listHighlights({ page: 1 });
      expect(all.products).toHaveLength(9);
      expect(
        new Set(all.products.slice(0, 3).map((p) => p.municipalityId)).size,
      ).toBe(3);
      expect(all.products.slice(0, 3).map((p) => p.municipalityId)).toEqual(
        all.products.slice(3, 6).map((p) => p.municipalityId),
      );
      const selected = await ProductService.listHighlights({
        page: 1,
        municipalityId: regionA,
      });
      expect(selected.products).toHaveLength(3);
      expect(selected.products.every((p) => p.municipalityId === regionA)).toBe(
        true,
      );
      expect(
        (
          await ProductService.listHighlights({
            page: 1,
            municipalityId: randomUUID(),
          })
        ).products,
      ).toEqual([]);
    });
    it("inclui localidade futura sem alterar listas de cidades no código", async () => {
      const id = randomUUID();
      await pool().query(
        "INSERT INTO app_municipalities(id,ibge_code,name,name_normalized,state) VALUES($1,'1109999','Município futuro local','municipio futuro local','RO')",
        [id],
      );
      extraMunicipalities.push(id);
      const f = await fixture("Município futuro local");
      const p = await product(f, "Nova região");
      expect(
        (await ProductService.listHighlights({ page: 1 })).products
          .slice(0, 4)
          .map((item) => item.id),
      ).toContain(p);
      await pool().query("DELETE FROM auth.users WHERE id=$1", [f.userId]);
    });
    it("consulta gates atuais mesmo reutilizando assinaturas de imagem", async () => {
      await ProductService.listHighlights({ page: 1 });
      const signatures = storage.signs;
      await ProductService.listHighlights({ page: 1 });
      expect(storage.signs).toBe(signatures);
      await pool().query(
        "UPDATE app_producer_stores SET status='paused' WHERE id=$1",
        [b.store.id],
      );
      expect(
        (await ProductService.listHighlights({ page: 1 })).products.every(
          (p) => p.municipalityId !== regionB,
        ),
      ).toBe(true);
      await pool().query(
        "UPDATE app_producer_stores SET status='active' WHERE id=$1",
        [b.store.id],
      );
      await pool().query(
        "UPDATE app_categories SET is_active=false WHERE id=$1",
        [categoryId],
      );
      expect(
        (await ProductService.listHighlights({ page: 1 })).products,
      ).toEqual([]);
      await pool().query(
        "UPDATE app_categories SET is_active=true WHERE id=$1",
        [categoryId],
      );
      await pool().query(
        "UPDATE app_producer_profiles SET trust_level=1 WHERE id=$1",
        [c.profileId],
      );
      expect(
        (await ProductService.listHighlights({ page: 1 })).products,
      ).toHaveLength(6);
      await pool().query(
        "UPDATE app_producer_profiles SET trust_level=2 WHERE id=$1",
        [c.profileId],
      );
    });
    it("não divulga nome civil, documento, pessoa, coordenadas ou revisões privadas", async () => {
      const raw = JSON.stringify(
        await ProductService.listHighlights({ page: 1 }),
      );
      for (const privateValue of [
        a.personId,
        a.profileId,
        a.propertyId,
        a.userId,
        "Produtor local T14",
        "cpf",
        "latitude",
        "phone",
        "revision",
        "storeId",
      ])
        expect(raw).not.toContain(privateValue);
    });
    it("salva modo e nome público explícito sem alterar dados cadastrais", async () => {
      const person = (
        await pool().query(
          "SELECT to_jsonb(p) data FROM app_people p WHERE id=$1",
          [a.personId],
        )
      ).rows[0].data;
      for (const coverMode of ["images", "products", "mixed"] as const) {
        const s = await fresh();
        const saved = await StoreMediaService.configure(
          s.id,
          a.userId,
          {
            commandId: randomUUID(),
            expectedRevision: s.revision,
            coverMode,
            publicProducerName: "Dona Maria da horta",
          },
          context(),
        );
        expect(saved.coverMode).toBe(coverMode);
        expect(
          (await ProducerStoreService.getPublicStore(saved.storeSlug))
            .publicProducerName,
        ).toBe("Dona Maria da horta");
      }
      expect(
        (
          await pool().query(
            "SELECT to_jsonb(p) data FROM app_people p WHERE id=$1",
            [a.personId],
          )
        ).rows[0].data,
      ).toEqual(person);
      expect(
        (
          await ProductService.listHighlights({
            page: 1,
            municipalityId: regionA,
          })
        ).products.every((p) => p.producerName === "Dona Maria da horta"),
      ).toBe(true);
    });
    it("upload concorrente igual gera um arquivo, uma linha e uma auditoria", async () => {
      const s = await fresh(),
        id = randomUUID(),
        uploads = storage.uploads.length;
      const results = await Promise.all(
        Array.from({ length: 4 }, () => upload(a, s, "cover", id)),
      );
      expect(results.every((r) => r.coverImages.length === 1)).toBe(true);
      expect(storage.uploads.length - uploads).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_audit_events WHERE command_id=$1",
            [id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("rejeita uso do mesmo comando com bytes diferentes e revisão antiga", async () => {
      const s = await fresh(),
        id = randomUUID();
      await upload(a, s, "cover", id);
      await expect(
        StoreMediaService.upload(
          s.id,
          a.userId,
          { purpose: "cover", commandId: id, expectedRevision: s.revision },
          Buffer.concat([png, Buffer.from("changed")]),
          "image/png",
          context(),
        ),
      ).rejects.toMatchObject({ code: "STORE_COMMAND_CONFLICT" });
      await expect(upload(a, s)).rejects.toMatchObject({
        code: "STORE_REVISION_CONFLICT",
      });
    });
    it("limita seis capas e rejeita SVG disfarçado e terceiro proprietário", async () => {
      for (let i = (await fresh()).coverImages.length; i < 6; i++)
        await upload(a, await fresh());
      const s = await fresh();
      expect(s.coverImages).toHaveLength(6);
      await expect(upload(a, s)).rejects.toMatchObject({
        code: "STORE_MEDIA_LIMIT",
      });
      await expect(
        StoreMediaService.upload(
          s.id,
          a.userId,
          {
            purpose: "cover",
            commandId: randomUUID(),
            expectedRevision: s.revision,
          },
          Buffer.from("<svg/>"),
          "image/png",
          context(),
        ),
      ).rejects.toMatchObject({ code: "STORE_IMAGE_INVALID" });
      await expect(upload(b, s)).rejects.toMatchObject({
        code: "STORE_NOT_FOUND",
      });
    });
    it("substitui avatar e agenda a remoção segura da foto anterior", async () => {
      const first = await upload(a, await fresh(), "avatar");
      const second = await upload(a, first, "avatar");
      expect(second.avatarUrl).not.toBe(first.avatarUrl);
      expect(
        (
          await pool().query(
            "SELECT * FROM app_storage_deletion_queue WHERE reason='store_media_deleted' AND object_path LIKE $1",
            [a.store.id + "/%"],
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await pool().query(
            "SELECT * FROM app_store_media WHERE store_id=$1 AND purpose='avatar'",
            [a.store.id],
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("DELETE isola proprietário e remove foto da capa pública e banco", async () => {
      const s = await fresh(),
        mediaId = s.coverImages[0].id;
      await expect(
        StoreMediaService.remove(
          s.id,
          b.userId,
          { mediaId, expectedRevision: s.revision, commandId: randomUUID() },
          context(),
        ),
      ).rejects.toMatchObject({ code: "STORE_NOT_FOUND" });
      const saved = await StoreMediaService.remove(
        s.id,
        a.userId,
        { mediaId, expectedRevision: s.revision, commandId: randomUUID() },
        context(),
      );
      expect(saved.coverImages).toHaveLength(5);
      expect(
        (
          await ProducerStoreService.getPublicStore(s.storeSlug)
        ).coverImages.map((i) => i.id),
      ).not.toContain(mediaId);
    });
    it("falha de assinatura reverte a mutação e agenda o arquivo órfão", async () => {
      const s = await fresh(),
        count = storage.uploads.length;
      storage.signFail = true;
      try {
        await expect(upload(a, s)).rejects.toMatchObject({
          code: "DEPENDENCY_UNAVAILABLE",
        });
      } finally {
        storage.signFail = false;
      }
      expect((await fresh()).revision).toBe(s.revision);
      const path = storage.uploads[count];
      expect(
        (
          await pool().query(
            "SELECT object_path FROM app_storage_deletion_queue WHERE reason='store_upload_rollback' AND object_path=$1",
            [path],
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("RLS ENABLE/FORCE: A não lê B e authenticated não pode escrever", async () => {
      const rows = (
        await asRole(a.userId, "SELECT store_id FROM app_store_media")
      ).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.store_id === a.store.id)).toBe(true);
      expect(
        (
          await asRole(
            b.userId,
            `SELECT * FROM app_store_media WHERE store_id='${a.store.id}'`,
          )
        ).rows,
      ).toEqual([]);
      await expect(
        asRole(a.userId, "SELECT * FROM app_store_media", "anon"),
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
              "SELECT has_table_privilege('authenticated','app_store_media',$1) allowed",
              [privilege],
            )
          ).rows[0].allowed,
        ).toBe(false);
      expect(
        (
          await pool().query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='app_store_media'::regclass",
          )
        ).rows[0],
      ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      expect(
        (
          await pool().query(
            "SELECT public,file_size_limit::int FROM storage.buckets WHERE id='store-media'",
          )
        ).rows[0],
      ).toEqual({ public: false, file_size_limit: 2097152 });
    });
    it("usuário bloqueado não pode repetir comando nem criar nova capa", async () => {
      const s = await fresh(),
        id = randomUUID();
      await StoreMediaService.configure(
        s.id,
        a.userId,
        {
          coverMode: "mixed",
          publicProducerName: null,
          expectedRevision: s.revision,
          commandId: id,
        },
        context(),
      );
      await pool().query("UPDATE app_users SET status='blocked' WHERE id=$1", [
        a.userId,
      ]);
      try {
        await expect(
          StoreMediaService.configure(
            s.id,
            a.userId,
            {
              coverMode: "mixed",
              publicProducerName: null,
              expectedRevision: s.revision,
              commandId: id,
            },
            context(),
          ),
        ).rejects.toMatchObject({ code: "PRODUCER_PROFILE_REQUIRED" });
      } finally {
        await pool().query("UPDATE app_users SET status='active' WHERE id=$1", [
          a.userId,
        ]);
      }
    });
    it("paginação percorre mais de trinta produtos sem repetir IDs", async () => {
      for (let i = 0; i < 27; i++) await product(a, "Paginação " + i);
      const first = await ProductService.listHighlights({ page: 1 }),
        second = await ProductService.listHighlights({ page: 2 });
      expect(first.products).toHaveLength(30);
      expect(first.hasMore).toBe(true);
      expect(second.products).toHaveLength(6);
      expect(second.hasMore).toBe(false);
      expect(
        new Set([...first.products, ...second.products].map((p) => p.id)).size,
      ).toBe(36);
    });
    it("leitura de slides preserva todos os dados anteriores de produção", async () => {
      const sql =
        "SELECT (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM app_properties p) properties,(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM app_products p) products,(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM app_price_versions p) prices,(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM app_producer_stores p) stores";
      const before = (await pool().query(sql)).rows[0];
      await ProductService.listHighlights({ page: 1 });
      await ProducerStoreService.getPublicStore(a.store.storeSlug);
      expect((await pool().query(sql)).rows[0]).toEqual(before);
    });
  },
);
