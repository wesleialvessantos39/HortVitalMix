import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
const storage = vi.hoisted(() => ({
  fail: false,
  signedFail: false,
  uploads: [] as string[],
}));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T14_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("T14_LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: async (path: string) => {
          storage.uploads.push(path);
          return {
            data: null,
            error: storage.fail ? { message: "local upload failure" } : null,
          };
        },
        createSignedUrls: async (paths: string[]) => ({
          error: storage.signedFail
            ? { message: "local signing failure" }
            : null,
          data: paths.map((path) => ({
            path,
            signedUrl:
              "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/product-media/" +
              path +
              "?token=local-only",
            error: null,
          })),
        }),
      }),
    },
  },
  createSupabasePublicClient: () => null,
}));
import { dbPool } from "../../server/db/pool.ts";
import { ProductService } from "../../server/services/ProductService.ts";
import { ProducerStoreService } from "../../server/services/ProducerStoreService.ts";
import { productFixture } from "../helpers/productFixtures.ts";
import type { Product } from "../../shared/contracts/product.ts";
import manifest from "../../supabase/manifest.json" with { type: "json" };
const pool = () => dbPool as Pool,
  context = () => ({ requestId: randomUUID(), ipHash: "c".repeat(64) });
const command = (p: Product) => ({
  commandId: randomUUID(),
  expectedRevision: p.revision,
});
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
type Fixture = Awaited<ReturnType<typeof productFixture>>;
let categoryId: string;
const fields = () => ({
  categoryId,
  title: "Couve picada",
  description: "Couve fresca picada e higienizada.",
  packagingType: "pote_higienizado" as const,
  netWeightGrams: 250,
  unitType: "pote" as const,
  shelfLifeDays: 5,
  conservationNotes: "Manter refrigerado entre 2°C e 6°C",
  priceCents: 1290,
  commandId: randomUUID(),
});
const create = (f: Fixture) =>
  ProductService.createProduct(f.personId, fields(), f.userId, context());
const photo = (f: Fixture, p: Product) =>
  ProductService.uploadMedia(
    p.id,
    f.personId,
    command(p),
    f.userId,
    png,
    "image/png",
    context(),
  );
const publish = (f: Fixture, p: Product) =>
  ProductService.togglePublish(
    p.id,
    f.personId,
    { ...command(p), isPublished: true },
    f.userId,
    context(),
  );
