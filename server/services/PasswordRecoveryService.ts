import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import { reportFailure, classifyDbError } from "../config/reportFailure.ts";
import { generateToken, digestToken } from "../security/otp.ts";
import { maskEmail } from "../security/mask.ts";
import { buildPasswordResetLink } from "../config/publicOrigin.ts";
import { renderPasswordRecoveryEmail } from "../communication/templates.ts";
import { CommunicationOutboxService } from "./CommunicationOutboxService.ts";
import {
  findActiveIdentityForRole,
  issueRecoveryChallenge,
  validateRecoveryChallenge,
  consumeRecoveryChallenge,
  invalidateChallenge,
} from "./RoleSecurityService.ts";
import { StrongPasswordSchema, type PortalRole } from "../../shared/contracts/auth.ts";
import type {
  PasswordRecoveryRequestResult,
  PasswordResetResult,
} from "../../shared/contracts/contactRecovery.ts";

const RECOVERY_TTL_MINUTES = 30;
const MAX_REQUESTS_PER_HOUR = 5;
const PUBLIC_MESSAGE =
  "Solicitação recebida. Confira sua caixa de entrada e a pasta de spam. " +
  "Se não receber a mensagem, revise o e-mail informado e tente novamente após alguns minutos.";

export class PasswordRecoveryService {
  static async requestRecovery(
    input: { email: string; commandId: string; portalRole: PortalRole },
    requestId: string,
    clientIpHash: string,
  ): Promise<PasswordRecoveryRequestResult> {
    if (!dbPool)
      return { status: "unavailable", message: "Serviço indisponível." };

    const client = await dbPool.connect();
    let roleChallengeId: string | null = null;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `recovery:${input.email}:${input.portalRole}`,
      ]);

      const existingCommand = await client.query(
        `SELECT id FROM public.app_password_recovery_requests WHERE command_id=$1`,
        [input.commandId],
      );
      if (existingCommand.rowCount) {
        await client.query("COMMIT");
        return { status: "accepted", message: PUBLIC_MESSAGE };
      }

      const identity = await findActiveIdentityForRole(input.email, input.portalRole);
      if (!identity) {
        await client.query("COMMIT");
        return { status: "accepted", message: PUBLIC_MESSAGE };
      }

      const rate = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM public.app_password_recovery_requests
          WHERE user_id=$1
            AND created_at > clock_timestamp() - interval '1 hour'`,
        [identity.user_id],
      );
      if (Number(rate.rows[0]?.count ?? 0) >= MAX_REQUESTS_PER_HOUR) {
        await client.query("ROLLBACK");
        return { status: "rate_limited", retryAfterSeconds: 3600 };
      }

      await client.query(
        `UPDATE public.app_password_recovery_requests
            SET invalidated_at=clock_timestamp()
          WHERE user_id=$1 AND is_used=false AND invalidated_at IS NULL`,
        [identity.user_id],
      );

      const roleChallenge = await issueRecoveryChallenge(
        identity.user_id,
        input.portalRole,
        requestId,
      );
      if (!roleChallenge) throw new Error("role_recovery_unavailable");
      roleChallengeId = roleChallenge.id;

      const rawToken = generateToken();
      const expiresAt = new Date(Date.now() + RECOVERY_TTL_MINUTES * 60_000);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO public.app_password_recovery_requests
         (user_id,token_digest,expires_at,request_id,command_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [
          identity.user_id,
          digestToken(rawToken),
          expiresAt,
          requestId,
          input.commandId,
        ],
      );

      const tpl = renderPasswordRecoveryEmail({
        magicLink: buildPasswordResetLink(
          rawToken,
          input.portalRole,
          roleChallenge.rawToken,
        ),
        expiresInMinutes: RECOVERY_TTL_MINUTES,
      });
      await CommunicationOutboxService.enqueue(client, {
        channel: "email",
        recipientUserId: identity.user_id,
        recipientMasked: maskEmail(identity.email_normalized),
        templateCode: "password.recovery.v1",
        payload: {
          to: identity.email_normalized,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
        },
        requestId,
        commandId: input.commandId,
      });

      await client.query(
        `INSERT INTO public.app_audit_events
         (request_id,actor_id,actor_role,action,target_entity,target_id,client_ip_hash,command_id)
         VALUES ($1,$2,'anonymous','password.recovery.requested',
                 'app_password_recovery_requests',$3,$4,$5)`,
        [
          requestId,
          identity.user_id,
          inserted.rows[0].id,
          clientIpHash,
          input.commandId,
        ],
      );
      await client.query("COMMIT");
      void this.dispatchPending(identity.user_id, requestId);
      return { status: "accepted", message: PUBLIC_MESSAGE };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      if (roleChallengeId) await invalidateChallenge(roleChallengeId).catch(() => undefined);
      reportFailure({ category: classifyDbError(error), requestId });
      return { status: "unavailable", message: "Falha técnica." };
    } finally {
      client.release();
    }
  }

  static async resetPassword(
    input: {
      token: string;
      newPassword: string;
      portalRole: PortalRole;
      flowToken: string;
    },
    requestId: string,
    clientIpHash: string,
  ): Promise<PasswordResetResult> {
    if (!dbPool || !supabaseAdmin)
      return { status: "unavailable", message: "Serviço indisponível." };

    if (!StrongPasswordSchema.safeParse(input.newPassword).success)
      return {
        status: "password_reused",
        message: "Senha não atende aos critérios de segurança.",
      };

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query<{
        id: string;
        user_id: string;
        is_used: boolean;
        invalidated_at: Date | null;
        expires_at: Date;
      }>(
        `SELECT id,user_id,is_used,invalidated_at,expires_at
           FROM public.app_password_recovery_requests
          WHERE token_digest=$1 FOR UPDATE`,
        [digestToken(input.token)],
      );
      if (!res.rowCount) {
        await client.query("ROLLBACK");
        return { status: "invalid_token" };
      }
      const recovery = res.rows[0];
      if (recovery.is_used || recovery.invalidated_at) {
        await client.query("ROLLBACK");
        return { status: "reused_token" };
      }
      if (recovery.expires_at.getTime() < Date.now()) {
        await client.query("ROLLBACK");
        return { status: "expired" };
      }

      const scoped = await validateRecoveryChallenge(
        recovery.user_id,
        input.portalRole,
        input.flowToken,
      );
      if (!scoped) {
        await client.query("ROLLBACK");
        return { status: "invalid_token" };
      }

      const { error } = await supabaseAdmin.auth.admin.updateUserById(
        recovery.user_id,
        { password: input.newPassword },
      );
      if (error) {
        await client.query("ROLLBACK");
        reportFailure({ category: "auth_unavailable", requestId, detail: error.message });
        return { status: "unavailable", message: "Falha ao atualizar senha." };
      }

      await client.query(
        `UPDATE public.app_password_recovery_requests
            SET is_used=true, used_at=clock_timestamp()
          WHERE id=$1`,
        [recovery.id],
      );
      await client.query(
        `INSERT INTO public.app_audit_events
         (request_id,actor_id,actor_role,action,target_entity,target_id,client_ip_hash)
         VALUES ($1,$2,'anonymous','password.reset.completed',
                 'app_password_recovery_requests',$3,$4)`,
        [requestId, recovery.user_id, recovery.id, clientIpHash],
      );
      await client.query("COMMIT");

      await consumeRecoveryChallenge(
        recovery.user_id,
        input.portalRole,
        input.flowToken,
      );
      // Revogação global real: invalida todas as sessões GoTrue do usuário.
      await dbPool.query("DELETE FROM auth.sessions WHERE user_id=$1", [recovery.user_id]);

      return { status: "success" };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      reportFailure({ category: classifyDbError(error), requestId });
      return { status: "unavailable", message: "Falha técnica." };
    } finally {
      client.release();
    }
  }

  private static async dispatchPending(userId: string, requestId: string) {
    if (!dbPool) return;
    try {
      const pending = await dbPool.query<{ id: string }>(
        `SELECT id FROM public.app_outbox_events
          WHERE recipient_user_id=$1 AND status='pending'
          ORDER BY created_at DESC LIMIT 2`,
        [userId],
      );
      for (const row of pending.rows)
        await CommunicationOutboxService.dispatch(row.id, requestId);
    } catch {}
  }
}
