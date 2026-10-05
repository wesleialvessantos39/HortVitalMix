import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { InventoryService } from "./InventoryService.ts";
import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import { signedMediaUrls } from "../storage/signedMedia.ts";
import { storeImageUrls } from "../storage/storeMedia.ts";
import {
  HIGHLIGHTS_PAGE_SIZE,
  HighlightProductSchema,
  HighlightsQuerySchema,
  HighlightsResponseSchema,
} from "../../shared/contracts/highlights.ts";
import { sanitizeStoreBio } from "./ProducerStoreService.ts";
import {
  CreateProductSchema,
  UpdateProductSchema,
  UpdateProductPriceSchema,
  ToggleProductPublishSchema,
  ProductMediaCommandSchema,
  ProductCommandSchema,
  ProductResponseSchema,
  PublicProductSchema,
  ProductPriceSchema,
  PRODUCT_MEDIA_BUCKET,
  PRODUCT_MEDIA_ORIGIN,
  PRODUCT_MEDIA_MAX_BYTES,
  type CreateProduct,
  type UpdateProduct,
  type Product,
  type ProductPriceCommand,
  type ProductPublishCommand,
  type ProductMediaCommand,
  type ProductCommand,
  type ProducerCatalog,
} from "../../shared/contracts/product.ts";

export class ProductError extends Error {
  constructor(
    public code: string,
    public status: number,
    public currentRevision?: number,
  ) {
    super(code);
    this.name = "ProductError";
  }
}
export type ProductAuditContext = { requestId: string; ipHash: string };
type Store = {
  id: string;
  store_name: string;
  store_slug: string;
  status: string;
  eligible: boolean;
};
type Row = {
  id: string;
  store_id: string;
  category_id: string;
  category_name: string;
  title: string;
  description: string;
  packaging_type: Product["packagingType"];
  net_weight_grams: number;
  unit_type: Product["unitType"];
  shelf_life_days: number;
  conservation_notes: string;
  is_published: boolean;
  revision: number;
  price_id: string;
  price_cents: number;
  valid_from: Date;
  store_slug: string;
  store_name: string;
};
const selectProduct = `SELECT p.*,c.name AS category_name,s.store_slug,s.store_name,
 v.id AS price_id,v.price_cents,v.valid_from FROM public.app_products p
 JOIN public.app_categories c ON c.id=p.category_id
 JOIN public.app_producer_stores s ON s.id=p.store_id
 JOIN LATERAL (SELECT id,price_cents,valid_from FROM public.app_price_versions
   WHERE product_id=p.id ORDER BY valid_from DESC LIMIT 1) v ON true`;
