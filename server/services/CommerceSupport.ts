import { createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { reportFailure } from "../config/reportFailure.ts";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import type { AdminSectorCode } from "../../shared/contracts/adminGovernance.ts";
import { CheckoutCommandIdSchema } from "../../shared/contracts/checkout.ts";

export class CommerceError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
export type CommerceAudit = { requestId: string; ipHash: string };
export async function commerceTransaction<T>(
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!dbPool) throw new CommerceError("DEPENDENCY_UNAVAILABLE", 503);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof CommerceError) throw error;
    if (error instanceof z.ZodError)
      throw new CommerceError("VALIDATION_ERROR", 422);
    if ((error as { code?: string }).code === "23505")
      throw new CommerceError("CONFLICT", 409);
    if (error instanceof Error && "status" in error && "code" in error)
      throw error;
    reportFailure({
      category: "commerce_failed",
      detail: (error as { code?: string }).code ?? "unknown",
    });
    throw new CommerceError("DEPENDENCY_UNAVAILABLE", 503);
  } finally {
    client.release();
  }
}
export async function commerceIdentity(client: PoolClient, userId: string) {
  z.uuid().parse(userId);
  const result = await client.query<{ person_id: string; roles: string[] }>(
    `SELECT pe.id AS person_id,
    ARRAY(SELECT r.role_code FROM public.app_user_role_assignments r WHERE r.user_id=u.id AND r.revoked_at IS NULL
    AND (r.expires_at IS NULL OR r.expires_at>clock_timestamp())) AS roles
    FROM public.app_users u JOIN public.app_people pe ON pe.user_id=u.id
    WHERE u.id=$1 AND pe.archived_at IS NULL AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
    FOR SHARE OF u,pe`,
    [userId],
  );
  const actor = result.rows[0];
  if (
    !actor ||
    !actor.roles.some((role) => role === "consumer" || role === "producer")
  )
    throw new CommerceError("AUTH_REQUIRED", 401);
  return actor;
}
export async function commerceAdmin(
  client: PoolClient,
  actor: AdminActorContext,
  sector: AdminSectorCode,
) {
  const permitted = await client.query(
    `SELECT 1 FROM public.app_users u
    JOIN public.app_admin_principals ap ON ap.admin_user_id=u.id
    JOIN public.app_user_role_assignments r ON r.user_id=u.id AND r.role_code=ap.portal_role
    WHERE u.id=$1 AND ap.portal_role=$2 AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
    AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>clock_timestamp())
    AND (ap.portal_role='platform_super_admin' OR EXISTS(SELECT 1 FROM public.app_admin_sector_members m
      JOIN public.app_admin_sectors s ON s.code=m.sector_code AND s.is_active
      WHERE m.user_id=u.id AND m.sector_code=$3 AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp())))
    FOR SHARE OF u`,
    [actor.userId, actor.role, sector],
  );
  if (!permitted.rowCount) throw new CommerceError("FORBIDDEN", 403);
}
export async function commerceCommand<T>(
  client: PoolClient,
  userId: string,
  commandId: string,
  operation: string,
  payload: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const id = CheckoutCommandIdSchema.parse(commandId);
  const hash = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  await client.query("SELECT pg_advisory_xact_lock(20,hashtext($1))", [id]);
  const receipt = (
    await client.query(
      "SELECT * FROM public.app_commerce_receipts WHERE command_id=$1",
      [id],
    )
  ).rows[0];
  if (receipt) {
    if (
      receipt.user_id !== userId ||
      receipt.operation !== operation ||
      receipt.payload_hash !== hash
    )
      throw new CommerceError("COMMAND_REUSED", 409);
    return receipt.response_body as T;
  }
  const value = await run();
  await client.query(
    `INSERT INTO public.app_commerce_receipts(command_id,user_id,operation,payload_hash,response_body)
    VALUES($1,$2,$3,$4,$5)`,
    [id, userId, operation, hash, JSON.stringify(value)],
  );
  return value;
}
export async function commerceAudit(
  client: PoolClient,
  userId: string,
  role: string,
  action: string,
  entity: string,
  id: string,
  payload: unknown,
  context: CommerceAudit,
  commandId?: string,
) {
  await client.query(
    `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash,command_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      context.requestId,
      userId,
      role,
      action,
      entity,
      id,
      JSON.stringify(payload),
      context.ipHash,
      commandId ?? null,
    ],
  );
}
