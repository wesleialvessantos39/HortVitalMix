import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { dbPool } from "../db/pool.ts";
import { sanitizeStoreBio } from "./ProducerStoreService.ts";
import {
  RegisterHarvestCommandSchema,
  ReserveStockSchema,
  InventoryResponseSchema,
  RESERVATION_TTL_MINUTES,
  INVENTORY_LOTS_PAGE_SIZE,
  INVENTORY_MOVEMENTS_PAGE_SIZE,
  type RegisterHarvest,
  type InventoryQuery,
  type Inventory,
  type ReserveStockResult,
} from "../../shared/contracts/inventory.ts";

export class InventoryError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
    this.name = "InventoryError";
  }
}
export type InventoryAuditContext = { requestId: string; ipHash: string };
function pool() {
  if (!dbPool) throw new InventoryError("DEPENDENCY_UNAVAILABLE", 503);
  return dbPool;
}
function translate(error: unknown): never {
  if (error instanceof InventoryError) throw error;
  if (error instanceof z.ZodError)
    throw new InventoryError("INVENTORY_VALIDATION_FAILED", 422);
  const fault = error as { code?: string; constraint?: string };
  if (fault.code === "23505")
    throw new InventoryError(
      fault.constraint === "uq_product_lot_code"
        ? "INVENTORY_LOT_CODE_CONFLICT"
        : "INVENTORY_COMMAND_CONFLICT",
      409,
    );
  if (["23514", "23503", "22P02", "22003"].includes(fault.code ?? ""))
    throw new InventoryError("INVENTORY_VALIDATION_FAILED", 422);
  throw new InventoryError("DEPENDENCY_UNAVAILABLE", 503);
}
// Future checkout may pass its own PoolClient: the caller owns BEGIN/COMMIT/ROLLBACK.
async function transaction<T>(
  run: (client: PoolClient) => Promise<T>,
  existing?: PoolClient,
  rollbackWhen?: (result: T) => boolean,
): Promise<T> {
  if (existing) {
    try {
      return await run(existing);
    } catch (error) {
      return translate(error);
    }
  }
  let client: PoolClient | undefined;
  try {
    client = await pool().connect();
    await client.query("BEGIN");
    const result = await run(client);
    await client.query(rollbackWhen?.(result) ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => {});
    return translate(error);
  } finally {
    client?.release();
  }
}
type OwnedProduct = {
  id: string;
  revision: number;
  title: string;
  unit_type: Inventory["product"]["unitType"];
  shelf_life_days: number;
  eligible: boolean;
};
async function ownerProduct(
  client: PoolClient,
  productId: string,
  personId: string,
  userId: string,
  lock = false,
) {
  // Same ownership/account/role source as T14; never infer the actor from a payload.
  const profile = await client.query<{ id: string }>(
    `SELECT pp.id FROM public.app_producer_profiles pp
     JOIN public.app_people pe ON pe.id=pp.person_id JOIN public.app_users u ON u.id=pe.user_id
     WHERE pe.id=$1 AND u.id=$2 AND pe.archived_at IS NULL
       AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
       AND EXISTS(SELECT 1 FROM public.app_user_role_assignments ra WHERE ra.user_id=u.id AND ra.role_code='producer'
         AND ra.revoked_at IS NULL AND (ra.expires_at IS NULL OR ra.expires_at>clock_timestamp()))
     ${lock ? "FOR UPDATE OF pp" : ""}`,
    [personId, userId],
  );
  if (!profile.rows[0])
    throw new InventoryError("PRODUCER_PROFILE_REQUIRED", 403);
  const store = await client.query<{ id: string; eligible: boolean }>(
    `SELECT s.id,hvm_store_private.store_is_visible(s.id) AS eligible
     FROM public.app_producer_stores s WHERE s.producer_profile_id=$1 ${lock ? "FOR UPDATE OF s" : ""}`,
    [profile.rows[0].id],
  );
  if (!store.rows[0])
    throw new InventoryError("INVENTORY_PRODUCT_NOT_FOUND", 404);
  const result = await client.query<Omit<OwnedProduct, "eligible">>(
    `SELECT id,revision,title,unit_type,shelf_life_days FROM public.app_products
     WHERE id=$1 AND store_id=$2 ${lock ? "FOR SHARE" : ""}`,
    [productId, store.rows[0].id],
  );
  if (!result.rows[0])
    throw new InventoryError("INVENTORY_PRODUCT_NOT_FOUND", 404);
  return { ...result.rows[0], eligible: store.rows[0].eligible };
}
async function readInventory(
  client: PoolClient,
  product: OwnedProduct,
  query: InventoryQuery,
): Promise<Inventory> {
  const summary = (
    await client.query<{
      business_date: string;
      available: string;
      reserved: string;
      lots_total: number;
      movements_total: number;
    }>(
      `SELECT CURRENT_DATE::text AS business_date,
    (SELECT coalesce(sum(current_quantity),0)::text FROM public.app_inventory_lots WHERE product_id=$1 AND expiration_date>=CURRENT_DATE) AS available,
    (SELECT coalesce(sum(quantity),0)::text FROM public.app_inventory_reservations WHERE product_id=$1 AND NOT is_consumed AND NOT is_released AND expires_at>clock_timestamp()) AS reserved,
    (SELECT count(*)::int FROM public.app_inventory_lots WHERE product_id=$1) AS lots_total,
    (SELECT count(*)::int FROM public.app_inventory_movements m JOIN public.app_inventory_lots l ON l.id=m.lot_id WHERE l.product_id=$1) AS movements_total`,
      [product.id],
    )
  ).rows[0];
  const lots = await client.query<{
    id: string;
    lot_code: string;
    harvest_date: string;
    expiration_date: string;
    initial_quantity: number;
    current_quantity: number;
    reserved_quantity: string;
    expires_in_days: number;
    created_at: Date;
  }>(
    `SELECT l.*, l.harvest_date::text AS harvest_date,l.expiration_date::text AS expiration_date, (l.expiration_date-CURRENT_DATE)::int AS expires_in_days,
    (SELECT coalesce(sum(r.quantity),0)::text FROM public.app_inventory_reservations r WHERE r.lot_id=l.id
     AND NOT r.is_consumed AND NOT r.is_released AND r.expires_at>clock_timestamp()) AS reserved_quantity
    FROM public.app_inventory_lots l WHERE l.product_id=$1
    ORDER BY l.created_at DESC,l.id LIMIT $2 OFFSET $3`,
    [
      product.id,
      INVENTORY_LOTS_PAGE_SIZE,
      (query.lotsPage - 1) * INVENTORY_LOTS_PAGE_SIZE,
    ],
  );
  const movements = await client.query<{
    id: string;
    lot_id: string;
    lot_code: string;
    movement_type: string;
    quantity_delta: number;
    reason_description: string;
    created_at: Date;
  }>(
    `SELECT m.*,l.lot_code FROM public.app_inventory_movements m JOIN public.app_inventory_lots l ON l.id=m.lot_id
    WHERE l.product_id=$1 ORDER BY m.created_at DESC,m.id LIMIT $2 OFFSET $3`,
    [
      product.id,
      INVENTORY_MOVEMENTS_PAGE_SIZE,
      (query.movementsPage - 1) * INVENTORY_MOVEMENTS_PAGE_SIZE,
    ],
  );
  return InventoryResponseSchema.parse({
    product: {
      id: product.id,
      revision: product.revision,
      title: product.title,
      unitType: product.unit_type,
      shelfLifeDays: product.shelf_life_days,
    },
    businessDate: summary.business_date,
    canRegisterHarvest: product.eligible,
    availableQuantity: Number(summary.available),
    reservedQuantity: Number(summary.reserved),
    lots: lots.rows.map((l) => ({
      id: l.id,
      lotCode: l.lot_code,
      harvestDate: l.harvest_date,
      expirationDate: l.expiration_date,
      initialQuantity: l.initial_quantity,
      currentQuantity: l.current_quantity,
      reservedQuantity: Number(l.reserved_quantity),
      expiresInDays: l.expires_in_days,
      createdAt: l.created_at.toISOString(),
    })),
    movements: movements.rows.map((m) => ({
      id: m.id,
      lotId: m.lot_id,
      lotCode: m.lot_code,
      movementType: m.movement_type,
      quantityDelta: m.quantity_delta,
      reasonDescription: m.reason_description,
      createdAt: m.created_at.toISOString(),
    })),
    pagination: {
      lotsPage: query.lotsPage,
      lotsTotal: summary.lots_total,
      movementsPage: query.movementsPage,
      movementsTotal: summary.movements_total,
    },
  });
}
async function sweep(client: PoolClient, productId?: string) {
  // Every stock mutation locks the lot before its reservations. SKIP LOCKED keeps
  // catalog sweeps/reservations from waiting on unrelated products or workers.
  const lots = await client.query<{ id: string }>(
    `SELECT l.id FROM public.app_inventory_lots l
    WHERE ($1::uuid IS NULL OR l.product_id=$1) AND EXISTS (
      SELECT 1 FROM public.app_inventory_reservations r WHERE r.lot_id=l.id
       AND NOT r.is_consumed AND NOT r.is_released AND r.expires_at<=clock_timestamp())
    ORDER BY l.expiration_date,l.harvest_date,l.created_at,l.id FOR UPDATE OF l SKIP LOCKED`,
    [productId ?? null],
  );
  let released = 0;
  for (const lot of lots.rows) {
    const expired = await client.query<{ id: string; quantity: number }>(
      `SELECT id,quantity FROM public.app_inventory_reservations
      WHERE lot_id=$1 AND NOT is_consumed AND NOT is_released AND expires_at<=clock_timestamp()
      ORDER BY id FOR UPDATE SKIP LOCKED`,
      [lot.id],
    );
    if (!expired.rows.length) continue;
    const quantity = expired.rows.reduce((sum, r) => sum + r.quantity, 0);
    await client.query(
      "UPDATE public.app_inventory_reservations SET is_released=true WHERE id=ANY($1::uuid[])",
      [expired.rows.map((r) => r.id)],
    );
    await client.query(
      "UPDATE public.app_inventory_lots SET current_quantity=current_quantity+$2 WHERE id=$1",
      [lot.id, quantity],
    );
    released += expired.rows.length;
  }
  return { released };
}
export const InventoryService = {
  releaseExpiredReservations(existing?: PoolClient, productId?: string) {
    return transaction((client) => sweep(client, productId), existing);
  },
  async getOwnerInventory(
    productId: string,
    personId: string,
    userId: string,
    query: InventoryQuery = { lotsPage: 1, movementsPage: 1 },
  ) {
    return transaction(async (client) => {
      const product = await ownerProduct(client, productId, personId, userId);
      await sweep(client, productId);
      return readInventory(client, product, query);
    });
  },
  async registerHarvest(
    productId: string,
    personId: string,
    value: RegisterHarvest,
    userId: string,
    context: InventoryAuditContext,
    existing?: PoolClient,
    expectedRevision?: number,
  ) {
    const parsed = RegisterHarvestCommandSchema.parse(value);
    const input = RegisterHarvestCommandSchema.parse({
      ...parsed,
      lotCode: sanitizeStoreBio(parsed.lotCode),
    });
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ productId, ...input }))
      .digest("hex");
    return transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(15,hashtext($1))", [
        input.commandId,
      ]);
      const product = await ownerProduct(
        client,
        productId,
        personId,
        userId,
        true,
      );
      const previous = (
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
      if (previous) {
        if (
          previous.actor_id !== userId ||
          previous.target_entity !== "app_inventory_lots" ||
          previous.action !== "inventory.harvest_registered" ||
          previous.payload_after?.commandFingerprint !== fingerprint
        )
          throw new InventoryError("INVENTORY_COMMAND_CONFLICT", 409);
        return {
          lotId: previous.target_id,
          inventory: await readInventory(client, product, {
            lotsPage: 1,
            movementsPage: 1,
          }),
        };
      }
      if (!product.eligible)
        throw new InventoryError("INVENTORY_STORE_INELIGIBLE", 403);
      if (expectedRevision !== undefined && product.revision !== expectedRevision)
        throw new InventoryError("REVISION_CONFLICT",409);
      const today = (
        await client.query<{ today: string }>(
          "SELECT CURRENT_DATE::text AS today",
        )
      ).rows[0].today;
      if (input.harvestDate > today)
        throw new InventoryError("INVENTORY_FUTURE_HARVEST", 422);
      const lot = (
        await client.query<{ id: string }>(
          `INSERT INTO public.app_inventory_lots
        (product_id,lot_code,harvest_date,expiration_date,initial_quantity,current_quantity) VALUES($1,$2,$3,$4,$5,$5) RETURNING id`,
          [
            productId,
            input.lotCode,
            input.harvestDate,
            input.expirationDate,
            input.quantity,
          ],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO public.app_inventory_movements(lot_id,movement_type,quantity_delta,reason_description,actor_user_id)
        VALUES($1,'harvest_entry',$2,$3,$4)`,
        [
          lot.id,
          input.quantity,
          "Colheita registrada: " + input.lotCode,
          userId,
        ],
      );
      await client.query(
        `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash,command_id)
        VALUES($1,$2,'producer','inventory.harvest_registered','app_inventory_lots',$3,$4,$5,$6)`,
        [
          context.requestId,
          userId,
          lot.id,
          JSON.stringify({
            productId,
            quantity: input.quantity,
            commandFingerprint: fingerprint,
          }),
          context.ipHash,
          input.commandId,
        ],
      );
      await sweep(client, productId);
      return {
        lotId: lot.id,
        inventory: await readInventory(client, product, {
          lotsPage: 1,
          movementsPage: 1,
        }),
      };
    }, existing);
  },
  async reserveStock(
    productId: string,
    quantity: number,
    cartSessionId: string,
    existing?: PoolClient,
  ): Promise<ReserveStockResult> {
    const input = ReserveStockSchema.parse({
      productId,
      quantity,
      cartSessionId,
    });
    if (!existing)
      await InventoryService.releaseExpiredReservations(undefined, productId);
    return transaction<ReserveStockResult>(
      async (client) => {
        const product = await client.query(
          `SELECT p.id FROM public.app_products p JOIN public.app_categories c ON c.id=p.category_id
        WHERE p.id=$1 AND p.is_published AND c.is_active AND hvm_store_private.store_is_visible(p.store_id) FOR SHARE OF p`,
          [input.productId],
        );
        if (!product.rows.length)
          throw new InventoryError("INVENTORY_PRODUCT_UNAVAILABLE", 404);
        if (existing) await sweep(client, input.productId);
        const lots = await client.query<{
          id: string;
          current_quantity: number;
        }>(
          `SELECT id,current_quantity FROM public.app_inventory_lots
        WHERE product_id=$1 AND current_quantity>0 AND expiration_date>=CURRENT_DATE
        ORDER BY expiration_date,harvest_date,created_at,id FOR UPDATE SKIP LOCKED`,
          [input.productId],
        );
        if (
          lots.rows.reduce((sum, l) => sum + l.current_quantity, 0) <
          input.quantity
        )
          return { status: "insufficient_stock" };
        let remaining = input.quantity;
        const reservations = [];
        for (const lot of lots.rows) {
          if (!remaining) break;
          const amount = Math.min(remaining, lot.current_quantity);
          await client.query(
            "UPDATE public.app_inventory_lots SET current_quantity=current_quantity-$2 WHERE id=$1",
            [lot.id, amount],
          );
          const r = (
            await client.query<{ id: string; expires_at: Date }>(
              `INSERT INTO public.app_inventory_reservations(product_id,lot_id,quantity,cart_session_id,expires_at)
          VALUES($1,$2,$3,$4,clock_timestamp()+($5::int*interval '1 minute')) RETURNING id,expires_at`,
              [
                input.productId,
                lot.id,
                amount,
                input.cartSessionId,
                RESERVATION_TTL_MINUTES,
              ],
            )
          ).rows[0];
          reservations.push({
            id: r.id,
            productId: input.productId,
            lotId: lot.id,
            quantity: amount,
            expiresAt: r.expires_at.toISOString(),
          });
          remaining -= amount;
        }
        return { status: "reserved", reservations };
      },
      existing,
      (result) => result.status === "insufficient_stock",
    );
  },
  async consumeReservation(
    reservationId: string,
    orderId: string,
    actorUserId: string,
    existing?: PoolClient,
  ) {
    reservationId = z.uuid().parse(reservationId).toLowerCase();
    orderId = z.uuid().parse(orderId).toLowerCase();
    actorUserId = z.uuid().parse(actorUserId).toLowerCase();
    return transaction(async (client) => {
      const located = (
        await client.query<{ lot_id: string }>(
          "SELECT lot_id FROM public.app_inventory_reservations WHERE id=$1",
          [reservationId],
        )
      ).rows[0];
      if (!located)
        throw new InventoryError("INVENTORY_RESERVATION_NOT_FOUND", 404);
      await client.query(
        "SELECT id FROM public.app_inventory_lots WHERE id=$1 FOR UPDATE",
        [located.lot_id],
      );
      const r = (
        await client.query<{
          lot_id: string;
          quantity: number;
          is_consumed: boolean;
          is_released: boolean;
          consumed_order_id: string | null;
          expired: boolean;
          lot_expired: boolean;
        }>(
          `SELECT r.*,r.expires_at<=clock_timestamp() AS expired,l.expiration_date<CURRENT_DATE AS lot_expired
         FROM public.app_inventory_reservations r JOIN public.app_inventory_lots l ON l.id=r.lot_id
         WHERE r.id=$1 FOR UPDATE OF r`,
          [reservationId],
        )
      ).rows[0];
      if (!r) throw new InventoryError("INVENTORY_RESERVATION_NOT_FOUND", 404);
      const actor = await client.query(
        `SELECT id FROM public.app_users
        WHERE id=$1 AND public.effective_account_status(status,block_starts_at,block_ends_at)='active'`,
        [actorUserId],
      );
      if (!actor.rows.length) throw new InventoryError("AUTH_REQUIRED", 401);
      if (r.is_consumed) {
        if (r.consumed_order_id !== orderId)
          throw new InventoryError("INVENTORY_RESERVATION_ORDER_CONFLICT", 409);
        return { status: "consumed" as const, reservationId, orderId };
      }
      if (r.is_released || r.expired || r.lot_expired)
        throw new InventoryError("INVENTORY_RESERVATION_EXPIRED", 409);
      await client.query(
        "UPDATE public.app_inventory_reservations SET is_consumed=true,consumed_order_id=$2 WHERE id=$1",
        [reservationId, orderId],
      );
      await client.query(
        `INSERT INTO public.app_inventory_movements(lot_id,movement_type,quantity_delta,reason_description,actor_user_id,reservation_id)
        VALUES($1,'order_sale',$2,$3,$4,$5)`,
        [
          r.lot_id,
          -r.quantity,
          "Baixa para pedido " + orderId,
          actorUserId,
          reservationId,
        ],
      );
      // Stock was already deducted by reserveStock; no second quantity update here.
      return { status: "consumed" as const, reservationId, orderId };
    }, existing);
  },
  async publicAvailability(client: PoolClient, productIds: string[]) {
    if (!productIds.length) return new Set<string>();
    const rows = await client.query<{ product_id: string }>(
      `SELECT DISTINCT product_id FROM public.app_inventory_lots
      WHERE product_id=ANY($1::uuid[]) AND current_quantity>0 AND expiration_date>=CURRENT_DATE`,
      [productIds],
    );
    return new Set(rows.rows.map((r) => r.product_id));
  },
};
