import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import {
  StoreCoverSettingsSchema,
  StoreMediaRemoveSchema,
  StoreMediaUploadQuerySchema,
} from "../../shared/contracts/producerStore.ts";
import {
  mutateStore,
  ProducerStoreError,
  type StoreAuditContext,
  type StoreRow,
} from "./ProducerStoreService.ts";
import { productImageExtension } from "./ProductService.ts";
import {
  STORE_MEDIA_BUCKET,
  STORE_MEDIA_PREFIX,
} from "../storage/storeMedia.ts";

const activeActor =
  (userId: string) => async (client: PoolClient, store: StoreRow) => {
    const result = await client.query(
      `SELECT u.id FROM public.app_users u
    JOIN public.app_people pe ON pe.user_id=u.id JOIN public.app_producer_profiles pp ON pp.person_id=pe.id
    WHERE u.id=$1 AND pp.id=$2 AND pe.archived_at IS NULL
      AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
      AND EXISTS(SELECT 1 FROM public.app_user_role_assignments ra WHERE ra.user_id=u.id AND ra.role_code='producer' AND ra.revoked_at IS NULL AND (ra.expires_at IS NULL OR ra.expires_at>clock_timestamp()))
    FOR SHARE OF u,pe`,
      [userId, store.producer_profile_id],
    );
    if (!result.rows.length)
      throw new ProducerStoreError("PRODUCER_PROFILE_REQUIRED", 403);
    if (store.status === "closed")
      throw new ProducerStoreError("STORE_TRANSITION_FORBIDDEN", 409);
  };
async function bump(client: PoolClient, id: string) {
  return (
    await client.query<StoreRow>(
      "UPDATE public.app_producer_stores SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
      [id],
    )
  ).rows[0];
}
export const StoreMediaService = {
  configure(
    id: string,
    userId: string,
    raw: z.infer<typeof StoreCoverSettingsSchema>,
    context: StoreAuditContext,
  ) {
    const input = StoreCoverSettingsSchema.parse(raw);
    return mutateStore(
      id,
      userId,
      input,
      "store.cover_configured",
      context,
      async (client) => {
        return (
          await client.query<StoreRow>(
            `UPDATE public.app_producer_stores SET cover_mode=$2,public_producer_name=$3,
        revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
            [id, input.coverMode, input.publicProducerName],
          )
        ).rows[0];
      },
      activeActor(userId),
    );
  },
  async upload(
    id: string,
    userId: string,
    raw: z.infer<typeof StoreMediaUploadQuerySchema>,
    file: Buffer,
    contentType: string,
    context: StoreAuditContext,
  ) {
    let extension: string;
    try {
      extension = productImageExtension(file, contentType);
    } catch (error) {
      throw new ProducerStoreError(
        (error as Error).message.replace("PRODUCT_", "STORE_"),
        422,
      );
    }
    const hash = createHash("sha256").update(file).digest("hex");
    const input = { ...raw, fileHash: hash, contentType };
    let uploadedPath: string | undefined;
    try {
      return await mutateStore(
        id,
        userId,
        input,
        "store.media_uploaded",
        context,
        async (client, current) => {
          if (!supabaseAdmin)
            throw new ProducerStoreError("STORE_MEDIA_UNAVAILABLE", 503);
          const count = (
            await client.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM public.app_store_media WHERE store_id=$1 AND purpose='cover'",
              [id],
            )
          ).rows[0].count;
          if (raw.purpose === "cover" && count >= 6)
            throw new ProducerStoreError("STORE_MEDIA_LIMIT", 422);
          const mediaId = randomUUID();
          const path = `${id}/${mediaId}-${hash}.${extension}`;
          const upload = await supabaseAdmin.storage
            .from(STORE_MEDIA_BUCKET)
            .upload(path, file, {
              contentType,
              upsert: false,
              cacheControl: "900",
            });
          if (upload.error)
            throw new ProducerStoreError("STORE_MEDIA_UNAVAILABLE", 503);
          uploadedPath = path;
          if (raw.purpose === "avatar")
            await client.query(
              "DELETE FROM public.app_store_media WHERE store_id=$1 AND purpose='avatar'",
              [id],
            );
          await client.query(
            "INSERT INTO public.app_store_media(id,store_id,purpose,media_url,display_order) VALUES($1,$2,$3,$4,$5)",
            [
              mediaId,
              id,
              raw.purpose,
              STORE_MEDIA_PREFIX + path,
              raw.purpose === "cover" ? Math.min(count, 5) : 0,
            ],
          );
          if (raw.purpose === "avatar")
            await client.query(
              "UPDATE public.app_producer_stores SET logo_url=$2 WHERE id=$1",
              [id, STORE_MEDIA_PREFIX + path],
            );
          return bump(client, current.id);
        },
        activeActor(userId),
      );
    } catch (error) {
      if (uploadedPath)
        await dbPool
          ?.query(
            `INSERT INTO public.app_storage_deletion_queue(bucket,object_path,reason)
        SELECT $1,$2,'store_upload_rollback' WHERE NOT EXISTS(SELECT 1 FROM public.app_store_media WHERE media_url=$3) ON CONFLICT DO NOTHING`,
            [
              STORE_MEDIA_BUCKET,
              uploadedPath,
              STORE_MEDIA_PREFIX + uploadedPath,
            ],
          )
          .catch(() => {});
      throw error;
    }
  },
  remove(
    id: string,
    userId: string,
    raw: z.infer<typeof StoreMediaRemoveSchema>,
    context: StoreAuditContext,
  ) {
    const input = StoreMediaRemoveSchema.parse(raw);
    return mutateStore(
      id,
      userId,
      input,
      "store.media_removed",
      context,
      async (client) => {
        const media = (
          await client.query<{ media_url: string; purpose: string }>(
            "DELETE FROM public.app_store_media WHERE id=$1 AND store_id=$2 RETURNING media_url,purpose",
            [input.mediaId, id],
          )
        ).rows[0];
        if (!media) throw new ProducerStoreError("STORE_MEDIA_NOT_FOUND", 404);
        if (media.purpose === "avatar")
          await client.query(
            "UPDATE public.app_producer_stores SET logo_url=NULL WHERE id=$1 AND logo_url=$2",
            [id, media.media_url],
          );
        return bump(client, id);
      },
      activeActor(userId),
    );
  },
};
