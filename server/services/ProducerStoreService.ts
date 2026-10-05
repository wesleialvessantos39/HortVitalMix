import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import sanitizeHtml from "sanitize-html";
import { dbPool } from "../db/pool.ts";
import { redactPII } from "../security/redactPII.ts";
import { storeMediaDetails } from "../storage/storeMedia.ts";
import {
  StoreOwnerResponseSchema,
  StorePublicResponseSchema,
  type OperatingDay,
  type PauseStore,
  type SaveStoreSettings,
  type StoreCommand,
  type StoreOwner,
  type StoreSettings,
  type UpdateOperatingHours,
} from "../../shared/contracts/producerStore.ts";

export class ProducerStoreError extends Error {
  constructor(
    public code: string,
    public status: number,
    public currentRevision?: number,
  ) {
    super(code);
    this.name = "ProducerStoreError";
  }
}
export type StoreAuditContext = { requestId: string; ipHash: string };
export type StoreRow = {
  id: string;
  producer_profile_id: string;
  property_id: string | null;
  store_slug: string;
  store_name: string;
  bio_clean: string;
  min_order_amount_cents: number;
  cutoff_hour: string;
  status: StoreOwner["status"];
  revision: number;
  logo_url: string | null;
  banner_url: string | null;
  cover_mode: "images" | "products" | "mixed";
  public_producer_name: string | null;
};

