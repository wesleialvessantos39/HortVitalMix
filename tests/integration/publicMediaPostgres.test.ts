import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { Pool } from "pg";
const storage = vi.hoisted(() => ({ buffer: Buffer.alloc(0), downloads: 0 }));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T22_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const u = new URL(value);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55432" ||
    u.pathname !== "/postgres"
  )
    throw Error("LOCAL_DATABASE_REQUIRED");
  const pg = (await import("pg")).default;
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async () => {
          storage.downloads++;
          return {
            data: new Blob([new Uint8Array(storage.buffer)]),
            error: null,
          };
        },
      }),
    },
  },
}));
import { dbPool } from "../../server/db/pool.ts";
import { PublicMediaService } from "../../server/services/PublicMediaService.ts";
import { productFixture } from "../helpers/productFixtures.ts";
describe.runIf(!!process.env.HVM_T22_LOCAL_DATABASE_URL)(
  "Fotos: autorização SQL real e compressão WebP",
  () => {
    let owner: Awaited<ReturnType<typeof productFixture>>,
      category: string,
      product: string,
      media: string,
      file: string;
    const pool = () => dbPool as Pool;
    beforeAll(async () => {
      owner = await productFixture(pool());
      category = randomUUID();
      product = randomUUID();
      media = randomUUID();
      file = randomUUID();
      await pool().query(
        "INSERT INTO app_categories(id,name,slug,icon_name) VALUES($1,'Fotos de teste',$2,'leaf')",
        [category, "media-" + category],
      );
      await pool().query(
        "INSERT INTO app_products(id,store_id,category_id,title,description,packaging_type,net_weight_grams,unit_type) VALUES($1,$2,$3,'Foto sintética','Fotografia de produto sintético para teste local','porcao_embalada',300,'un')",
        [product, owner.store.id, category],
      );
      await pool().query(
        "INSERT INTO app_price_versions(product_id,price_cents,created_by_user_id) VALUES($1,1200,$2)",
        [product, owner.userId],
      );
      await pool().query(
        "INSERT INTO app_product_media(id,product_id,media_url,is_primary) VALUES($1,$2,$3,true)",
        [
          media,
          product,
          `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/product-media/${owner.store.id}/${product}/${file}-${"a".repeat(64)}.png`,
        ],
      );
      await pool().query(
        "UPDATE app_products SET is_published=true WHERE id=$1",
        [product],
      );
      const pixels = Buffer.alloc(1600 * 1200 * 3);
      for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 31) % 256;
      storage.buffer = await sharp(pixels, {
        raw: { width: 1600, height: 1200, channels: 3 },
      })
        .png()
        .toBuffer();
    });
    afterAll(async () => {
      try {
        if (owner)
          await pool().query("DELETE FROM auth.users WHERE id=$1", [
            owner.userId,
          ]);
        if (category)
          await pool().query("DELETE FROM app_categories WHERE id=$1", [
            category,
          ]);
      } finally {
        await dbPool?.end();
      }
    });
    it("identidade do arquivo diferente do UUID da linha funciona; resize reduz bytes", async () => {
      const image = await PublicMediaService.image("product", file, 320),
        meta = await sharp(image.bytes).metadata();
      expect(meta.width).toBe(320);
      expect(meta.format).toBe("webp");
      expect(image.bytes.length).toBeLessThan(storage.buffer.length);
      expect(meta.exif).toBeUndefined();
      const n = storage.downloads;
      expect((await PublicMediaService.image("product", file, 320)).etag).toBe(
        image.etag,
      );
      expect(storage.downloads).toBe(n);
    });
    it("produto ocultado deixa de servir mesmo com bytes em memória", async () => {
      await pool().query(
        "UPDATE app_products SET is_published=false WHERE id=$1",
        [product],
      );
      const n = storage.downloads;
      await expect(
        PublicMediaService.image("product", file, 320),
      ).rejects.toMatchObject({ code: "MEDIA_NOT_FOUND", status: 404 });
      expect(storage.downloads).toBe(n);
    });
    it("capa pública real recebe variante; retirada não reutiliza bytes na origem", async () => {
      const cover = randomUUID();
      await pool().query(
        "INSERT INTO app_store_media(id,store_id,purpose,media_url,display_order) VALUES($1,$2,'cover',$3,0)",
        [
          cover,
          owner.store.id,
          `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/store-media/${owner.store.id}/${cover}-${"b".repeat(64)}.png`,
        ],
      );
      const image = await PublicMediaService.image("store", cover, 640);
      expect((await sharp(image.bytes).metadata()).width).toBe(640);
      expect(image.bytes.length).toBeLessThan(storage.buffer.length);
      await pool().query("DELETE FROM app_store_media WHERE id=$1", [cover]);
      await expect(
        PublicMediaService.image("store", cover, 640),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("documentos privados e ID inexistente não chegam ao Storage", async () => {
      const n = storage.downloads;
      await expect(
        PublicMediaService.image("document", file, 320),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        PublicMediaService.image("product", randomUUID(), 640),
      ).rejects.toMatchObject({ status: 404 });
      expect(storage.downloads).toBe(n);
    });
  },
);
