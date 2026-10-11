import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { rawDbPool } from "../db/pool.ts";
import { withOfflineTransaction } from "../db/offlineTransaction.ts";
import { adminSessionMiddleware } from "./adminSession.ts";
import {
  offlineMutationMode,
  offlineScope,
  offlineAdministrativeSector,
} from "../../shared/offlinePolicy.ts";
import { hasAdminPermission } from "../../shared/adminPermissions.ts";
import { canonicalSyncJson } from "../../shared/contracts/offlineSync.ts";
import { isAllowedRequestOrigin } from "../security/origin.ts";
import { runtime } from "../config/runtime.ts";
import { reportFailure } from "../config/reportFailure.ts";

function pathOf(req: Request) {
  return req.originalUrl.replace(/^\/(?:api|_hvm_api)(?=\/)/, "");
}
const fail = (res: Response, status: number, error: string) =>
  res.status(status).json({ error });
/** The header is an expectation, never authorization. Check the live actor first. */
export async function offlineRequestMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const scope = req.get("X-HVM-Offline-Scope"),
    requestId = req.get("X-HVM-Offline-Id");
  if (!scope && !requestId) return next();
  const path = pathOf(req);
  if (/^\/v1\/(?:auth|admin\/auth)(?:\/|$)/.test(path)) return next();
  if (
    !scope ||
    !/^[0-9a-f-]{36}:(?:consumer|producer|platform_admin|platform_super_admin)$/i.test(
      scope,
    )
  )
    return void fail(res, 400, "OFFLINE_SCOPE_INVALID");
  try {
    if (path.startsWith("/v1/admin/")) {
      let allowed = false;
      await adminSessionMiddleware(req, res, () => {
        allowed = true;
      });
      if (!allowed) return;
    }
    const actor = req.adminActor
      ? { userId: req.adminActor.userId, role: req.adminActor.role }
      : req.actor
        ? {
            userId: req.actor.userId,
            role:
              req.actor.roles.find(
                (role) => scope === `${req.actor!.userId}:${role}`,
              ) ?? "",
          }
        : null;
    if (!actor) return void fail(res, 401, "AUTH_REQUIRED");
    if (!actor.role || offlineScope(actor.userId, actor.role) !== scope)
      return void fail(res, 409, "OFFLINE_SCOPE_CHANGED");
    const sector =
      req.adminActor && offlineAdministrativeSector(path, req.body);
    if (sector && !hasAdminPermission(req.adminActor, sector))
      return void fail(res, 403, "FORBIDDEN");
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !requestId)
      return next();
    if (!/^[0-9a-f-]{36}$/i.test(requestId))
      return void fail(res, 400, "OFFLINE_REQUEST_INVALID");
    if (
      !isAllowedRequestOrigin(req) &&
      !(runtime.appEnv !== "production" && req.get("X-HVM-Request") === "1")
    )
      return void fail(res, 403, "ORIGIN_NOT_ALLOWED");
    const mode = offlineMutationMode(path, actor.role);
    if (mode === "online")
      return void fail(res, 409, "OFFLINE_ONLINE_REVIEW_REQUIRED");
    // Binary upload services own object-storage idempotency and byte validation.
    if (!req.is("application/json")) return next();
    if (!rawDbPool) return void fail(res, 503, "DEPENDENCY_UNAVAILABLE");
    let client = await rawDbPool.connect(),
      held = true;
    const hash = createHash("sha256")
      .update(
        canonicalSyncJson({
          method: req.method,
          path,
          body: req.body,
          command: req.get("X-Command-Id") ?? null,
        }),
      )
      .digest("hex");
    const originalJson = res.json,
      originalSend = res.send,
      originalEnd = res.end;
    try {
      await client.query("BEGIN");
      // Keep the configured backend database role. Existing domain services
      // must retain exactly the privileges they use on ordinary online calls.
      await client.query("SELECT pg_advisory_xact_lock(74,hashtext($1))", [
        `${scope}:${requestId}`,
      ]);
      const prior = (
        await client.query(
          "SELECT request_hash,response_status,response_body FROM public.app_offline_request_receipts WHERE user_id=$1 AND portal_role=$2 AND request_id=$3",
          [actor.userId, actor.role, requestId],
        )
      ).rows[0];
      if (prior) {
        await client.query("ROLLBACK");
        if (prior.request_hash !== hash)
          return void fail(res, 409, "OFFLINE_COMMAND_REUSED");
        res.set("X-HVM-Offline-Receipt", requestId);
        res.status(prior.response_status).json(prior.response_body);
        return;
      }
      if (mode === "idempotent") {
        await client.query("ROLLBACK");
        client.release();
        held = false;
      }
      // Keep the response buffered until SQL writes and receipt have committed.
      // An interrupted transport can recover this exact result with the same ID.
      const response = new Promise<unknown>((resolve) => {
        res.json = ((body: unknown) => {
          resolve(body);
          return res;
        }) as typeof res.json;
        res.send = ((body: unknown) => {
          resolve(body ?? null);
          return res;
        }) as typeof res.send;
        res.end = (() => {
          resolve(null);
          return res;
        }) as typeof res.end;
      });
      if (mode === "atomic") withOfflineTransaction(client, next);
      else next();
      const body = await response;
      res.json = originalJson;
      res.send = originalSend;
      res.end = originalEnd;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (!held) {
          client = await rawDbPool.connect();
          held = true;
          await client.query("BEGIN");
        }
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query(
          "INSERT INTO public.app_offline_request_receipts(request_id,user_id,portal_role,request_hash,response_status,response_body) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,portal_role,request_id) DO NOTHING",
          [
            requestId,
            actor.userId,
            actor.role,
            hash,
            res.statusCode,
            JSON.stringify(body ?? null),
          ],
        );
        await client.query("COMMIT");
        res.set("X-HVM-Offline-Receipt", requestId);
      } else if (held) await client.query("ROLLBACK");
      if (res.statusCode === 204) res.end();
      else res.json(body);
    } catch (error) {
      reportFailure({
        category: "offline_reconciliation",
        requestId: req.requestId,
        detail: String((error as { code?: string }).code ?? "unknown"),
      });
      res.json = originalJson;
      res.send = originalSend;
      res.end = originalEnd;
      if (held) await client.query("ROLLBACK").catch(() => {});
      if (!res.headersSent)
        fail(res, 503, "OFFLINE_RECONCILIATION_UNAVAILABLE");
    } finally {
      if (held) client.release();
    }
  } catch (error) {
    reportFailure({
      category: "offline_database",
      requestId: req.requestId,
      detail: String((error as { code?: string }).code ?? "unknown"),
    });
    if (!res.headersSent) fail(res, 503, "DEPENDENCY_UNAVAILABLE");
  }
}
