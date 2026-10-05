import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { dbPool } from "../db/pool.ts";
import { ARIQUEMES_CENTER } from "../../shared/contracts/delivery.ts";
import { storeImageUrls } from "../storage/storeMedia.ts";
import {
  DISCOVERY_PAGE_SIZE,
  DiscoveryAvatarSchema,
  FavoritesQuerySchema,
  FavoritesResponseSchema,
  SearchStoresQuerySchema,
  SearchStoresResponseSchema,
  ToggleFavoriteSchema,
  ToggleFavoriteResponseSchema,
  type SearchStoresQuery,
  type FavoritesQuery,
  type ToggleFavorite,
} from "../../shared/contracts/discovery.ts";

export class DiscoveryError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
    this.name = "DiscoveryError";
  }
}
export type FavoriteAuditContext = { requestId: string; ipHash: string };
async function transaction<T>(
  run: (client: PoolClient) => Promise<T>,
  readOnly = false,
): Promise<T> {
  if (!dbPool) throw new DiscoveryError("DEPENDENCY_UNAVAILABLE", 503);
  let client: PoolClient | undefined;
  try {
    client = await dbPool.connect();
    await client.query(
      readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN",
    );
    // Transaction-local role resets at COMMIT/ROLLBACK, including pooler reuse.
    // Favorites use only the explicitly granted backend privileges.
    if (!readOnly) await client.query("SET LOCAL ROLE service_role");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => {});
    if (error instanceof DiscoveryError) throw error;
    if (error instanceof z.ZodError)
      throw new DiscoveryError("DISCOVERY_VALIDATION_FAILED", 422);
    if ((error as { code?: string }).code === "23505")
      throw new DiscoveryError("FAVORITE_COMMAND_CONFLICT", 409);
    throw new DiscoveryError("DEPENDENCY_UNAVAILABLE", 503);
  } finally {
    client?.release();
  }
}
async function identity(
  client: PoolClient,
  personId: string,
  userId: string,
  lock = false,
) {
  const result = await client.query(
    `SELECT pe.id FROM public.app_people pe JOIN public.app_users u ON u.id=pe.user_id
     WHERE pe.id=$1 AND u.id=$2 AND pe.archived_at IS NULL
      AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
     ${lock ? "FOR UPDATE OF pe FOR SHARE OF u" : ""}`,
    [personId, userId],
  );
  if (!result.rows[0]) throw new DiscoveryError("FAVORITE_OWNER_REQUIRED", 403);
}
const visibleProduct = (alias: string) => `${alias}.is_published
 AND hvm_store_private.store_is_visible(${alias}.store_id)
 AND EXISTS(SELECT 1 FROM public.app_categories c WHERE c.id=${alias}.category_id AND c.is_active)
 AND EXISTS(SELECT 1 FROM public.app_price_versions pv WHERE pv.product_id=${alias}.id AND pv.valid_from<=clock_timestamp())`;
// Escape LIKE metacharacters: a user's '%' or '_' is literal search text.
const searchPattern = (value?: string) =>
  value?.trim() ? "%" + value.trim().replace(/[\\%_]/g, "\\$&") + "%" : null;

