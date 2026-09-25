import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { redactPII } from "../security/redactPII.ts";
import type {
  AddressAdvancedView,
  CreateAddressAdvancedInput,
  GeocodingAccuracy,
  UpdateAddressAdvancedInput,
} from "../../shared/contracts/addressAdvanced.ts";
import { GeocodingHelper } from "./GeocodingHelper.ts";

export class AddressManagementError extends Error {
  constructor(
    public code: string,
    public status: number,
    message = code,
  ) {
    super(message);
    this.name = "AddressManagementError";
  }
}

function requirePool() {
  if (!dbPool) throw new AddressManagementError("DATABASE_UNAVAILABLE", 503);
  return dbPool;
}

function mapAddress(row: Record<string, any>): AddressAdvancedView {
  return {
    id: row.id,
    label: row.label,
    cep: row.cep,
    street: row.street,
    number: row.number,
    complement: row.complement,
    neighborhood: row.neighborhood,
    city: row.city,
    state: row.state,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    geocodingAccuracy: (row.geocoding_accuracy ?? "none") as GeocodingAccuracy,
    deliveryNotes: row.delivery_notes,
    isDefault: row.is_default,
    isActive: row.is_active,
    lastUsedAt: row.last_used_at
      ? new Date(row.last_used_at).toISOString()
      : null,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function getPersonId(
  client: PoolClient,
  userId: string,
  lock = false,
) {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM public.app_people WHERE user_id=$1" +
      (lock ? " FOR UPDATE" : ""),
    [userId],
  );
  if (!result.rows[0])
    throw new AddressManagementError("PERSON_NOT_FOUND", 404);
  return result.rows[0].id;
}

async function findReplayTarget(
  client: PoolClient,
  commandId: string,
  userId: string,
  action: string,
) {
  const result = await client.query<{ target_id: string | null }>(
    "SELECT target_id FROM public.app_audit_events WHERE command_id=$1 AND actor_id=$2 AND action=$3 LIMIT 1",
    [commandId, userId, action],
  );
  return result.rows[0]?.target_id ?? null;
}

async function writeAudit(
  client: PoolClient,
  args: {
    requestId: string;
    userId: string;
    role: string;
    action: string;
    targetId: string | null;
    before?: unknown;
    after?: unknown;
    ipHash: string;
    commandId: string;
  },
) {
  await client.query(
    [
      "INSERT INTO public.app_audit_events",
      "(request_id,actor_id,actor_role,action,target_entity,target_id,",
      "payload_before,payload_after,client_ip_hash,command_id)",
      "VALUES ($1,$2,$3,$4,'app_user_addresses',$5,$6,$7,$8,$9)",
    ].join(" "),
    [
      args.requestId,
      args.userId,
      args.role,
      args.action,
      args.targetId,
      args.before ? JSON.stringify(redactPII(args.before)) : null,
      args.after ? JSON.stringify(redactPII(args.after)) : null,
      args.ipHash,
      args.commandId,
    ],
  );
}

function metadata(row: Record<string, any>) {
  return {
    revision: row.revision,
    isDefault: row.is_default,
    isActive: row.is_active,
    fingerprintSha256: row.fingerprint_sha256,
    geocodingAccuracy: row.geocoding_accuracy ?? "none",
    hasDeliveryNotes: Boolean(row.delivery_notes),
  };
}

function mapDbError(error: unknown): never {
  const dbError = error as { code?: string; message?: string; constraint?: string };
  if (dbError.code === "23514" && dbError.message?.includes("LIMIT_EXCEEDED"))
    throw new AddressManagementError(
      "ADDRESS_LIMIT_EXCEEDED",
      422,
      "Limite de 10 endereços atingido. Remova um.",
    );
  if (
    dbError.code === "23505" &&
    dbError.constraint === "uq_app_user_addresses_fingerprint"
  )
    throw new AddressManagementError("ADDRESS_DUPLICATE", 409);
  if (
    dbError.code === "23505" &&
    dbError.constraint === "uq_app_user_addresses_default"
  )
    throw new AddressManagementError("ADDRESS_DEFAULT_CONFLICT", 409);
  throw error;
}

export function addressDeletionMode(openOrderCount: number): "soft" | "hard" {
  return openOrderCount > 0 ? "soft" : "hard";
}

async function countOpenOrders(client: PoolClient, addressId: string) {
  const relation = await client.query<{ relation: string | null }>(
    "SELECT to_regclass('public.app_orders')::text AS relation",
  );
  if (!relation.rows[0]?.relation) return 0;

  const result = await client.query<{ count: string }>(
    [
      "SELECT count(*)::text AS count FROM public.app_orders",
      "WHERE delivery_address_id=$1",
      "AND status IN ('pending','confirmed','in_harvest','in_route')",
    ].join(" "),
    [addressId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export class AddressManagementService {
  static async listAddresses(
    userId: string,
    options: { includeInactive?: boolean } = {},
  ) {
    const pool = requirePool();
    const person = await pool.query<{ id: string }>(
      "SELECT id FROM public.app_people WHERE user_id=$1",
      [userId],
    );
    if (!person.rows[0])
      throw new AddressManagementError("PERSON_NOT_FOUND", 404);

    const result = await pool.query<Record<string, any>>(
      [
        "SELECT * FROM public.app_user_addresses",
        "WHERE person_id=$1",
        options.includeInactive ? "" : "AND is_active=true",
        "ORDER BY last_used_at DESC NULLS LAST,created_at ASC,id ASC",
      ].join(" "),
      [person.rows[0].id],
    );
    return result.rows.map(mapAddress);
  }

  static async createAddress(
    userId: string,
    role: string,
    input: CreateAddressAdvancedInput,
    requestId: string,
    ipHash: string,
  ) {
    const geocoded = await GeocodingHelper.resolve(input);
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const personId = await getPersonId(client, userId, true);
      const replayTarget = await findReplayTarget(
        client,
        input.commandId,
        userId,
        "address.created",
      );
      if (replayTarget) {
        const replay = await client.query<Record<string, any>>(
          "SELECT * FROM public.app_user_addresses WHERE id=$1 AND person_id=$2",
          [replayTarget, personId],
        );
        await client.query("COMMIT");
        return replay.rows[0] ? mapAddress(replay.rows[0]) : null;
      }

      const activeCount = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.app_user_addresses WHERE person_id=$1 AND is_active=true",
        [personId],
      );
      if (Number(activeCount.rows[0]?.count ?? 0) >= 10)
        throw new AddressManagementError(
          "ADDRESS_LIMIT_EXCEEDED",
          422,
          "Limite de 10 endereços atingido. Remova um.",
        );

      const makeDefault =
        Number(activeCount.rows[0]?.count ?? 0) === 0 || input.isDefault;
      if (makeDefault) {
        await client.query(
          "UPDATE public.app_user_addresses SET is_default=false WHERE person_id=$1 AND is_active=true AND is_default=true",
          [personId],
        );
      }

      const inserted = await client.query<Record<string, any>>(
        [
          "INSERT INTO public.app_user_addresses",
          "(person_id,label,cep,street,number,complement,neighborhood,city,state,",
          "latitude,longitude,geocoding_accuracy,delivery_notes,is_default,is_active)",
          "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)",
          "RETURNING *",
        ].join(" "),
        [
          personId,
          input.label,
          input.cep,
          input.street,
          input.number,
          input.complement ?? null,
          input.neighborhood,
          input.city,
          input.state,
          geocoded.latitude,
          geocoded.longitude,
          geocoded.accuracy,
          input.deliveryNotes || null,
          makeDefault,
        ],
      );
      const row = inserted.rows[0];

      await writeAudit(client, {
        requestId,
        userId,
        role,
        action: "address.created",
        targetId: row.id,
        after: metadata(row),
        ipHash,
        commandId: input.commandId,
      });
      await client.query("COMMIT");
      return mapAddress(row);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      mapDbError(error);
    } finally {
      client.release();
    }
  }

  static async updateAddress(
    userId: string,
    role: string,
    addressId: string,
    input: UpdateAddressAdvancedInput,
    requestId: string,
    ipHash: string,
  ) {
    const pool = requirePool();
    const snapshot = await pool.query<Record<string, any>>(
      [
        "SELECT a.* FROM public.app_user_addresses a",
        "JOIN public.app_people p ON p.id=a.person_id",
        "WHERE a.id=$1 AND p.user_id=$2 AND a.is_active=true",
      ].join(" "),
      [addressId, userId],
    );
    if (!snapshot.rows[0])
      throw new AddressManagementError("ADDRESS_NOT_FOUND", 404);

    const old = snapshot.rows[0];
    const coreChanged = [
      ["cep", "cep"],
      ["street", "street"],
      ["number", "number"],
      ["neighborhood", "neighborhood"],
      ["city", "city"],
      ["state", "state"],
    ].some(
      ([inputKey, rowKey]) =>
        Object.prototype.hasOwnProperty.call(input, inputKey) &&
        String((input as Record<string, unknown>)[inputKey] ?? "") !==
          String(old[rowKey] ?? ""),
    );
    const coordinatesTouched =
      Object.prototype.hasOwnProperty.call(input, "latitude") ||
      Object.prototype.hasOwnProperty.call(input, "longitude");

    const geocoded =
      coreChanged || coordinatesTouched
        ? await GeocodingHelper.resolve({
            cep: input.cep ?? old.cep,
            street: input.street ?? old.street,
            number: input.number ?? old.number,
            neighborhood: input.neighborhood ?? old.neighborhood,
            city: input.city ?? old.city,
            state: input.state ?? old.state,
            latitude: input.latitude,
            longitude: input.longitude,
          })
        : {
            latitude: old.latitude === null ? null : Number(old.latitude),
            longitude: old.longitude === null ? null : Number(old.longitude),
            accuracy: (old.geocoding_accuracy ?? "none") as GeocodingAccuracy,
          };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const personId = await getPersonId(client, userId, true);
      const replayTarget = await findReplayTarget(
        client,
        input.commandId,
        userId,
        "address.updated",
      );
      if (replayTarget) {
        const replay = await client.query<Record<string, any>>(
          "SELECT * FROM public.app_user_addresses WHERE id=$1 AND person_id=$2",
          [replayTarget, personId],
        );
        await client.query("COMMIT");
        return {
          status: "idempotent_replay" as const,
          address: replay.rows[0] ? mapAddress(replay.rows[0]) : null,
        };
      }

      const current = (
        await client.query<Record<string, any>>(
          "SELECT * FROM public.app_user_addresses WHERE id=$1 AND person_id=$2 AND is_active=true FOR UPDATE",
          [addressId, personId],
        )
      ).rows[0];
      if (!current)
        throw new AddressManagementError("ADDRESS_NOT_FOUND", 404);
      if (current.revision !== input.expectedRevision) {
        await client.query("ROLLBACK");
        return {
          status: "conflict" as const,
          currentRevision: current.revision,
        };
      }

      const updated = await client.query<Record<string, any>>(
        [
          "UPDATE public.app_user_addresses SET",
          "label=$1,cep=$2,street=$3,number=$4,complement=$5,neighborhood=$6,city=$7,state=$8,",
          "latitude=$9,longitude=$10,geocoding_accuracy=$11,delivery_notes=$12",
          "WHERE id=$13 AND person_id=$14 RETURNING *",
        ].join(" "),
        [
          input.label ?? current.label,
          input.cep ?? current.cep,
          input.street ?? current.street,
          input.number ?? current.number,
          Object.prototype.hasOwnProperty.call(input, "complement")
            ? input.complement || null
            : current.complement,
          input.neighborhood ?? current.neighborhood,
          input.city ?? current.city,
          input.state ?? current.state,
          geocoded.latitude,
          geocoded.longitude,
          geocoded.accuracy,
          Object.prototype.hasOwnProperty.call(input, "deliveryNotes")
            ? input.deliveryNotes || null
            : current.delivery_notes,
          addressId,
          personId,
        ],
      );
      const row = updated.rows[0];
      await writeAudit(client, {
        requestId,
        userId,
        role,
        action: "address.updated",
        targetId: addressId,
        before: metadata(current),
        after: metadata(row),
        ipHash,
        commandId: input.commandId,
      });
      await client.query("COMMIT");
      return { status: "updated" as const, address: mapAddress(row) };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      mapDbError(error);
    } finally {
      client.release();
    }
  }

  static async setDefaultAddress(
    userId: string,
    role: string,
    addressId: string,
    expectedRevision: number,
    commandId: string,
    requestId: string,
    ipHash: string,
  ) {
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const personId = await getPersonId(client, userId, true);
      const replayTarget = await findReplayTarget(
        client,
        commandId,
        userId,
        "address.default_changed",
      );
      if (replayTarget) {
        const replay = await client.query<Record<string, any>>(
          "SELECT * FROM public.app_user_addresses WHERE id=$1 AND person_id=$2",
          [replayTarget, personId],
        );
        await client.query("COMMIT");
        return replay.rows[0]
          ? { status: "idempotent_replay" as const, address: mapAddress(replay.rows[0]) }
          : { status: "idempotent_replay" as const, address: null };
      }

      const current = (
        await client.query<Record<string, any>>(
          "SELECT * FROM public.app_user_addresses WHERE id=$1 AND person_id=$2 AND is_active=true FOR UPDATE",
          [addressId, personId],
        )
      ).rows[0];
      if (!current)
        throw new AddressManagementError("ADDRESS_NOT_FOUND", 404);
      if (current.revision !== expectedRevision) {
        await client.query("ROLLBACK");
        return {
          status: "conflict" as const,
          currentRevision: current.revision,
        };
      }

      if (!current.is_default) {
        await client.query(
          "UPDATE public.app_user_addresses SET is_default=false WHERE person_id=$1 AND is_active=true AND is_default=true",
          [personId],
        );
        await client.query(
          "UPDATE public.app_user_addresses SET is_default=true WHERE id=$1 AND person_id=$2",
          [addressId, personId],
        );
      }

      const row = (
        await client.query<Record<string, any>>(
          "SELECT * FROM public.app_user_addresses WHERE id=$1",
          [addressId],
        )
      ).rows[0];

      await writeAudit(client, {
        requestId,
        userId,
        role,
        action: "address.default_changed",
        targetId: addressId,
        before: metadata(current),
        after: metadata(row),
        ipHash,
        commandId,
      });
      await client.query("COMMIT");
      return { status: "updated" as const, address: mapAddress(row) };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      mapDbError(error);
    } finally {
      client.release();
    }
  }

  static async deleteAddress(
    userId: string,
    role: string,
    addressId: string,
    expectedRevision: number,
    commandId: string,
    requestId: string,
    ipHash: string,
  ) {
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const personId = await getPersonId(client, userId, true);
      const replayTarget = await findReplayTarget(
        client,
        commandId,
        userId,
        "address.deleted",
      );
      if (replayTarget) {
        await client.query("COMMIT");
        return { status: "idempotent_replay" as const };
      }

      const current = (
        await client.query<Record<string, any>>(
          "SELECT * FROM public.app_user_addresses WHERE id=$1 AND person_id=$2 FOR UPDATE",
          [addressId, personId],
        )
      ).rows[0];
      if (!current)
        throw new AddressManagementError("ADDRESS_NOT_FOUND", 404);
      if (current.revision !== expectedRevision) {
        await client.query("ROLLBACK");
        return {
          status: "conflict" as const,
          currentRevision: current.revision,
        };
      }

      const openOrders = await countOpenOrders(client, addressId);
      const wasDefault = Boolean(current.is_default && current.is_active);
      const mode = addressDeletionMode(openOrders);

      if (mode === "soft") {
        await client.query(
          "UPDATE public.app_user_addresses SET is_active=false,is_default=false WHERE id=$1 AND person_id=$2",
          [addressId, personId],
        );
      } else {
        await client.query(
          "DELETE FROM public.app_user_addresses WHERE id=$1 AND person_id=$2",
          [addressId, personId],
        );
      }

      let replacementDefaultId: string | null = null;
      if (wasDefault) {
        const next = await client.query<{ id: string }>(
          [
            "SELECT id FROM public.app_user_addresses",
            "WHERE person_id=$1 AND is_active=true",
            "ORDER BY created_at ASC,id ASC LIMIT 1 FOR UPDATE",
          ].join(" "),
          [personId],
        );
        if (next.rows[0]) {
          replacementDefaultId = next.rows[0].id;
          await client.query(
            "UPDATE public.app_user_addresses SET is_default=true WHERE id=$1",
            [replacementDefaultId],
          );
        }
      }

      await writeAudit(client, {
        requestId,
        userId,
        role,
        action: "address.deleted",
        targetId: addressId,
        before: metadata(current),
        after: {
          mode,
          openOrderCount: openOrders,
          replacementDefaultId,
        },
        ipHash,
        commandId,
      });
      await client.query("COMMIT");
      return {
        status: "deleted" as const,
        mode,
        wasDefault,
        replacementDefaultId,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      mapDbError(error);
    } finally {
      client.release();
    }
  }
}
