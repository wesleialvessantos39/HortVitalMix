import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { dbPool } from "../db/pool.ts";
import { RESERVATION_TTL_MINUTES } from "../../shared/contracts/inventory.ts";
import {
  ARIQUEMES_CENTER,
  CalculateDeliveryQuoteSchema,
  DeliveryQuoteResponseSchema,
  DeliverySettingsResponseSchema,
  SaveDeliverySettingsSchema,
  type DeliverySettings,
  type SaveDeliverySettings,
  type DeliveryQuote,
} from "../../shared/contracts/delivery.ts";

export class DeliveryError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
    this.name = "DeliveryError";
  }
}
type Audit = { requestId: string; ipHash: string };
type Identity = { personId: string; userId: string };
const defaults = {
  baseFeeCents: 500,
  feePerKmCents: 100,
  minOrderCents: 2000,
  freeDeliveryThresholdCents: null,
  estimatedPrepHours: 4,
};
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function translate(error: unknown): never {
  if (error instanceof DeliveryError) throw error;
  if (error instanceof z.ZodError)
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", 422);
  const code = (error as { code?: string }).code;
  if (code === "23505")
    throw new DeliveryError("DELIVERY_COMMAND_CONFLICT", 409);
  if (["23503", "23514", "22P02", "22003"].includes(code ?? ""))
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", 422);
  throw new DeliveryError("DEPENDENCY_UNAVAILABLE", 503);
}
async function transaction<T>(
  run: (client: PoolClient) => Promise<T>,
  existing?: PoolClient,
): Promise<T> {
  if (existing) {
    try {
      return await run(existing);
    } catch (e) {
      return translate(e);
    }
  }
  if (!dbPool) throw new DeliveryError("DEPENDENCY_UNAVAILABLE", 503);
  let client: PoolClient | undefined;
  try {
    client = await dbPool.connect();
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client?.query("ROLLBACK").catch(() => {});
    return translate(e);
  } finally {
    client?.release();
  }
}
async function ownedStore(
  client: PoolClient,
  personId: string,
  userId: string,
  lock = false,
) {
  const profile = await client.query<{ id: string }>(
    `SELECT pp.id FROM public.app_producer_profiles pp JOIN public.app_people pe ON pe.id=pp.person_id
     JOIN public.app_users u ON u.id=pe.user_id WHERE pe.id=$1 AND u.id=$2 AND pe.archived_at IS NULL
     AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
     AND EXISTS(SELECT 1 FROM public.app_user_role_assignments ra WHERE ra.user_id=u.id AND ra.role_code='producer'
       AND ra.revoked_at IS NULL AND (ra.expires_at IS NULL OR ra.expires_at>clock_timestamp()))
     ${lock ? "FOR UPDATE OF pp" : ""}`,
    [personId, userId],
  );
  if (!profile.rows[0])
    throw new DeliveryError("PRODUCER_PROFILE_REQUIRED", 403);
  return (
    (
      await client.query<{ id: string }>(
        `SELECT id FROM public.app_producer_stores WHERE producer_profile_id=$1 ${lock ? "FOR UPDATE" : ""}`,
        [profile.rows[0].id],
      )
    ).rows[0] ?? null
  );
}
async function settings(
  client: PoolClient,
  storeId: string,
): Promise<DeliverySettings> {
  const row = (
    await client.query<{
      id: string;
      store_name: string;
      eligible: boolean;
      property_id: string | null;
      property_name: string | null;
      latitude_sede: string | null;
      longitude_sede: string | null;
      ari_distance: string | null;
      area_id: string | null;
      origin_property_id: string | null;
      radius_km: string | null;
      center_latitude: string | null;
      center_longitude: string | null;
      is_active: boolean | null;
      revision: number | null;
      base_fee_cents: number | null;
      fee_per_km_cents: number | null;
      min_order_cents: number | null;
      free_delivery_threshold_cents: number | null;
      estimated_prep_hours: number | null;
    }>(
      `SELECT s.id,s.store_name,hvm_store_private.store_is_visible(s.id) AS eligible,
     p.id AS property_id,p.property_name,p.latitude_sede,p.longitude_sede,
     public.fn_haversine_km(p.latitude_sede,p.longitude_sede,$2,$3) AS ari_distance,
     a.id AS area_id,a.origin_property_id,a.radius_km,a.center_latitude,a.center_longitude,a.is_active,a.revision,
     r.base_fee_cents,r.fee_per_km_cents,r.min_order_cents,r.free_delivery_threshold_cents,r.estimated_prep_hours
     FROM public.app_producer_stores s LEFT JOIN public.app_properties p ON p.id=s.property_id AND p.producer_id=s.producer_profile_id
     LEFT JOIN public.app_service_areas a ON a.store_id=s.id LEFT JOIN public.app_delivery_rules r ON r.store_id=s.id
     WHERE s.id=$1`,
      [storeId, ARIQUEMES_CENTER.latitude, ARIQUEMES_CENTER.longitude],
    )
  ).rows[0];
  if (!row) throw new DeliveryError("DELIVERY_STORE_NOT_FOUND", 404);
  const origin =
    row.property_id && row.latitude_sede !== null && row.longitude_sede !== null
      ? {
          propertyId: row.property_id,
          propertyName: row.property_name!,
          centerLatitude: Number(row.latitude_sede),
          centerLongitude: Number(row.longitude_sede),
        }
      : null;
  // Only the current property's GPS is authoritative. Old coordinates never substitute it.
  return DeliverySettingsResponseSchema.parse({
    store: { id: row.id, name: row.store_name },
    origin,
    serviceArea: row.area_id
      ? {
          radiusKm: Number(row.radius_km),
          centerLatitude: Number(row.center_latitude),
          centerLongitude: Number(row.center_longitude),
          isActive: row.is_active,
        }
      : null,
    rules:
      row.base_fee_cents === null
        ? defaults
        : {
            baseFeeCents: row.base_fee_cents,
            feePerKmCents: row.fee_per_km_cents,
            minOrderCents: row.min_order_cents,
            freeDeliveryThresholdCents: row.free_delivery_threshold_cents,
            estimatedPrepHours: row.estimated_prep_hours,
          },
    revision: row.revision ?? 0,
    canConfigure: Boolean(row.eligible && origin),
    ariquemesDistanceKm:
      row.ari_distance === null ? null : Number(row.ari_distance),
  });
}
function configurationFingerprint(value: DeliverySettings) {
  return fingerprint({
    origin: value.origin,
    area: value.serviceArea,
    rules: value.rules,
    revision: value.revision,
  });
}
async function operational(client: PoolClient, storeId: string) {
  // Configuration saves and T12 store changes lock this same row.
  await client.query(
    "SELECT id FROM public.app_producer_stores WHERE id=$1 FOR SHARE",
    [storeId],
  );
  const value = await settings(client, storeId);
  if (!value.canConfigure || !value.serviceArea?.isActive || !value.origin)
    throw new DeliveryError("DELIVERY_UNAVAILABLE", 422);
  const area = (
    await client.query<{ origin_property_id: string }>(
      "SELECT origin_property_id FROM public.app_service_areas WHERE store_id=$1",
      [storeId],
    )
  ).rows[0];
  if (
    area.origin_property_id !== value.origin.propertyId ||
    value.serviceArea.centerLatitude !== value.origin.centerLatitude ||
    value.serviceArea.centerLongitude !== value.origin.centerLongitude
  )
    throw new DeliveryError("DELIVERY_CONFIGURATION_STALE", 409);
  return value;
}
async function address(
  client: PoolClient,
  addressId: string,
  identity: Identity,
) {
  const row = (
    await client.query<{
      latitude: string | null;
      longitude: string | null;
      revision: number;
    }>(
      `SELECT a.latitude,a.longitude,a.revision FROM public.app_user_addresses a JOIN public.app_people pe ON pe.id=a.person_id
     JOIN public.app_users u ON u.id=pe.user_id WHERE a.id=$1 AND pe.id=$2 AND u.id=$3 AND pe.archived_at IS NULL
     AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active' FOR SHARE OF a`,
      [addressId, identity.personId, identity.userId],
    )
  ).rows[0];
  if (!row) throw new DeliveryError("DELIVERY_ADDRESS_NOT_FOUND", 404);
  if (row.latitude === null || row.longitude === null)
    throw new DeliveryError("DELIVERY_ADDRESS_GPS_REQUIRED", 422);
  return {
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    revision: row.revision,
  };
}
type QuoteRow = {
  id: string;
  store_id: string;
  destination_address_id: string;
  distance_km: string;
  fee_cents: number;
  min_order_cents: number;
  is_eligible: boolean;
  ineligibility_reason: string | null;
  expires_at: Date;
  configuration_fingerprint: string;
  destination_latitude: string;
  destination_longitude: string;
  destination_revision: number;
  live?: boolean;
};
function quoteResponse(row: QuoteRow): DeliveryQuote {
  return DeliveryQuoteResponseSchema.parse({
    id: row.id,
    storeId: row.store_id,
    destinationAddressId: row.destination_address_id,
    distanceKm: Number(row.distance_km),
    feeCents: row.fee_cents,
    minOrderCents: row.min_order_cents,
    isEligible: row.is_eligible,
    ineligibilityReason: row.ineligibility_reason,
    expiresAt: row.expires_at.toISOString(),
  });
}