const visible = `p.is_published AND c.is_active AND hvm_store_private.store_is_visible(p.store_id)`;
function pool() {
  if (!dbPool) throw new ProductError("DEPENDENCY_UNAVAILABLE", 503);
  return dbPool;
}
function translate(error: unknown): never {
  if (error instanceof ProductError) throw error;
  if (error instanceof z.ZodError)
    throw new ProductError("PRODUCT_VALIDATION_FAILED", 422);
  const e = error as { code?: string; message?: string };
  if (e.code === "23505")
    throw new ProductError("PRODUCT_COMMAND_CONFLICT", 409);
  if (["23514", "23503", "22P02"].includes(e.code ?? ""))
    throw new ProductError(
      e.message?.startsWith("PRODUCT_")
        ? e.message
        : "PRODUCT_VALIDATION_FAILED",
      422,
    );
  throw new ProductError("DEPENDENCY_UNAVAILABLE", 503);
}
async function ownedStore(
  client: PoolClient,
  personId: string,
  userId: string,
  lock = false,
): Promise<Store | null> {
  // Identity is rechecked inside the transaction, including command replays.
  const profile = await client.query<{ id: string }>(
    `SELECT pp.id FROM public.app_producer_profiles pp JOIN public.app_people pe ON pe.id=pp.person_id
     JOIN public.app_users u ON u.id=pe.user_id
     WHERE pe.id=$1 AND u.id=$2 AND pe.archived_at IS NULL
       AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
       AND EXISTS(SELECT 1 FROM public.app_user_role_assignments ra WHERE ra.user_id=u.id AND ra.role_code='producer'
         AND ra.revoked_at IS NULL AND (ra.expires_at IS NULL OR ra.expires_at>clock_timestamp()))
     ${lock ? "FOR UPDATE OF pp" : ""}`,
    [personId, userId],
  );
  if (!profile.rows[0])
    throw new ProductError("PRODUCER_PROFILE_REQUIRED", 403);
  const result = await client.query<Store>(
    `SELECT s.id,s.store_name,s.store_slug,s.status,hvm_store_private.store_is_visible(s.id) AS eligible
     FROM public.app_producer_stores s WHERE s.producer_profile_id=$1 ${lock ? "FOR UPDATE OF s" : ""}`,
    [profile.rows[0].id],
  );
  return result.rows[0] ?? null;
}
function requireEligible(store: Store | null) {
  if (!store?.eligible)
    throw new ProductError("PRODUCT_CREATE_FORBIDDEN_UNVERIFIED_STORE", 403);
}
async function activeCategory(client: PoolClient, id: string) {
  if (
    !(
      await client.query(
        "SELECT id FROM public.app_categories WHERE id=$1 AND is_active FOR SHARE",
        [id],
      )
    ).rows[0]
  )
    throw new ProductError("PRODUCT_CATEGORY_INACTIVE", 422);
}
async function find(
  client: PoolClient,
  id: string,
  storeId: string,
  lock = false,
) {
  const result = await client.query<Row>(
    `${selectProduct} WHERE p.id=$1 AND p.store_id=$2 ${lock ? "FOR UPDATE OF p" : ""}`,
    [id, storeId],
  );
  if (!result.rows[0]) throw new ProductError("PRODUCT_NOT_FOUND", 404);
  return result.rows[0];
}
function mediaPath(url: string) {
  return url.slice(
    `${PRODUCT_MEDIA_ORIGIN}/storage/v1/object/${PRODUCT_MEDIA_BUCKET}/`.length,
  );
}
async function responses(client: PoolClient, rows: Row[]): Promise<Product[]> {
  if (!rows.length) return [];
  const result = await client.query<{
    id: string;
    product_id: string;
    media_url: string;
    display_order: number;
    is_primary: boolean;
  }>(
    "SELECT id,product_id,media_url,display_order,is_primary FROM public.app_product_media WHERE product_id=ANY($1::uuid[]) ORDER BY display_order,id",
    [rows.map((row) => row.id)],
  );
  const urls = new Map<string, string>();
  if (result.rows.length) {
    if (!supabaseAdmin)
      throw new ProductError("PRODUCT_MEDIA_UNAVAILABLE", 503);
    const signed = await signedMediaUrls(
      PRODUCT_MEDIA_BUCKET,
      result.rows.map((m) => mediaPath(m.media_url)),
    ).catch(() => {
      throw new ProductError("PRODUCT_MEDIA_UNAVAILABLE", 503);
    });
    result.rows.forEach((m) =>
      urls.set(m.id, signed.get(mediaPath(m.media_url))!),
    );
  }
  return rows.map((row) =>
    ProductResponseSchema.parse({
      id: row.id,
      storeId: row.store_id,
      categoryId: row.category_id,
      categoryName: row.category_name,
      title: row.title,
      description: row.description,
      packagingType: row.packaging_type,
      netWeightGrams: row.net_weight_grams,
      unitType: row.unit_type,
      shelfLifeDays: row.shelf_life_days,
      conservationNotes: row.conservation_notes,
      isPublished: row.is_published,
      revision: row.revision,
      currentPrice: {
        id: row.price_id,
        priceCents: row.price_cents,
        validFrom: row.valid_from.toISOString(),
      },
      media: result.rows
        .filter((m) => m.product_id === row.id)
        .map((m) => ({
          id: m.id,
          url: urls.get(m.id),
          displayOrder: m.display_order,
          isPrimary: m.is_primary,
        })),
    }),
  );
}
async function response(client: PoolClient, row: Row) {
  return (await responses(client, [row]))[0];
}
function cleanFields(input: CreateProduct | UpdateProduct) {
  return {
    ...input,
    title: sanitizeStoreBio(input.title),
    description: sanitizeStoreBio(input.description),
    conservationNotes: sanitizeStoreBio(input.conservationNotes),
  };
}
const fieldValues = (input: CreateProduct | UpdateProduct) => [
  input.categoryId,
  input.title,
  input.description,
  input.packagingType,
  input.netWeightGrams,
  input.unitType,
  input.shelfLifeDays,
  input.conservationNotes,
];
async function bump(client: PoolClient, id: string) {
  await client.query(
    "UPDATE public.app_products SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
    [id],
  );
}
function snapshot(row: Row) {
  return {
    revision: row.revision,
    isPublished: row.is_published,
    priceVersionId: row.price_id,
    priceCents: row.price_cents,
  };
}
async function mutate<T extends { commandId: string }>(
  id: string | null,
  personId: string,
  userId: string,
  input: T,
  action: string,
  context: ProductAuditContext,
  change: (
    client: PoolClient,
    store: Store,
    row: Row | null,
  ) => Promise<string>,
): Promise<Product> {
  const client = await pool().connect();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(14,hashtext($1))", [
      input.commandId,
    ]);
    const store = await ownedStore(client, personId, userId, true);
    if (!store)
      throw new ProductError("PRODUCT_CREATE_FORBIDDEN_UNVERIFIED_STORE", 403);
    const prior = await client.query<{
      actor_id: string;
      target_entity: string;
      target_id: string;
      action: string;
      payload_after: { commandFingerprint?: string };
    }>(
      "SELECT actor_id,target_entity,target_id,action,payload_after FROM public.app_audit_events WHERE command_id=$1",
      [input.commandId],
    );
    const event = prior.rows[0];
    if (event) {
      if (
        event.actor_id !== userId ||
        event.target_entity !== "app_products" ||
        event.action !== action ||
        (id && id !== event.target_id) ||
        event.payload_after?.commandFingerprint !== fingerprint
      )
        throw new ProductError("PRODUCT_COMMAND_CONFLICT", 409);
      const result = await response(
        client,
        await find(client, event.target_id, store.id),
      );
      await client.query("COMMIT");
      return result;
    }
    const row = id ? await find(client, id, store.id, true) : null;
    if (row && row.revision !== (input as T & ProductCommand).expectedRevision)
      throw new ProductError("PRODUCT_REVISION_CONFLICT", 409, row.revision);
    const savedId = await change(client, store, row);
    const saved = await find(client, savedId, store.id);
    await client.query(
      `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_before,payload_after,client_ip_hash,command_id)
       VALUES($1,$2,'producer',$3,'app_products',$4,$5,$6,$7,$8)`,
      [
        context.requestId,
        userId,
        action,
        savedId,
        row ? JSON.stringify(snapshot(row)) : null,
        JSON.stringify({ ...snapshot(saved), commandFingerprint: fingerprint }),
        context.ipHash,
        input.commandId,
      ],
    );
    const result = await response(client, saved);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    translate(error);
  } finally {
    client.release();
  }
}
async function readOwner<T>(
  personId: string,
  userId: string,
  run: (client: PoolClient, store: Store | null) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await run(
      client,
      await ownedStore(client, personId, userId),
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    translate(error);
  } finally {
    client.release();
  }
}
export function productImageExtension(file: Buffer, contentType: string) {
  if (!file.length || file.length > PRODUCT_MEDIA_MAX_BYTES)
    throw new ProductError("PRODUCT_IMAGE_TOO_LARGE", 422);
  if (
    contentType === "image/jpeg" &&
    file[0] === 255 &&
    file[1] === 216 &&
    file[2] === 255
  )
    return "jpg";
  if (
    contentType === "image/png" &&
    file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    contentType === "image/webp" &&
    file.toString("ascii", 0, 4) === "RIFF" &&
    file.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  throw new ProductError("PRODUCT_IMAGE_INVALID", 422);
}
export const ProductService = {
  async listHighlights(raw: z.infer<typeof HighlightsQuerySchema>) {
    const query = HighlightsQuerySchema.parse(raw);
    await InventoryService.releaseExpiredReservations();
    const client = await pool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const selection = selectProduct
        .replace(
          "SELECT p.*,",
          "SELECT p.*,ranked.municipality_id,ranked.municipality,s.public_producer_name,s.logo_url,",
        )
        .replace(
          "WHERE product_id=p.id ORDER BY",
          "WHERE product_id=p.id AND valid_from<=clock_timestamp() ORDER BY",
        );
      const result = await client.query<
        Row & {
          municipality_id: string;
          municipality: string;
          public_producer_name: string | null;
          logo_url: string | null;
        }
      >(
        `WITH ranked AS (
        SELECT p.id,m.id AS municipality_id,m.name AS municipality,
          row_number() OVER(PARTITION BY m.id ORDER BY p.created_at DESC,p.id) AS regional_rank
        FROM public.app_products p JOIN public.app_categories c ON c.id=p.category_id
        JOIN public.app_producer_stores s ON s.id=p.store_id
        JOIN public.app_properties property ON property.id=s.property_id
        JOIN public.app_municipalities m ON m.state=property.state AND m.name_normalized=public.fn_locality_normalize(property.municipality)
        WHERE ${visible} AND m.is_active AND ($1::uuid IS NULL OR m.id=$1)
          AND EXISTS(SELECT 1 FROM public.app_price_versions pv WHERE pv.product_id=p.id AND pv.valid_from<=clock_timestamp())
      ) ${selection} JOIN ranked ON ranked.id=p.id
      ORDER BY ranked.regional_rank,ranked.municipality,ranked.municipality_id,p.id LIMIT $2 OFFSET $3`,
        [
          query.municipalityId ?? null,
          HIGHLIGHTS_PAGE_SIZE + 1,
          (query.page - 1) * HIGHLIGHTS_PAGE_SIZE,
        ],
      );
      const rows = result.rows.slice(0, HIGHLIGHTS_PAGE_SIZE);
      const products = await responses(client, rows);
      const avatars = await storeImageUrls(rows.map((row) => row.logo_url));
      const available = await InventoryService.publicAvailability(
        client,
        rows.map((row) => row.id),
      );
      const response = HighlightsResponseSchema.parse({
        page: query.page,
        hasMore: result.rows.length > HIGHLIGHTS_PAGE_SIZE,
        products: products.map(
          (
            {
              storeId: _storeId,
              revision: _revision,
              isPublished: _published,
              ...product
            },
            index,
          ) =>
            HighlightProductSchema.parse({
              ...product,
              inStock: available.has(product.id),
              storeSlug: rows[index].store_slug,
              storeName: rows[index].store_name,
              producerName:
                rows[index].public_producer_name ?? rows[index].store_name,
              producerAvatarUrl: avatars.get(rows[index].logo_url) ?? null,
              municipalityId: rows[index].municipality_id,
              municipality: rows[index].municipality,
            }),
        ),
      });
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      translate(error);
    } finally {
      client.release();
    }
  },
  listOwnerProducts(
    personId: string,
    userId: string,
  ): Promise<ProducerCatalog> {
    return readOwner(personId, userId, async (client, store) => ({
      products: store
        ? await responses(
            client,
            (
              await client.query<Row>(
                `${selectProduct} WHERE p.store_id=$1 ORDER BY p.created_at DESC,p.id`,
                [store.id],
              )
            ).rows,
          )
        : [],
      store: store
        ? {
            id: store.id,
            name: store.store_name,
            slug: store.store_slug,
            status: store.status,
          }
        : null,
      canCreate: Boolean(store?.eligible),
    }));
  },
  getOwnerProduct(id: string, personId: string, userId: string) {
    return readOwner(personId, userId, async (client, store) => {
      if (!store) throw new ProductError("PRODUCT_NOT_FOUND", 404);
      return response(client, await find(client, id, store.id));
    });
  },
  createProduct(
    personId: string,
    value: CreateProduct,
    userId: string,
    context: ProductAuditContext,
  ) {
    const input = CreateProductSchema.parse(
      cleanFields(CreateProductSchema.parse(value)),
    );
    return mutate(
      null,
      personId,
      userId,
      input,
      "product.created",
      context,
      async (client, store) => {
        requireEligible(store);
        await activeCategory(client, input.categoryId);
        const result = await client.query<{ id: string }>(
          `INSERT INTO public.app_products(store_id,category_id,title,description,packaging_type,net_weight_grams,unit_type,shelf_life_days,conservation_notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [store.id, ...fieldValues(input)],
        );
        const id = result.rows[0].id;
        await client.query(
          "INSERT INTO public.app_price_versions(product_id,price_cents,created_by_user_id) VALUES($1,$2,$3)",
          [id, input.priceCents, userId],
        );
        return id;
      },
    );
  },
  updateProduct(
    id: string,
    personId: string,
    value: UpdateProduct,
    userId: string,
    context: ProductAuditContext,
  ) {
    const input = UpdateProductSchema.parse(
      cleanFields(UpdateProductSchema.parse(value)),
    );
    return mutate(
      id,
      personId,
      userId,
      input,
      "product.updated",
      context,
      async (client, store) => {
        requireEligible(store);
        await activeCategory(client, input.categoryId);
        await client.query(
          `UPDATE public.app_products SET category_id=$2,title=$3,description=$4,packaging_type=$5,
       net_weight_grams=$6,unit_type=$7,shelf_life_days=$8,conservation_notes=$9,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
          [id, ...fieldValues(input)],
        );
        return id;
      },
    );
  },
  updatePrice(
    id: string,
    personId: string,
    value: ProductPriceCommand,
    userId: string,
    context: ProductAuditContext,
  ) {
    const input = UpdateProductPriceSchema.parse(value);
    return mutate(
      id,
      personId,
      userId,
      input,
      "product.price_changed",
      context,
      async (client, store) => {
        requireEligible(store);
        await bump(client, id);
        await client.query(
          `INSERT INTO public.app_price_versions(product_id,price_cents,created_by_user_id,valid_from)
       VALUES($1,$2,$3,GREATEST(clock_timestamp(),(SELECT max(valid_from)+interval '1 microsecond' FROM public.app_price_versions WHERE product_id=$1)))`,
          [id, input.newPriceCents, userId],
        );
        return id;
      },
    );
  },
  // Internal domain method, with no unauthenticated price endpoint. Future
  // carts/orders must persist the returned version ID in their snapshots.
  async getCurrentPrice(productId: string) {
    try {
      const result = await pool().query<{
        id: string;
        price_cents: number;
        valid_from: Date;
      }>(
        "SELECT id,price_cents,valid_from FROM public.app_price_versions WHERE product_id=$1 ORDER BY valid_from DESC LIMIT 1",
        [z.uuid().parse(productId)],
      );
      const row = result.rows[0];
      if (!row) throw new ProductError("PRODUCT_NOT_FOUND", 404);
      return ProductPriceSchema.parse({
        id: row.id,
        priceCents: row.price_cents,
        validFrom: row.valid_from.toISOString(),
      });
    } catch (error) {
      translate(error);
    }
  },
  togglePublish(
    id: string,
    personId: string,
    value: ProductPublishCommand,
    userId: string,
    context: ProductAuditContext,
  ) {
    const input = ToggleProductPublishSchema.parse(value);
    return mutate(
      id,
      personId,
      userId,
      input,
      input.isPublished ? "product.published" : "product.unpublished",
      context,
      async (client, store, row) => {
        if (input.isPublished) {
          requireEligible(store);
          await activeCategory(client, row!.category_id);
          if (
            !(
              await client.query(
                "SELECT id FROM public.app_product_media WHERE product_id=$1 AND is_primary",
                [id],
              )
            ).rows[0]
          )
            throw new ProductError("PRODUCT_PRIMARY_MEDIA_REQUIRED", 422);
        }
        await client.query(
          "UPDATE public.app_products SET is_published=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
          [id, input.isPublished],
        );
        return id;
      },
    );
  },
  async uploadMedia(
    id: string,
    personId: string,
    value: ProductCommand,
    userId: string,
    file: Buffer,
    contentType: string,
    context: ProductAuditContext,
  ) {
    const input = ProductCommandSchema.parse(value),
      extension = productImageExtension(file, contentType);
    const fileHash = createHash("sha256").update(file).digest("hex");
    let uploadedPath: string | null = null;
    try {
      return await mutate(
        id,
        personId,
        userId,
        { ...input, fileHash, contentType },
        "product.media_added",
        context,
        async (client, store) => {
          requireEligible(store);
          const existing = await client.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM public.app_product_media WHERE product_id=$1",
            [id],
          );
          if (existing.rows[0].count >= 6)
            throw new ProductError("PRODUCT_MEDIA_LIMIT", 422);
          if (!supabaseAdmin)
            throw new ProductError("PRODUCT_MEDIA_UNAVAILABLE", 503);
          // Each failed transaction may leave a queued object. A new attempt
          // gets a fresh path; successful command replays never upload again.
          const path = `${store.id}/${id}/${randomUUID()}-${fileHash}.${extension}`;
          const upload = await supabaseAdmin.storage
            .from(PRODUCT_MEDIA_BUCKET)
            .upload(path, file, { contentType, upsert: false });
          if (upload.error)
            throw new ProductError("PRODUCT_MEDIA_UNAVAILABLE", 503);
          uploadedPath = path;
          await client.query(
            `INSERT INTO public.app_product_media(product_id,media_url,display_order,is_primary)
         VALUES($1,$2,$3,NOT EXISTS(SELECT 1 FROM public.app_product_media WHERE product_id=$1 AND is_primary))`,
            [
              id,
              `${PRODUCT_MEDIA_ORIGIN}/storage/v1/object/${PRODUCT_MEDIA_BUCKET}/${path}`,
              existing.rows[0].count,
            ],
          );
          await bump(client, id);
          return id;
        },
      );
    } catch (error) {
      if (uploadedPath) {
        // A lost COMMIT response has an uncertain outcome. Never enqueue an
        // image that a committed media row still references.
        await pool()
          .query(
            `INSERT INTO public.app_storage_deletion_queue(bucket,object_path,reason)
          SELECT $1,$2,'product_upload_rollback' WHERE NOT EXISTS
          (SELECT 1 FROM public.app_product_media WHERE media_url=$3) ON CONFLICT DO NOTHING`,
            [
              PRODUCT_MEDIA_BUCKET,
              uploadedPath,
              `${PRODUCT_MEDIA_ORIGIN}/storage/v1/object/${PRODUCT_MEDIA_BUCKET}/${uploadedPath}`,
            ],
          )
          .catch(() => {});
      }
      throw error;
    }
  },
  setPrimaryMedia(
    id: string,
    personId: string,
    value: ProductMediaCommand,
    userId: string,
    context: ProductAuditContext,
  ) {
    const input = ProductMediaCommandSchema.parse(value);
    return mutate(
      id,
      personId,
      userId,
      input,
      "product.primary_media_changed",
      context,
      async (client, store) => {
        requireEligible(store);
        if (
          !(
            await client.query(
              "SELECT id FROM public.app_product_media WHERE id=$1 AND product_id=$2",
              [input.mediaId, id],
            )
          ).rows[0]
        )
          throw new ProductError("PRODUCT_MEDIA_NOT_FOUND", 404);
        await client.query(
          "UPDATE public.app_product_media SET is_primary=false WHERE product_id=$1 AND is_primary",
          [id],
        );
        await client.query(
          "UPDATE public.app_product_media SET is_primary=true WHERE id=$1 AND product_id=$2",
          [input.mediaId, id],
        );
        await bump(client, id);
        return id;
      },
    );
  },
  removeMedia(
    id: string,
    personId: string,
    value: ProductMediaCommand,
    userId: string,
    context: ProductAuditContext,
  ) {
    const input = ProductMediaCommandSchema.parse(value);
    return mutate(
      id,
      personId,
      userId,
      input,
      "product.media_removed",
      context,
      async (client, _store, row) => {
        const media = await client.query<{ is_primary: boolean }>(
          "SELECT is_primary FROM public.app_product_media WHERE id=$1 AND product_id=$2",
          [input.mediaId, id],
        );
        if (!media.rows[0])
          throw new ProductError("PRODUCT_MEDIA_NOT_FOUND", 404);
        if (row!.is_published && media.rows[0].is_primary)
          throw new ProductError("PRODUCT_UNPUBLISH_BEFORE_MEDIA_REMOVAL", 422);
        await client.query(
          "DELETE FROM public.app_product_media WHERE id=$1 AND product_id=$2",
          [input.mediaId, id],
        );
        await bump(client, id);
        return id;
      },
    );
  },
  async listPublicProducts(query: {
    categoryId?: string;
    storeSlug?: string;
    search?: string;
  }) {
    await InventoryService.releaseExpiredReservations();
    const client = await pool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await client.query<Row>(
        `${selectProduct} WHERE ${visible}
       AND ($1::uuid IS NULL OR p.category_id=$1) AND ($2::text IS NULL OR s.store_slug=$2)
       AND ($3::text IS NULL OR strpos(lower(p.title),lower($3))>0)
       ORDER BY p.created_at DESC,p.id LIMIT 100`,
        [
          query.categoryId ?? null,
          query.storeSlug ?? null,
          query.search || null,
        ],
      );
      const products = await responses(client, result.rows);
      const available = await InventoryService.publicAvailability(
        client,
        result.rows.map((row) => row.id),
      );
      const publicProducts = products.map(
        (
          {
            storeId: _storeId,
            revision: _revision,
            isPublished: _published,
            ...product
          },
          index,
        ) =>
          PublicProductSchema.parse({
            ...product,
            inStock: available.has(product.id),
            storeSlug: result.rows[index].store_slug,
            storeName: result.rows[index].store_name,
          }),
      );
      await client.query("COMMIT");
      return publicProducts;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      translate(error);
    } finally {
      client.release();
    }
  },
};
