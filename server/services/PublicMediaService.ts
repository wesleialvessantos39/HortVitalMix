import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { supabaseAdmin } from "../supabase/client.ts";
import { CommerceError, commerceTransaction } from "./CommerceSupport.ts";
const MAX_BYTES = 24 * 1024 * 1024;
const cached = new Map<
    string,
    { bytes: Buffer; etag: string; until: number }
  >(),
  pending = new Map<string, Promise<{ bytes: Buffer; etag: string }>>();
let size = 0,
  processing = 0;
const queue: Array<() => void> = [];
sharp.cache({ memory: 16, files: 0, items: 32 });
sharp.concurrency(1);
async function convert(file: Buffer, width: number) {
  if (processing >= 2) await new Promise<void>((done) => queue.push(done));
  else processing++;
  try {
    return await sharp(file, { limitInputPixels: 20_000_000 })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 72, effort: 3 })
      .toBuffer();
  } finally {
    const next = queue.shift();
    if (next) next();
    else processing--;
  }
}
// Only three bounded variants. Originals stay private, immutable and unchanged.
export const PublicMediaQuerySchema = z
  .object({
    width: z.coerce
      .number()
      .pipe(z.union([z.literal(320), z.literal(640), z.literal(1280)]))
      .default(640),
  })
  .strict();
export const PublicMediaService = {
  async image(kind: string, idInput: string, width: number) {
    const id = z.uuid().parse(idInput),
      bucket =
        kind === "product"
          ? "product-media"
          : kind === "store"
            ? "store-media"
            : null;
    if (!bucket) throw new CommerceError("MEDIA_NOT_FOUND", 404);
    // Check visibility on every origin request, even if bytes are already in memory.
    const url = await commerceTransaction(async (c) => {
      const result =
        kind === "product"
          ? await c.query<{ media_url: string }>(
              `SELECT m.media_url FROM public.app_product_media m JOIN public.app_products p ON p.id=m.product_id JOIN public.app_categories cat ON cat.id=p.category_id WHERE (m.id=$1 OR m.media_url LIKE $2) AND p.is_published AND cat.is_active AND hvm_store_private.store_is_visible(p.store_id) AND EXISTS(SELECT 1 FROM public.app_price_versions pv WHERE pv.product_id=p.id AND pv.valid_from<=clock_timestamp())`,
              [id, `%/${id}-%`],
            )
          : await c.query<{ media_url: string }>(
              `SELECT m.media_url FROM public.app_store_media m JOIN public.app_producer_stores s ON s.id=m.store_id WHERE m.id=$1 AND hvm_store_private.store_is_visible(s.id) AND (m.purpose='cover' OR s.logo_url=m.media_url)`,
              [id],
            );
      if (!result.rows[0]) throw new CommerceError("MEDIA_NOT_FOUND", 404);
      return result.rows[0].media_url;
    });
    const prefix = `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/${bucket}/`;
    if (!url.startsWith(prefix) || !supabaseAdmin)
      throw new CommerceError("MEDIA_NOT_FOUND", 404);
    const path = url.slice(prefix.length),
      key = bucket + ":" + path + ":" + width;
    const previous = cached.get(key);
    if (previous && previous.until > Date.now()) return previous;
    if (previous) {
      cached.delete(key);
      size -= previous.bytes.length;
    }
    const inflight = pending.get(key);
    if (inflight) return inflight;
    if (pending.size >= 12) throw new CommerceError("MEDIA_BUSY", 503);
    const work = (async () => {
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .download(path);
      if (error || !data) throw new CommerceError("MEDIA_NOT_FOUND", 404);
      if (data.size > 2 * 1024 * 1024)
        throw new CommerceError("MEDIA_TOO_LARGE", 413);
      const bytes = await convert(Buffer.from(await data.arrayBuffer()), width);
      const value = {
        bytes,
        etag: '"' + createHash("sha256").update(bytes).digest("hex") + '"',
        until: Date.now() + 300000,
      };
      cached.set(key, value);
      size += bytes.length;
      while (size > MAX_BYTES && cached.size) {
        const oldest = cached.keys().next().value!;
        size -= cached.get(oldest)!.bytes.length;
        cached.delete(oldest);
      }
      return value;
    })();
    pending.set(key, work);
    try {
      return await work;
    } finally {
      pending.delete(key);
    }
  },
};