export const DeliveryQuoteService = {
  getOwnerSettings(personId: string, userId: string) {
    return transaction(async (client) => {
      const store = await ownedStore(client, personId, userId);
      return store
        ? settings(client, store.id)
        : DeliverySettingsResponseSchema.parse({
            store: null,
            origin: null,
            serviceArea: null,
            rules: defaults,
            revision: 0,
            canConfigure: false,
            ariquemesDistanceKm: null,
          });
    });
  },
  saveOwnerSettings(
    personId: string,
    userId: string,
    value: SaveDeliverySettings,
    audit: Audit,
  ) {
    const input = SaveDeliverySettingsSchema.parse(value);
    return transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(16,hashtext($1))", [
        input.commandId,
      ]);
      const store = await ownedStore(client, personId, userId, true);
      if (!store) throw new DeliveryError("DELIVERY_STORE_NOT_FOUND", 404);
      const current = await settings(client, store.id);
      const prior = (
        await client.query<{
          actor_id: string;
          target_id: string;
          target_entity: string;
          action: string;
          payload_after: { commandFingerprint?: string };
        }>(
          "SELECT actor_id,target_id,target_entity,action,payload_after FROM public.app_audit_events WHERE command_id=$1",
          [input.commandId],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.actor_id !== userId ||
          prior.target_id !== store.id ||
          prior.target_entity !== "app_service_areas" ||
          prior.action !== "delivery.settings_saved" ||
          prior.payload_after?.commandFingerprint !== fingerprint(input)
        )
          throw new DeliveryError("DELIVERY_COMMAND_CONFLICT", 409);
        return current;
      }
      if (!current.canConfigure || !current.origin)
        throw new DeliveryError("DELIVERY_ORIGIN_REQUIRED", 422);
      if (current.revision !== input.expectedRevision)
        throw new DeliveryError("DELIVERY_REVISION_CONFLICT", 409);
      await client.query(
        `INSERT INTO public.app_service_areas(store_id,origin_property_id,radius_km,center_latitude,center_longitude,is_active)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(store_id) DO UPDATE SET origin_property_id=excluded.origin_property_id,
        radius_km=excluded.radius_km,center_latitude=excluded.center_latitude,center_longitude=excluded.center_longitude,is_active=excluded.is_active,
        revision=app_service_areas.revision+1`,
        [
          store.id,
          current.origin.propertyId,
          input.radiusKm,
          current.origin.centerLatitude,
          current.origin.centerLongitude,
          input.isActive,
        ],
      );
      const r = input.rules;
      await client.query(
        `INSERT INTO public.app_delivery_rules(store_id,base_fee_cents,fee_per_km_cents,min_order_cents,free_delivery_threshold_cents,estimated_prep_hours)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(store_id) DO UPDATE SET base_fee_cents=excluded.base_fee_cents,fee_per_km_cents=excluded.fee_per_km_cents,
        min_order_cents=excluded.min_order_cents,free_delivery_threshold_cents=excluded.free_delivery_threshold_cents,estimated_prep_hours=excluded.estimated_prep_hours`,
        [
          store.id,
          r.baseFeeCents,
          r.feePerKmCents,
          r.minOrderCents,
          r.freeDeliveryThresholdCents,
          r.estimatedPrepHours,
        ],
      );
      const saved = await settings(client, store.id);
      // Audit records revisions and a digest only; no GPS or address PII in payloads.
      await client.query(
        `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_before,payload_after,client_ip_hash,command_id)
        VALUES($1,$2,'producer','delivery.settings_saved','app_service_areas',$3,$4,$5,$6,$7)`,
        [
          audit.requestId,
          userId,
          store.id,
          JSON.stringify({ revision: current.revision }),
          JSON.stringify({
            revision: saved.revision,
            commandFingerprint: fingerprint(input),
          }),
          audit.ipHash,
          input.commandId,
        ],
      );
      return saved;
    });
  },
  // No public quote endpoint in T16. Future checkout supplies its own transaction
  // and authoritative product subtotal; callers own BEGIN/COMMIT when passing a client.
  calculateQuote(
    storeId: string,
    destinationAddressId: string,
    context: Identity & { subtotalCents: number },
    existing?: PoolClient,
  ) {
    const input = CalculateDeliveryQuoteSchema.parse({
      storeId,
      destinationAddressId,
      ...context,
    });
    return transaction(async (client) => {
      const dest = await address(client, input.destinationAddressId, input);
      const config = await operational(client, input.storeId),
        origin = config.origin!,
        area = config.serviceArea!;
      const raw = Number(
        (
          await client.query<{ distance: string }>(
            "SELECT public.fn_haversine_km($1,$2,$3,$4) AS distance",
            [
              origin.centerLatitude,
              origin.centerLongitude,
              dest.latitude,
              dest.longitude,
            ],
          )
        ).rows[0].distance,
      );
      // Eligibility uses full distance; cents use the same 2-decimal distance exposed in the quote.
      const distance = Number(raw.toFixed(2)),
        rules = config.rules;
      const reason = raw > area.radiusKm ? "fora_da_area_de_entrega" : null;
      const fee = reason
        ? 0
        : rules.freeDeliveryThresholdCents !== null &&
            input.subtotalCents >= rules.freeDeliveryThresholdCents
          ? 0
          : rules.baseFeeCents +
            Math.floor(
              (Math.round(distance * 100) * rules.feePerKmCents + 50) / 100,
            );
      const row = (
        await client.query<QuoteRow>(
          `WITH stamp AS (SELECT clock_timestamp() AS ts)
        INSERT INTO public.app_delivery_quotes(store_id,destination_address_id,origin_property_id,configuration_fingerprint,destination_latitude,destination_longitude,subtotal_cents,destination_revision,
          distance_km,fee_cents,min_order_cents,is_eligible,ineligibility_reason,created_at,expires_at)
        SELECT $1,$2,$3,$4,$5,$6,$7,$14,$8,$9,$10,$11,$12,ts,ts+make_interval(mins=>$13) FROM stamp RETURNING *`,
          [
            input.storeId,
            input.destinationAddressId,
            origin.propertyId,
            configurationFingerprint(config),
            dest.latitude,
            dest.longitude,
            input.subtotalCents,
            distance,
            fee,
            rules.minOrderCents,
            reason === null,
            reason,
            RESERVATION_TTL_MINUTES,
            dest.revision,
          ],
        )
      ).rows[0];
      return quoteResponse(row);
    }, existing);
  },
  getActiveQuote(
    quoteId: string,
    personId: string,
    userId: string,
    existing?: PoolClient,
  ) {
    z.uuid().parse(quoteId);
    z.uuid().parse(personId);
    z.uuid().parse(userId);
    return transaction(async (client) => {
      const row = (
        await client.query<QuoteRow>(
          `SELECT q.*,q.expires_at>clock_timestamp() AS live FROM public.app_delivery_quotes q
        JOIN public.app_user_addresses a ON a.id=q.destination_address_id WHERE q.id=$1 AND a.person_id=$2`,
          [quoteId, personId],
        )
      ).rows[0];
      if (!row) throw new DeliveryError("DELIVERY_QUOTE_NOT_FOUND", 404);
      const dest = await address(client, row.destination_address_id, {
        personId,
        userId,
      });
      if (!row.live) throw new DeliveryError("DELIVERY_QUOTE_EXPIRED", 409);
      const config = await operational(client, row.store_id);
      if (
        configurationFingerprint(config) !== row.configuration_fingerprint ||
        dest.latitude !== Number(row.destination_latitude) ||
        dest.longitude !== Number(row.destination_longitude) ||
        dest.revision !== row.destination_revision
      )
        throw new DeliveryError("DELIVERY_QUOTE_STALE", 409);
      if (!row.is_eligible)
        throw new DeliveryError("DELIVERY_QUOTE_INELIGIBLE", 422);
      // Acquiring address/store locks may take time. Recheck at consumption,
      // rather than relying on the timestamp read before those locks.
      const stillLive = (
        await client.query<{ live: boolean }>(
          "SELECT $1::timestamptz>clock_timestamp() AS live",
          [row.expires_at],
        )
      ).rows[0].live;
      if (!stillLive) throw new DeliveryError("DELIVERY_QUOTE_EXPIRED", 409);
      return quoteResponse(row);
    }, existing);
  },
};