async function asRole(
  role: "anon" | "authenticated" | "service_role",
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
    await client.query(`SET LOCAL ROLE ${role}`);
    return await client.query(query, values);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
describe.runIf(Boolean(process.env.HVM_T14_LOCAL_DATABASE_URL))(
  "T14 PostgreSQL real, imutabilidade e regressões T12/T13",
  () => {
    beforeAll(async () => {
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS count FROM supabase_migrations.schema_migrations",
          )
        ).rows[0].count,
      ).toBe(manifest.migrations.length);
      categoryId = (
        await pool().query(
          "SELECT id FROM app_categories WHERE slug='hortalicas-folhosas'",
        )
      ).rows[0].id;
    });
    afterAll(async () => {
      await dbPool?.end();
    });
    it("cria produto + preço inicial + auditoria atomicamente", async () => {
      const f = await productFixture(pool()),
        input = fields();
      const p = await ProductService.createProduct(
        f.personId,
        input,
        f.userId,
        context(),
      );
      expect(p).toMatchObject({
        isPublished: false,
        revision: 1,
        currentPrice: { priceCents: 1290 },
      });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS count FROM app_price_versions WHERE product_id=$1",
            [p.id],
          )
        ).rows[0].count,
      ).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT action FROM app_audit_events WHERE command_id=$1",
            [input.commandId],
          )
        ).rows[0].action,
      ).toBe("product.created");
      const before = (
        await pool().query(
          "SELECT count(*)::int AS count FROM app_products WHERE store_id=$1",
          [f.store.id],
        )
      ).rows[0].count;
      await expect(
        ProductService.createProduct(f.personId, fields(), f.userId, {
          ...context(),
          requestId: "invalid",
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS count FROM app_products WHERE store_id=$1",
            [f.store.id],
          )
        ).rows[0].count,
      ).toBe(before);
    });
    it("alterar preço só acrescenta versão e getCurrentPrice retorna seu ID", async () => {
      const f = await productFixture(pool()),
        p = await create(f);
      const original = (
        await pool().query(
          "SELECT * FROM app_price_versions WHERE product_id=$1",
          [p.id],
        )
      ).rows;
      const saved = await ProductService.updatePrice(
        p.id,
        f.personId,
        { ...command(p), newPriceCents: 1590 },
        f.userId,
        context(),
      );
      expect(saved.revision).toBe(2);
      expect(saved.currentPrice.priceCents).toBe(1590);
      expect(
        (
          await pool().query("SELECT * FROM app_price_versions WHERE id=$1", [
            original[0].id,
          ])
        ).rows,
      ).toEqual(original);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS count FROM app_price_versions WHERE product_id=$1",
            [p.id],
          )
        ).rows[0].count,
      ).toBe(2);
      expect(await ProductService.getCurrentPrice(p.id)).toEqual(
        saved.currentPrice,
      );
      await expect(
        pool().query(
          "UPDATE app_price_versions SET price_cents=1 WHERE id=$1",
          [original[0].id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool().query("DELETE FROM app_price_versions WHERE id=$1", [
          original[0].id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        asRole(
          "service_role",
          null,
          "UPDATE app_price_versions SET price_cents=1 WHERE id=$1",
          [original[0].id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it.each([{ active: false }, { verification: "declared" }, { trust: 1 }])(
      "reutiliza trava T12 para %#",
      async (options) => {
        const f = await productFixture(pool(), options);
        await expect(create(f)).rejects.toMatchObject({
          status: 403,
          code: "PRODUCT_CREATE_FORBIDDEN_UNVERIFIED_STORE",
        });
        expect(
          (await ProductService.listOwnerProducts(f.personId, f.userId))
            .canCreate,
        ).toBe(false);
      },
    );
    it("titularidade e papel revalidados impedem IDOR inclusive em replay", async () => {
      const f = await productFixture(pool()),
        other = await productFixture(pool()),
        input = fields();
      const p = await ProductService.createProduct(
        f.personId,
        input,
        f.userId,
        context(),
      );
      await expect(
        ProductService.getOwnerProduct(p.id, other.personId, other.userId),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        ProductService.updatePrice(
          p.id,
          other.personId,
          { ...command(p), newPriceCents: 1390 },
          other.userId,
          context(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        ProductService.createProduct(
          f.personId,
          fields(),
          other.userId,
          context(),
        ),
      ).rejects.toMatchObject({ status: 403 });
      await pool().query(
        "UPDATE app_user_role_assignments SET revoked_at=now() WHERE user_id=$1 AND role_code='producer'",
        [f.userId],
      );
      await expect(
        ProductService.createProduct(f.personId, input, f.userId, context()),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("publicação exige mídia primária; troca mantém exatamente uma", async () => {
      const f = await productFixture(pool()),
        p = await create(f);
      await expect(publish(f, p)).rejects.toMatchObject({
        status: 422,
        code: "PRODUCT_PRIMARY_MEDIA_REQUIRED",
      });
      let saved = await photo(f, p);
      expect(saved.media[0].isPrimary).toBe(true);
      saved = await publish(f, saved);
      saved = await photo(f, saved);
      saved = await ProductService.setPrimaryMedia(
        saved.id,
        f.personId,
        { ...command(saved), mediaId: saved.media[1].id },
        f.userId,
        context(),
      );
      expect(saved.media.filter((m) => m.isPrimary)).toHaveLength(1);
      expect(saved.media[1].isPrimary).toBe(true);
      await expect(
        ProductService.removeMedia(
          saved.id,
          f.personId,
          { ...command(saved), mediaId: saved.media[1].id },
          f.userId,
          context(),
        ),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        pool().query(
          "UPDATE app_product_media SET is_primary=false WHERE product_id=$1",
          [saved.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("RLS de produto/preço/mídia protege rascunhos, pausas e proprietário", async () => {
      const f = await productFixture(pool()),
        other = await productFixture(pool());
      let p = await photo(f, await create(f));
      const count = async (
        role: "anon" | "authenticated",
        actor: string | null,
        table: string,
        column: string,
      ) =>
        (
          await asRole(
            role,
            actor,
            `SELECT id FROM ${table} WHERE ${column}=$1`,
            [p.id],
          )
        ).rowCount;
      for (const [table, column] of [
        ["app_products", "id"],
        ["app_price_versions", "product_id"],
        ["app_product_media", "product_id"],
      ]) {
        expect(await count("anon", null, table, column)).toBe(0);
        expect(await count("authenticated", other.userId, table, column)).toBe(
          0,
        );
        expect(await count("authenticated", f.userId, table, column)).toBe(1);
      }
      p = await publish(f, p);
      for (const [table, column] of [
        ["app_products", "id"],
        ["app_price_versions", "product_id"],
        ["app_product_media", "product_id"],
      ])
        expect(await count("anon", null, table, column)).toBe(1);
      await ProducerStoreService.pauseStore(
        f.store.id,
        f.userId,
        {
          commandId: randomUUID(),
          expectedRevision: f.store.revision,
          reason: "Chuva local",
        },
        context(),
      );
      for (const [table, column] of [
        ["app_products", "id"],
        ["app_price_versions", "product_id"],
        ["app_product_media", "product_id"],
      ])
        expect(await count("anon", null, table, column)).toBe(0);
      expect(
        await ProductService.listPublicProducts({
          storeSlug: f.store.storeSlug,
        }),
      ).toEqual([]);
      expect(
        (await ProductService.listOwnerProducts(f.personId, f.userId)).products,
      ).toHaveLength(1);
      expect(
        (
          await ProductService.togglePublish(
            p.id,
            f.personId,
            { ...command(p), isPublished: false },
            f.userId,
            context(),
          )
        ).isPublished,
      ).toBe(false);
    });
    it("publicação não contorna a governança regional/conta T12", async () => {
      const f = await productFixture(pool());
      let p = await photo(f, await create(f));
      p = await publish(f, p);
      await pool().query(
        "UPDATE app_users SET status='suspended' WHERE id=$1",
        [f.userId],
      );
      expect(
        await ProductService.listPublicProducts({
          storeSlug: f.store.storeSlug,
        }),
      ).toEqual([]);
      expect(
        (
          await asRole(
            "anon",
            null,
            "SELECT id FROM app_products WHERE id=$1",
            [p.id],
          )
        ).rowCount,
      ).toBe(0);
      await expect(
        ProductService.updatePrice(
          p.id,
          f.personId,
          { ...command(p), newPriceCents: 1490 },
          f.userId,
          context(),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("público recebe preço/foto correntes sem IDs privados e filtros reais", async () => {
      const f = await productFixture(pool());
      let p = await photo(f, await create(f));
      p = await publish(f, p);
      const list = await ProductService.listPublicProducts({
        storeSlug: f.store.storeSlug,
        categoryId,
        search: "COUVE",
      });
      expect(list).toHaveLength(1);
      expect(list[0].currentPrice).toEqual(p.currentPrice);
      for (const key of [
        "storeId",
        "personId",
        "producerProfileId",
        "createdByUserId",
        "revision",
      ])
        expect(list[0]).not.toHaveProperty(key);
      expect(list[0].media[0].url).toContain("/object/sign/");
      expect(
        await ProductService.listPublicProducts({
          storeSlug: f.store.storeSlug,
          search: "%",
        }),
      ).toEqual([]);
      await expect(
        asRole(
          "anon",
          null,
          "SELECT created_by_user_id FROM app_price_versions WHERE product_id=$1",
          [p.id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("categoria desativada oculta publicado e impede novos produtos sem modificar T13", async () => {
      const f = await productFixture(pool());
      let p = await photo(f, await create(f));
      p = await publish(f, p);
      const client = await pool().connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE app_categories SET is_active=false WHERE id=$1",
          [categoryId],
        );
        await client.query("SET LOCAL ROLE anon");
        expect(
          (
            await client.query("SELECT id FROM app_products WHERE id=$1", [
              p.id,
            ])
          ).rowCount,
        ).toBe(0);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      const inactive = randomUUID();
      await pool().query(
        "INSERT INTO app_categories(id,name,slug,icon_name,is_active) VALUES($1,'Inativa',$2,'leaf',false)",
        [inactive, "inactive-" + inactive],
      );
      await expect(async () =>
        ProductService.createProduct(
          f.personId,
          { ...fields(), categoryId: inactive },
          f.userId,
          context(),
        ),
      ).rejects.toMatchObject({ code: "PRODUCT_CATEGORY_INACTIVE" });
    });
    it("concorrência de preço com mesma revisão produz um sucesso e um 409", async () => {
      const f = await productFixture(pool()),
        p = await create(f);
      const results = await Promise.allSettled(
        [1390, 1490].map((newPriceCents) =>
          ProductService.updatePrice(
            p.id,
            f.personId,
            { ...command(p), newPriceCents },
            f.userId,
            context(),
          ),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { status: 409, code: "PRODUCT_REVISION_CONFLICT" },
      });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS count FROM app_price_versions WHERE product_id=$1",
            [p.id],
          )
        ).rows[0].count,
      ).toBe(2);
    });
    it("replay concorrente não duplica produto nem versão; fingerprint rejeita troca", async () => {
      const f = await productFixture(pool()),
        input = fields();
      const products = await Promise.all(
        [1, 2].map(() =>
          ProductService.createProduct(f.personId, input, f.userId, context()),
        ),
      );
      expect(products[0].id).toBe(products[1].id);
      const p = products[0],
        price = { ...command(p), newPriceCents: 1790 };
      const versions = await Promise.all(
        [1, 2].map(() =>
          ProductService.updatePrice(
            p.id,
            f.personId,
            price,
            f.userId,
            context(),
          ),
        ),
      );
      expect(versions[0].currentPrice.id).toBe(versions[1].currentPrice.id);
      await expect(
        ProductService.updatePrice(
          p.id,
          f.personId,
          { ...price, newPriceCents: 1990 },
          f.userId,
          context(),
        ),
      ).rejects.toMatchObject({ code: "PRODUCT_COMMAND_CONFLICT" });
    });
    it("validação depois de sanitizar e rollback de auditoria não deixam preço órfão", async () => {
      const f = await productFixture(pool());
      await expect(async () =>
        ProductService.createProduct(
          f.personId,
          { ...fields(), description: "<script>alert('danger')</script>" },
          f.userId,
          context(),
        ),
      ).rejects.toBeDefined();
      const p = await create(f);
      await expect(
        ProductService.updatePrice(
          p.id,
          f.personId,
          { ...command(p), newPriceCents: 1990 },
          f.userId,
          { ...context(), requestId: "bad" },
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(
        (await ProductService.getOwnerProduct(p.id, f.personId, f.userId))
          .revision,
      ).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS count FROM app_price_versions WHERE product_id=$1",
            [p.id],
          )
        ).rows[0].count,
      ).toBe(1);
    });
    it("sem mutações diretas para anon/authenticated e todas as novas tabelas ENABLE+FORCE", async () => {
      const f = await productFixture(pool()),
        p = await create(f);
      for (const role of ["anon", "authenticated"] as const)
        for (const table of [
          "app_products",
          "app_price_versions",
          "app_product_media",
        ])
          await expect(
            asRole(role, f.userId, `DELETE FROM ${table} WHERE id=$1`, [p.id]),
          ).rejects.toMatchObject({ code: "42501" });
      const rows = await pool().query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('app_products'::regclass,'app_price_versions'::regclass,'app_product_media'::regclass)",
      );
      expect(
        rows.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
      ).toBe(true);
    });
    it("exclusão de imóvel v46 pausa a loja preservando produtos e preços", async () => {
      const f = await productFixture(pool());
      let p = await photo(f, await create(f));
      p = await publish(f, p);
      const before = (
        await pool().query(
          "SELECT * FROM app_price_versions WHERE product_id=$1",
          [p.id],
        )
      ).rows;
      await pool().query("DELETE FROM app_properties WHERE id=$1", [
        f.propertyId,
      ]);
      expect(
        await ProductService.listPublicProducts({
          storeSlug: f.store.storeSlug,
        }),
      ).toEqual([]);
      expect(
        (
          await pool().query(
            "SELECT * FROM app_price_versions WHERE product_id=$1",
            [p.id],
          )
        ).rows,
      ).toEqual(before);
      expect(
        (await ProductService.getOwnerProduct(p.id, f.personId, f.userId)).id,
      ).toBe(p.id);
    });
    it("hard delete Auth/conta v46 continua operacional e enfileira fotos sem apagar por SQL", async () => {
      const f = await productFixture(pool()),
        p = await photo(f, await create(f));
      await pool().query("DELETE FROM auth.users WHERE id=$1", [f.userId]);
      for (const table of [
        "app_products",
        "app_price_versions",
        "app_product_media",
      ])
        expect(
          (
            await pool().query(
              `SELECT count(*)::int AS count FROM ${table} WHERE ${table === "app_products" ? "id" : "product_id"}=$1`,
              [p.id],
            )
          ).rows[0].count,
        ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS count FROM app_storage_deletion_queue WHERE bucket='product-media' AND object_path LIKE $1",
            [`%/${p.id}/%`],
          )
        ).rows[0].count,
      ).toBe(1);
    });
    it("falha do Storage/auditoria reverte mídia e revisão; upload repetido usa replay", async () => {
      const f = await productFixture(pool()),
        p = await create(f);
      storage.fail = true;
      try {
        await expect(photo(f, p)).rejects.toMatchObject({
          code: "PRODUCT_MEDIA_UNAVAILABLE",
        });
      } finally {
        storage.fail = false;
      }
      const input = command(p);
      const a = await ProductService.uploadMedia(
        p.id,
        f.personId,
        input,
        f.userId,
        png,
        "image/png",
        context(),
      );
      const uploads = storage.uploads.length;
      const b = await ProductService.uploadMedia(
        p.id,
        f.personId,
        input,
        f.userId,
        png,
        "image/png",
        context(),
      );
      expect(b.media[0].id).toBe(a.media[0].id);
      expect(storage.uploads.length).toBe(uploads);
      const retryCommand = command(a);
      await expect(
        ProductService.uploadMedia(
          p.id,
          f.personId,
          retryCommand,
          f.userId,
          png,
          "image/png",
          { ...context(), requestId: "bad" },
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(
        (await ProductService.getOwnerProduct(p.id, f.personId, f.userId))
          .media,
      ).toHaveLength(1);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS count FROM app_storage_deletion_queue WHERE reason='product_upload_rollback'",
          )
        ).rows[0].count,
      ).toBeGreaterThan(0);
      const abandonedPath = storage.uploads.at(-1)!;
      const retried = await ProductService.uploadMedia(
        p.id,
        f.personId,
        retryCommand,
        f.userId,
        png,
        "image/png",
        context(),
      );
      expect(retried.media).toHaveLength(2);
      expect(storage.uploads.at(-1)).not.toBe(abandonedPath);
      expect(
        (
          await pool().query(
            "SELECT media_url FROM app_product_media WHERE product_id=$1",
            [p.id],
          )
        ).rows.every((row) => !row.media_url.endsWith(abandonedPath)),
      ).toBe(true);
    });
  },
);
