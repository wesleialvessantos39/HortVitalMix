import { createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import {
  ReconcileBatchSchema,
  ReconcileResponseSchema,
  HarvestSyncPayloadSchema,
  OrderSyncPayloadSchema,
  ProofSyncPayloadSchema,
  SyncResultSchema,
  canonicalSyncJson,
  type SyncCommand,
  type SyncResult,
} from "../../shared/contracts/offlineSync.ts";
import {
  commerceTransaction,
  commerceIdentity,
  CommerceError,
  type CommerceAudit,
} from "./CommerceSupport.ts";
import { InventoryService, InventoryError } from "./InventoryService.ts";
import { OrderService } from "./OrderService.ts";
import { DeliveryLogisticsService } from "./DeliveryLogisticsService.ts";

async function apply(
  c: PoolClient,
  userId: string,
  command: SyncCommand,
  context: CommerceAudit,
): Promise<SyncResult> {
  const actor = await commerceIdentity(c, userId, "producer");
  if (command.commandType === "inventory.harvest") {
    const p = HarvestSyncPayloadSchema.parse(command.payload);
    const value = await InventoryService.registerHarvest(
      p.productId,
      actor.person_id,
      { ...p.harvest, commandId: command.commandId },
      userId,
      context,
      c,
      command.baseRevision,
    );
    return {
      commandId: command.commandId,
      status: "confirmed",
      code: "CONFIRMED",
      entityId: value.lotId,
      revision: value.inventory.product.revision ?? null,
      conflictDetails: null,
    };
  }
  if (command.commandType === "order.transition") {
    const p = OrderSyncPayloadSchema.parse(command.payload);
    if (p.transition.expectedRevision !== command.baseRevision)
      throw new CommerceError("VALIDATION_ERROR", 422);
    const value = await OrderService.transitionStatus(
      p.orderId,
      userId,
      "producer",
      p.transition,
      command.commandId,
      context,
      c,
    );
    return {
      commandId: command.commandId,
      status: "confirmed",
      code: "CONFIRMED",
      entityId: value.id,
      revision: value.revision,
      conflictDetails: null,
    };
  }
  if (command.commandType === "delivery.proof") {
    const p = ProofSyncPayloadSchema.parse(command.payload);
    if (p.proof.expectedRevision !== command.baseRevision)
      throw new CommerceError("VALIDATION_ERROR", 422);
    const value = await DeliveryLogisticsService.registerDeliveryProof(
      p.orderId,
      userId,
      p.proof,
      command.commandId,
      context,
      c,
    );
    return {
      commandId: command.commandId,
      status: "confirmed",
      code: "CONFIRMED",
      entityId: value.id,
      revision: value.revision,
      conflictDetails: null,
    };
  }
  throw new CommerceError("SYNC_COMMAND_UNSUPPORTED", 422);
}
async function state(
  c: PoolClient,
  uid: string,
  command: SyncCommand,
): Promise<SyncResult["conflictDetails"]> {
  if (command.commandType === "inventory.harvest") {
    const p = HarvestSyncPayloadSchema.safeParse(command.payload);
    if (!p.success) return null;
    return (
      (
        await c.query(
          `SELECT p.revision,p.title FROM public.app_products p JOIN public.app_producer_stores s ON s.id=p.store_id
      JOIN public.app_producer_profiles pp ON pp.id=s.producer_profile_id JOIN public.app_people pe ON pe.id=pp.person_id
      WHERE p.id=$1 AND pe.user_id=$2`,
          [p.data.productId, uid],
        )
      ).rows[0] ?? null
    );
  }
  const p = z.object({ orderId: z.uuid() }).safeParse(command.payload);
  if (!p.success) return null;
  return (
    (
      await c.query(
        `SELECT f.revision,f.status,o.status AS "commercialStatus" FROM public.app_orders o
    JOIN public.app_order_fulfillment f ON f.order_id=o.id WHERE o.id=$1 AND o.producer_user_id=$2`,
        [p.data.orderId, uid],
      )
    ).rows[0] ?? null
  );
}
const conflicts = new Set([
  "REVISION_CONFLICT",
  "ORDER_REFUNDED",
  "ORDER_CANCELLED",
  "ORDER_ALREADY_RECEIVED",
  "ORDER_FINANCIAL_STATE_CONFLICT",
  "ORDER_REFUND_IN_PROGRESS",
  "ORDER_NOT_OUT_FOR_DELIVERY",
]);
const constraints = new Set([
  "ILLEGAL_TRANSITION",
  "REVISION_CONFLICT",
  "ORDER_ACTOR_REQUIRED",
  "CANCELLATION_REASON_REQUIRED",
  "ORDER_ALREADY_RECEIVED",
  "ORDER_REFUNDED",
  "ORDER_CANCELLED",
  "ORDER_PAYMENT_NOT_APPROVED",
  "ORDER_STOCK_RETURN_REQUIRED",
  "ORDER_REFUND_REQUEST_REQUIRED",
  "DELIVERY_ALLOCATION_REQUIRED",
  "DELIVERY_PROOF_REQUIRED",
]);
export const OfflineSyncService = {
  async reconcileBatch(
    deviceFingerprint: string,
    userId: string,
    commands: unknown,
    context: CommerceAudit,
  ) {
    const batch = ReconcileBatchSchema.parse({ deviceFingerprint, commands });
    const results: SyncResult[] = [];
    // Each item commits separately. A transport failure leaves previous receipts
    // recoverable by commandId; no mutable state is shared between commands.
    for (const command of batch.commands)
      results.push(
        await commerceTransaction(async (c) => {
          await commerceIdentity(c, userId, "producer");
          await c.query("SELECT pg_advisory_xact_lock(25,hashtext($1))", [
            command.commandId,
          ]);
          const hash = createHash("sha256")
            .update(canonicalSyncJson(command))
            .digest("hex");
          const prior = (
            await c.query(
              "SELECT * FROM public.app_sync_command_journal WHERE command_id=$1",
              [command.commandId],
            )
          ).rows[0];
          if (prior) {
            if (
              prior.user_id !== userId ||
              prior.device_fingerprint !== batch.deviceFingerprint ||
              prior.payload_hash !== hash
            )
              return {
                commandId: command.commandId,
                status: "rejected" as const,
                code: "COMMAND_REUSED",
                entityId: null,
                revision: null,
                conflictDetails: null,
              };
            return SyncResultSchema.parse(prior.response_body);
          }
          await c.query("SAVEPOINT sync_domain");
          let result: SyncResult;
          try {
            result = await apply(c, userId, command, context);
            // Validate the existing deferred stock/order constraints before declaring
            // confirmed, so the domain writes and journal outcome remain atomic.
            await c.query("SET CONSTRAINTS ALL IMMEDIATE");
          } catch (e) {
            await c.query("ROLLBACK TO SAVEPOINT sync_domain");
            let code: string;
            if (e instanceof z.ZodError) code = "VALIDATION_ERROR";
            else if (
              e instanceof CommerceError ||
              e instanceof InventoryError
            ) {
              if (
                e.status >= 500 ||
                [
                  "AUTH_REQUIRED",
                  "PRODUCER_REQUIRED",
                  "PRODUCER_PROFILE_REQUIRED",
                ].includes(e.code)
              )
                throw e;
              code = e.code;
            } else if (
              (e as { code?: string }).code === "23514" &&
              constraints.has((e as Error).message)
            )
              code = (e as Error).message;
            else throw e;
            const current = await state(c, userId, command);
            const conflict = conflicts.has(code) && current !== null;
            result = {
              commandId: command.commandId,
              status: conflict ? "conflict" : "rejected",
              code,
              entityId: null,
              revision: conflict ? current!.revision : null,
              conflictDetails: conflict ? current : null,
            };
          }
          await c.query("RELEASE SAVEPOINT sync_domain");
          await c.query(
            `INSERT INTO public.app_sync_command_journal(command_id,user_id,device_fingerprint,command_type,base_revision,payload_hash,execution_status,conflict_details,response_body)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              command.commandId,
              userId,
              batch.deviceFingerprint,
              command.commandType,
              command.baseRevision,
              hash,
              result.status,
              result.conflictDetails
                ? JSON.stringify(result.conflictDetails)
                : null,
              JSON.stringify(result),
            ],
          );
          return result;
        }),
      );
    return ReconcileResponseSchema.parse({ results });
  },
};