export const DiscoveryService = {
  async searchStores(input: SearchStoresQuery) {
    const query = SearchStoresQuerySchema.parse(input);
    const latitude = query.latitude ?? ARIQUEMES_CENTER.latitude;
    const longitude = query.longitude ?? ARIQUEMES_CENTER.longitude;
    return transaction(async (client) => {
      const result = await client.query<{
        id: string;
        store_slug: string;
        store_name: string;
        logo_url: string | null;
        municipality: string;
        state: string;
        trust_level: number;
        distance_km: number | null;
      }>(
        `SELECT s.id,s.store_slug,s.store_name,s.logo_url,p.municipality,p.state,pp.trust_level,
          public.fn_haversine_km(p.latitude_sede,p.longitude_sede,$1,$2) AS distance_km
         FROM public.app_producer_stores s
         JOIN public.app_producer_profiles pp ON pp.id=s.producer_profile_id
         JOIN public.app_properties p ON p.id=s.property_id
         WHERE s.status='active' AND pp.verification_status='verified'
          AND hvm_store_private.store_is_visible(s.id)
          AND ($3::text IS NULL OR s.store_name ILIKE $3 OR EXISTS(
            SELECT 1 FROM public.app_products product WHERE product.store_id=s.id
             AND product.title ILIKE $3 AND ${visibleProduct("product")}))
          AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM public.app_products product
            JOIN public.app_categories category ON category.id=product.category_id
            WHERE product.store_id=s.id AND category.slug=$4 AND ${visibleProduct("product")}))
          AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM public.app_municipalities m
            WHERE m.id=$5 AND m.is_active AND m.state=p.state
             AND m.name_normalized=public.fn_locality_normalize(p.municipality)))
         ORDER BY distance_km ASC NULLS LAST,pp.trust_level DESC,s.id ASC LIMIT $6 OFFSET $7`,
        [
          latitude,
          longitude,
          searchPattern(query.query),
          query.categorySlug ?? null,
          query.municipalityId ?? null,
          DISCOVERY_PAGE_SIZE + 1,
          (query.page - 1) * DISCOVERY_PAGE_SIZE,
        ],
      );
      const avatars = await storeImageUrls(
        result.rows.slice(0, DISCOVERY_PAGE_SIZE).map((row) => row.logo_url),
      );
      return SearchStoresResponseSchema.parse({
        stores: result.rows.slice(0, DISCOVERY_PAGE_SIZE).map((row) => ({
          id: row.id,
          slug: row.store_slug,
          name: row.store_name,
          avatarUrl: DiscoveryAvatarSchema.safeParse(avatars.get(row.logo_url))
            .success
            ? avatars.get(row.logo_url)
            : null,
          location: `${row.municipality}/${row.state}`,
          distanceKm: row.distance_km === null ? null : Number(row.distance_km),
          isVerified: true,
          trustLevel: row.trust_level,
        })),
        page: query.page,
        pageSize: DISCOVERY_PAGE_SIZE,
        hasMore: query.page < 1000 && result.rows.length > DISCOVERY_PAGE_SIZE,
        distanceReference:
          query.latitude === undefined ? "ariquemes" : "consumer",
      });
    }, true);
  },
  async listFavorites(
    personId: string,
    userId: string,
    input: FavoritesQuery = { page: 1 },
  ) {
    const query = FavoritesQuerySchema.parse(input);
    return transaction(async (client) => {
      await identity(client, personId, userId);
      const result = await client.query<{
        target_type: string;
        target_id: string;
      }>(
        `SELECT f.target_type,f.target_id FROM public.app_favorites f WHERE f.person_id=$1
         AND ($2::text IS NULL OR f.target_type=$2)
         AND ($3::uuid[] IS NULL OR f.target_id=ANY($3))
         AND ((f.target_type='store' AND hvm_store_private.store_is_visible(f.target_id))
          OR (f.target_type='product' AND EXISTS(SELECT 1 FROM public.app_products p WHERE p.id=f.target_id AND ${visibleProduct("p")})))
         ORDER BY f.created_at DESC,f.id LIMIT 101 OFFSET $4`,
        [
          personId,
          query.targetType ?? null,
          query.targetIds ?? null,
          (query.page - 1) * 100,
        ],
      );
      return FavoritesResponseSchema.parse({
        favorites: result.rows
          .slice(0, 100)
          .map((r) => ({ targetType: r.target_type, targetId: r.target_id })),
        page: query.page,
        hasMore: query.page < 1000 && result.rows.length > 100,
      });
    }, true);
  },
  async toggleFavorite(
    personId: string,
    userId: string,
    raw: ToggleFavorite,
    context: FavoriteAuditContext,
  ) {
    const input = ToggleFavoriteSchema.parse(raw);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          personId,
          targetType: input.targetType,
          targetId: input.targetId,
        }),
      )
      .digest("hex");
    return transaction(async (client) => {
      // Same-person operations serialize; the command lock also catches cross-person reuse.
      await identity(client, personId, userId, true);
      await client.query("SELECT pg_advisory_xact_lock(17,hashtext($1))", [
        input.commandId,
      ]);
      const replay = (
        await client.query<{
          actor_id: string;
          action: string;
          target_id: string;
          payload_after: { commandFingerprint?: string; isFavorite?: boolean };
        }>(
          "SELECT actor_id,action,target_id,payload_after FROM public.app_audit_events WHERE command_id=$1",
          [input.commandId],
        )
      ).rows[0];
      if (replay) {
        if (
          replay.actor_id !== userId ||
          replay.action !== "favorite.toggle" ||
          replay.target_id !== input.targetId ||
          replay.payload_after?.commandFingerprint !== fingerprint ||
          typeof replay.payload_after.isFavorite !== "boolean"
        )
          throw new DiscoveryError("FAVORITE_COMMAND_CONFLICT", 409);
        return ToggleFavoriteResponseSchema.parse({
          targetType: input.targetType,
          targetId: input.targetId,
          isFavorite: replay.payload_after.isFavorite,
          replayed: true,
        });
      }
      const removed = await client.query(
        "DELETE FROM public.app_favorites WHERE person_id=$1 AND target_type=$2 AND target_id=$3 RETURNING id",
        [personId, input.targetType, input.targetId],
      );
      const isFavorite = !removed.rowCount;
      if (isFavorite) {
        const target = await client.query(
          input.targetType === "store"
            ? "SELECT id FROM public.app_producer_stores WHERE id=$1 AND hvm_store_private.store_is_visible(id) FOR SHARE"
            : `SELECT p.id FROM public.app_products p WHERE p.id=$1 AND ${visibleProduct("p")} FOR SHARE OF p`,
          [input.targetId],
        );
        if (!target.rows[0])
          throw new DiscoveryError("FAVORITE_TARGET_NOT_FOUND", 404);
        await client.query(
          "INSERT INTO public.app_favorites(person_id,target_type,target_id) VALUES($1,$2,$3)",
          [personId, input.targetType, input.targetId],
        );
      }
      await client.query(
        `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_before,payload_after,client_ip_hash,command_id)
         VALUES($1,$2,'authenticated','favorite.toggle','app_favorites',$3,$4,$5,$6,$7)`,
        [
          context.requestId,
          userId,
          input.targetId,
          JSON.stringify({ isFavorite: !isFavorite }),
          JSON.stringify({
            targetType: input.targetType,
            isFavorite,
            commandFingerprint: fingerprint,
          }),
          context.ipHash,
          input.commandId,
        ],
      );
      return ToggleFavoriteResponseSchema.parse({
        targetType: input.targetType,
        targetId: input.targetId,
        isFavorite,
        replayed: false,
      });
    });
  },
};