// sanitize-html removes active elements and their contents. Decode its escaped
// text once; clients render the result as text, never as HTML.
export function sanitizeStoreBio(input: string) {
  return sanitizeHtml(input.replace(/<br\s*\/?\s*>/gi, "\n"), {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(
      /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
      (entity, key: string) => {
        const named: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
        };
        if (!key.startsWith("#")) return named[key.toLowerCase()] ?? entity;
        const value = key.toLowerCase().startsWith("#x")
          ? parseInt(key.slice(2), 16)
          : Number(key.slice(1));
        return value > 0 &&
          value <= 0x10ffff &&
          !(value >= 0xd800 && value <= 0xdfff)
          ? String.fromCodePoint(value)
          : "";
      },
    )
    .replace(/\r\n?/g, "\n")
    .trim();
}
function pool() {
  if (!dbPool) throw new ProducerStoreError("DATABASE_UNAVAILABLE", 503);
  return dbPool;
}
function dbError(error: unknown): never {
  if (error instanceof ProducerStoreError) throw error;
  const code = (error as { code?: string })?.code;
  if (code === "23505")
    throw new ProducerStoreError("STORE_SLUG_CONFLICT", 409);
  if (["23503", "23514", "22P02"].includes(code ?? ""))
    throw new ProducerStoreError("STORE_VALIDATION_FAILED", 422);
  throw new ProducerStoreError("DEPENDENCY_UNAVAILABLE", 503);
}
async function producer(client: PoolClient, userId: string, lock = false) {
  const result = await client.query<{ id: string }>(
    `SELECT pp.id FROM public.app_producer_profiles pp
       JOIN public.app_people pe ON pe.id=pp.person_id
      WHERE pe.user_id=$1 AND pe.archived_at IS NULL ${lock ? "FOR UPDATE OF pp" : ""}`,
    [userId],
  );
  if (!result.rows[0])
    throw new ProducerStoreError("PRODUCER_PROFILE_REQUIRED", 403);
  return result.rows[0].id;
}
async function hours(
  client: PoolClient,
  storeId: string,
): Promise<OperatingDay[]> {
  const result = await client.query<{
    day_of_week: number;
    is_harvest_day: boolean;
    is_delivery_day: boolean;
    cutoff_time: string;
  }>(
    "SELECT day_of_week,is_harvest_day,is_delivery_day,cutoff_time FROM public.app_store_operating_hours WHERE store_id=$1 ORDER BY day_of_week",
    [storeId],
  );
  return result.rows.map((day) => ({
    dayOfWeek: day.day_of_week,
    isHarvestDay: day.is_harvest_day,
    isDeliveryDay: day.is_delivery_day,
    cutoffTime: day.cutoff_time.slice(0, 5),
  }));
}
async function owner(client: PoolClient, row: StoreRow): Promise<StoreOwner> {
  return StoreOwnerResponseSchema.parse({
    id: row.id,
    producerProfileId: row.producer_profile_id,
    propertyId: row.property_id,
    storeSlug: row.store_slug,
    storeName: row.store_name,
    bio: row.bio_clean,
    minOrderAmountCents: row.min_order_amount_cents,
    cutoffHour: row.cutoff_hour.slice(0, 5),
    status: row.status,
    revision: row.revision,
    ...(await storeMediaDetails(client, row)),
    operatingHours: await hours(client, row.id),
  });
}
async function upsertHours(
  client: PoolClient,
  storeId: string,
  days: OperatingDay[],
) {
  await client.query(
    `INSERT INTO public.app_store_operating_hours(store_id,day_of_week,is_harvest_day,is_delivery_day,cutoff_time)
     SELECT $1,d."dayOfWeek",d."isHarvestDay",d."isDeliveryDay",d."cutoffTime"::time
       FROM jsonb_to_recordset($2::jsonb) AS d("dayOfWeek" int,"isHarvestDay" boolean,"isDeliveryDay" boolean,"cutoffTime" text)
     ON CONFLICT(store_id,day_of_week) DO UPDATE SET
       is_harvest_day=excluded.is_harvest_day,is_delivery_day=excluded.is_delivery_day,cutoff_time=excluded.cutoff_time`,
    [storeId, JSON.stringify(days)],
  );
}
async function audit(
  client: PoolClient,
  userId: string,
  row: StoreRow,
  action: string,
  commandId: string,
  fingerprint: string,
  context: StoreAuditContext,
  before?: StoreRow,
  reason?: string,
) {
  await client.query(
    `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,
      payload_before,payload_after,client_ip_hash,command_id) VALUES($1,$2,'producer',$3,'app_producer_stores',$4,$5,$6,$7,$8)`,
    [
      context.requestId,
      userId,
      action,
      row.id,
      before
        ? JSON.stringify({ revision: before.revision, status: before.status })
        : null,
      JSON.stringify(
        redactPII({
          revision: row.revision,
          status: row.status,
          commandFingerprint: fingerprint,
          ...(reason ? { reason } : {}),
        }),
      ),
      context.ipHash,
      commandId,
    ],
  );
}
async function lockCommand(client: PoolClient, commandId: string) {
  await client.query("SELECT pg_advisory_xact_lock(12,hashtext($1))", [
    commandId,
  ]);
}
async function isReplay(
  client: PoolClient,
  userId: string,
  storeId: string,
  commandId: string,
  action: string,
  fingerprint: string,
) {
  const result = await client.query<{
    actor_id: string;
    target_id: string;
    action: string;
    payload_after: { commandFingerprint?: string };
  }>(
    "SELECT actor_id,target_id,action,payload_after FROM public.app_audit_events WHERE command_id=$1",
    [commandId],
  );
  const event = result.rows[0];
  if (!event) return false;
  if (
    event.actor_id !== userId ||
    event.target_id !== storeId ||
    event.action !== action ||
    event.payload_after?.commandFingerprint !== fingerprint
  )
    throw new ProducerStoreError("STORE_COMMAND_CONFLICT", 409);
  return true;
}
async function eligible(
  client: PoolClient,
  profileId: string,
  propertyId: string | null,
  lock = false,
) {
  if (!propertyId) return false;
  if (lock) {
    const property = await client.query(
      "SELECT id FROM public.app_properties WHERE id=$1 AND producer_id=$2 FOR SHARE",
      [propertyId, profileId],
    );
    if (!property.rows[0])
      throw new ProducerStoreError("PROPERTY_NOT_FOUND", 404);
  }
  const result = await client.query<{ eligible: boolean }>(
    "SELECT hvm_store_private.property_is_eligible($1,$2) AS eligible",
    [profileId, propertyId],
  );
  return result.rows[0]?.eligible === true;
}
function settingsComplete(row: StoreRow) {
  return row.bio_clean.trim().length >= 10 && row.property_id !== null;
}
async function mutate<T extends StoreCommand>(
  storeId: string,
  userId: string,
  input: T,
  action: string,
  context: StoreAuditContext,
  change: (client: PoolClient, current: StoreRow) => Promise<StoreRow>,
  authorize?: (client: PoolClient, current: StoreRow) => Promise<void>,
) {
  const client = await pool().connect();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  try {
    await client.query("BEGIN");
    await lockCommand(client, input.commandId);
    const profileId = await producer(client, userId, true);
    const result = await client.query<StoreRow>(
      "SELECT * FROM public.app_producer_stores WHERE id=$1 AND producer_profile_id=$2 FOR UPDATE",
      [storeId, profileId],
    );
    const current = result.rows[0];
    if (!current) throw new ProducerStoreError("STORE_NOT_FOUND", 404);
    if (authorize) await authorize(client, current);
    let saved = current;
    if (
      !(await isReplay(
        client,
        userId,
        storeId,
        input.commandId,
        action,
        fingerprint,
      ))
    ) {
      if (input.expectedRevision !== current.revision)
        throw new ProducerStoreError(
          "STORE_REVISION_CONFLICT",
          409,
          current.revision,
        );
      saved = await change(client, current);
      await audit(
        client,
        userId,
        saved,
        action,
        input.commandId,
        fingerprint,
        context,
        current,
        (input as StoreCommand & { reason?: string }).reason,
      );
    }
    const response = await owner(client, saved);
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    dbError(error);
  } finally {
    client.release();
  }
}

export { mutate as mutateStore };

export const ProducerStoreService = {
  async getStoreSettings(userId: string): Promise<StoreSettings> {
    const client = await pool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const profileId = await producer(client, userId);
      const result = await client.query<StoreRow>(
        "SELECT * FROM public.app_producer_stores WHERE producer_profile_id=$1",
        [profileId],
      );
      const row = result.rows[0];
      const properties = await client.query<{
        id: string;
        property_name: string;
        municipality: string;
        state: string;
        line_vicinal: string;
        approved: boolean;
      }>(
        `SELECT p.id,p.property_name,p.municipality,p.state,p.line_vicinal,
          (p.status='verified' AND v.review_decision='approved') AS approved
           FROM public.app_properties p LEFT JOIN public.app_property_current_verification v ON v.property_id=p.id
          WHERE p.producer_id=$1 AND p.status<>'withdrawn' ORDER BY p.created_at,p.id`,
        [profileId],
      );
      const response: StoreSettings = {
        store: row ? await owner(client, row) : null,
        properties: properties.rows.map((property) => ({
          id: property.id,
          name: property.property_name,
          location: [
            property.line_vicinal,
            `${property.municipality}/${property.state}`,
          ]
            .filter(Boolean)
            .join(" · "),
          approved: property.approved === true,
        })),
        canPublish: Boolean(
          row &&
          settingsComplete(row) &&
          (await eligible(client, profileId, row.property_id)),
        ),
      };
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      dbError(error);
    } finally {
      client.release();
    }
  },
  async getOrCreateDraftStore(
    userId: string,
    commandId: string,
    context: StoreAuditContext,
  ) {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await lockCommand(client, commandId);
      const profileId = await producer(client, userId, true);
      const existing = await client.query<StoreRow>(
        "SELECT * FROM public.app_producer_stores WHERE producer_profile_id=$1",
        [profileId],
      );
      const previousCommand = await client.query<{
        actor_id: string;
        action: string;
      }>(
        "SELECT actor_id,action FROM public.app_audit_events WHERE command_id=$1",
        [commandId],
      );
      if (
        previousCommand.rows[0] &&
        (previousCommand.rows[0].actor_id !== userId ||
          previousCommand.rows[0].action !== "store.draft_created")
      )
        throw new ProducerStoreError("STORE_COMMAND_CONFLICT", 409);
      let row = existing.rows[0];
      if (!row) {
        const created = await client.query<StoreRow>(
          `INSERT INTO public.app_producer_stores(producer_profile_id,store_slug,store_name,bio_clean)
           VALUES($1,$2,'Minha loja','') RETURNING *`,
          [profileId, "loja-" + profileId.replaceAll("-", "")],
        );
        row = created.rows[0];
        await client.query(
          "INSERT INTO public.app_store_operating_hours(store_id,day_of_week) SELECT $1,generate_series(0,6)",
          [row.id],
        );
        await audit(
          client,
          userId,
          row,
          "store.draft_created",
          commandId,
          createHash("sha256").update(profileId).digest("hex"),
          context,
        );
      }
      const response = await owner(client, row);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      dbError(error);
    } finally {
      client.release();
    }
  },
  saveStoreSettings(
    storeId: string,
    userId: string,
    input: SaveStoreSettings,
    context: StoreAuditContext,
  ) {
    return mutate(
      storeId,
      userId,
      input,
      "store.settings_saved",
      context,
      async (client, row) => {
        if (row.status === "closed")
          throw new ProducerStoreError("STORE_TRANSITION_FORBIDDEN", 409);
        const bio = sanitizeStoreBio(input.bio);
        if (bio.length < 10 || bio.length > 2000)
          throw new ProducerStoreError("STORE_BIO_INVALID", 422);
        const property = await client.query(
          "SELECT id FROM public.app_properties WHERE id=$1 AND producer_id=$2 AND status<>'withdrawn' FOR SHARE",
          [input.propertyId, row.producer_profile_id],
        );
        if (!property.rows[0])
          throw new ProducerStoreError("PROPERTY_NOT_FOUND", 404);
        if (
          row.status === "active" &&
          !(await eligible(client, row.producer_profile_id, input.propertyId))
        )
          throw new ProducerStoreError("STORE_PUBLISH_FORBIDDEN", 403);
        const result = await client.query<StoreRow>(
          `UPDATE public.app_producer_stores SET property_id=$2,store_slug=$3,store_name=$4,bio_clean=$5,
          min_order_amount_cents=$6,cutoff_hour=$7,revision=revision+1,updated_at=clock_timestamp()
         WHERE id=$1 RETURNING *`,
          [
            storeId,
            input.propertyId,
            input.storeSlug,
            input.storeName,
            bio,
            input.minOrderAmountCents,
            input.cutoffHour,
          ],
        );
        if (input.operatingHours)
          await upsertHours(client, storeId, input.operatingHours);
        return result.rows[0];
      },
    );
  },
  updateOperatingHours(
    storeId: string,
    userId: string,
    input: UpdateOperatingHours,
    context: StoreAuditContext,
  ) {
    return mutate(
      storeId,
      userId,
      input,
      "store.hours_saved",
      context,
      async (client, row) => {
        if (row.status === "closed")
          throw new ProducerStoreError("STORE_TRANSITION_FORBIDDEN", 409);
        await upsertHours(client, storeId, input.days);
        const result = await client.query<StoreRow>(
          "UPDATE public.app_producer_stores SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
          [storeId],
        );
        return result.rows[0];
      },
    );
  },
  publishStore(
    storeId: string,
    userId: string,
    input: StoreCommand,
    context: StoreAuditContext,
  ) {
    return mutate(
      storeId,
      userId,
      input,
      "store.published",
      context,
      async (client, row) => {
        if (
          !settingsComplete(row) ||
          !(await eligible(
            client,
            row.producer_profile_id,
            row.property_id,
            true,
          ))
        )
          throw new ProducerStoreError("STORE_PUBLISH_FORBIDDEN", 403);
        if (!["draft", "paused"].includes(row.status))
          throw new ProducerStoreError("STORE_TRANSITION_FORBIDDEN", 409);
        const result = await client.query<StoreRow>(
          "UPDATE public.app_producer_stores SET status='active',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
          [storeId],
        );
        return result.rows[0];
      },
    );
  },
  pauseStore(
    storeId: string,
    userId: string,
    input: PauseStore,
    context: StoreAuditContext,
  ) {
    return mutate(
      storeId,
      userId,
      input,
      "store.paused",
      context,
      async (client, row) => {
        if (row.status !== "active")
          throw new ProducerStoreError("STORE_TRANSITION_FORBIDDEN", 409);
        const result = await client.query<StoreRow>(
          "UPDATE public.app_producer_stores SET status='paused',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
          [storeId],
        );
        return result.rows[0];
      },
    );
  },
  async getPublicStore(slug: string) {
    const client = await pool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await client.query<
        StoreRow & {
          line_vicinal: string;
          municipality: string;
          state: string;
          trust_level: number;
        }
      >(
        `SELECT s.store_name,s.store_slug,s.bio_clean,s.logo_url,s.banner_url,s.id,s.cover_mode,s.public_producer_name,
          s.min_order_amount_cents,s.cutoff_hour,p.line_vicinal,p.municipality,p.state,pp.trust_level
          FROM public.app_producer_stores s
          JOIN public.app_producer_profiles pp ON pp.id=s.producer_profile_id
          JOIN public.app_properties p ON p.id=s.property_id
          JOIN public.app_property_current_verification v ON v.property_id=p.id
         WHERE s.store_slug=$1 AND s.status='active' AND v.review_decision='approved'
           AND hvm_store_private.store_is_visible(s.id) LIMIT 1`,
        [slug],
      );
      const row = result.rows[0];
      if (!row) throw new ProducerStoreError("STORE_NOT_FOUND", 404);
      const response = StorePublicResponseSchema.parse({
        name: row.store_name,
        slug: row.store_slug,
        bio: row.bio_clean,
        ...(await storeMediaDetails(client, row)),
        location: [row.line_vicinal, `${row.municipality}/${row.state}`]
          .filter(Boolean)
          .join(" · "),
        verification: { isVerified: true, trustLevel: row.trust_level },
        minOrderAmountCents: row.min_order_amount_cents,
        cutoffHour: row.cutoff_hour.slice(0, 5),
        operatingHours: await hours(client, row.id),
      });
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      dbError(error);
    } finally {
      client.release();
    }
  },
};
