import { dbPool } from "../db/pool.ts";
import { reportFailure, classifyDbError } from "../config/reportFailure.ts";
import {
  generateOtp,
  generateOtpSalt,
  generateToken,
  hashOtp,
  verifyOtpHash,
  digestToken,
} from "../security/otp.ts";
import { maskDestination } from "../security/mask.ts";
import { sha256Hex } from "../security/hash.ts";
import { buildContactConfirmLink } from "../config/publicOrigin.ts";
import {
  renderContactVerificationEmail,
  renderPhoneOtpSms,
} from "../communication/templates.ts";
import { CommunicationOutboxService } from "./CommunicationOutboxService.ts";
import type {
  ContactChannel,
  ChallengeEmissionResult,
  ConfirmationResult,
  ContactStatusResponse,
} from "../../shared/contracts/contactRecovery.ts";

const COOLDOWN_SECONDS = 60;
const CHALLENGE_TTL_MINUTES = 30;

export class ContactVerificationService {
  static async requestChallenge(params: {
    userId: string;
    channel: ContactChannel;
    commandId: string;
    requestId: string;
    clientIpHash: string;
  }): Promise<ChallengeEmissionResult> {
    if (!dbPool)
      return { status: "unavailable", message: "Serviço indisponível." };

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `contact:${params.userId}:${params.channel}`,
      ]);

      const dest = await client.query<{
        email_normalized: string;
        phone_e164: string;
        email_verified_at: Date | null;
        phone_verified_at: Date | null;
      }>(
        `SELECT email_normalized, phone_e164, email_verified_at, phone_verified_at
           FROM public.app_people WHERE user_id=$1`,
        [params.userId],
      );
      if (!dest.rowCount) {
        await client.query("ROLLBACK");
        return { status: "unavailable", message: "Usuário sem cadastro." };
      }

      const person = dest.rows[0];
      const verified =
        params.channel === "email"
          ? person.email_verified_at !== null
          : person.phone_verified_at !== null;
      if (verified) {
        await client.query("COMMIT");
        return { status: "already_verified" };
      }

      const rawDestination =
        params.channel === "email" ? person.email_normalized : person.phone_e164;
      if (!rawDestination) {
        await client.query("ROLLBACK");
        return { status: "channel_unavailable", message: "Canal indisponível." };
      }
      const masked = maskDestination(params.channel, rawDestination);
      const fingerprint = sha256Hex(rawDestination);

      const existingCommand = await client.query(
        `SELECT id FROM public.app_contact_verification_challenges WHERE command_id=$1`,
        [params.commandId],
      );
      if (existingCommand.rowCount) {
        await client.query("COMMIT");
        return { status: "cooldown", retryAfterSeconds: COOLDOWN_SECONDS };
      }

      const last = await client.query<{ id: string; seconds_since: string }>(
        `SELECT id,
                EXTRACT(EPOCH FROM (clock_timestamp()-created_at))::text AS seconds_since
           FROM public.app_contact_verification_challenges
          WHERE user_id=$1 AND channel=$2
            AND is_consumed=false AND invalidated_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        [params.userId, params.channel],
      );
      if (last.rowCount) {
        const seconds = Number(last.rows[0].seconds_since);
        if (seconds < COOLDOWN_SECONDS) {
          await client.query("ROLLBACK");
          return {
            status: "cooldown",
            retryAfterSeconds: Math.ceil(COOLDOWN_SECONDS - seconds),
          };
        }
        await client.query(
          `UPDATE public.app_contact_verification_challenges
              SET invalidated_at=clock_timestamp()
            WHERE id=$1`,
          [last.rows[0].id],
        );
      }

      const otp = generateOtp();
      const salt = generateOtpSalt();
      const rawToken = generateToken();
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60_000);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO public.app_contact_verification_challenges
         (user_id,channel,destination_masked,destination_fingerprint,
          otp_hash,otp_salt,token_digest,expires_at,request_id,command_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [
          params.userId,
          params.channel,
          masked,
          fingerprint,
          hashOtp(otp, salt),
          salt,
          digestToken(rawToken),
          expiresAt,
          params.requestId,
          params.commandId,
        ],
      );

      if (params.channel === "email") {
        const tpl = renderContactVerificationEmail({
          otp,
          magicLink: buildContactConfirmLink(rawToken),
          maskedDestination: masked,
          expiresInMinutes: CHALLENGE_TTL_MINUTES,
        });
        await CommunicationOutboxService.enqueue(client, {
          channel: "email",
          recipientUserId: params.userId,
          recipientMasked: masked,
          templateCode: "contact.verify.email.v1",
          payload: {
            to: rawDestination,
            subject: tpl.subject,
            html: tpl.html,
            text: tpl.text,
          },
          requestId: params.requestId,
          commandId: params.commandId,
        });
      } else {
        await CommunicationOutboxService.enqueue(client, {
          channel: "sms",
          recipientUserId: params.userId,
          recipientMasked: masked,
          templateCode: "contact.verify.phone.v1",
          payload: {
            to: rawDestination,
            text: renderPhoneOtpSms(otp, CHALLENGE_TTL_MINUTES),
          },
          requestId: params.requestId,
          commandId: params.commandId,
        });
      }

      await client.query(
        `INSERT INTO public.app_audit_events
         (request_id,actor_id,actor_role,action,target_entity,target_id,client_ip_hash,command_id)
         VALUES ($1,$2,'authenticated','contact.challenge.requested',
                 'app_contact_verification_challenges',$3,$4,$5)`,
        [
          params.requestId,
          params.userId,
          inserted.rows[0].id,
          params.clientIpHash,
          params.commandId,
        ],
      );
      await client.query("COMMIT");
      void this.scheduleDispatchForUser(params.userId, params.requestId);

      return {
        status: "issued",
        channel: params.channel,
        maskedDestination: masked,
        expiresAt: expiresAt.toISOString(),
        cooldownSeconds: COOLDOWN_SECONDS,
      };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      reportFailure({ category: classifyDbError(error), requestId: params.requestId });
      return { status: "unavailable", message: "Falha ao emitir desafio." };
    } finally {
      client.release();
    }
  }

  static async confirmOtp(params: {
    userId: string;
    channel: ContactChannel;
    otp: string;
    requestId: string;
    clientIpHash: string;
    commandId: string;
  }): Promise<ConfirmationResult> {
    if (!dbPool) return { status: "unavailable" };
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query<{
        id: string;
        otp_hash: string;
        otp_salt: string;
        attempts_count: number;
        max_attempts: number;
        expires_at: Date;
        destination_fingerprint: string;
      }>(
        `SELECT id,otp_hash,otp_salt,attempts_count,max_attempts,expires_at,destination_fingerprint
           FROM public.app_contact_verification_challenges
          WHERE user_id=$1 AND channel=$2
            AND is_consumed=false AND invalidated_at IS NULL
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [params.userId, params.channel],
      );
      if (!res.rowCount) {
        await client.query("ROLLBACK");
        return { status: "expired" };
      }
      const ch = res.rows[0];
      if (ch.expires_at.getTime() < Date.now()) {
        await client.query(
          `UPDATE public.app_contact_verification_challenges
              SET invalidated_at=clock_timestamp() WHERE id=$1`,
          [ch.id],
        );
        await client.query("COMMIT");
        return { status: "expired" };
      }

      const destination = await this.currentDestination(client, params.userId, params.channel);
      if (!destination) {
        await client.query("ROLLBACK");
        return { status: "unavailable" };
      }
      if (sha256Hex(destination) !== ch.destination_fingerprint) {
        await client.query("ROLLBACK");
        return { status: "destination_changed" };
      }

      if (!verifyOtpHash(params.otp, ch.otp_salt, ch.otp_hash)) {
        const attempts = ch.attempts_count + 1;
        await client.query(
          `UPDATE public.app_contact_verification_challenges
              SET attempts_count=$2,
                  invalidated_at=CASE WHEN $2 >= max_attempts THEN clock_timestamp() ELSE invalidated_at END
            WHERE id=$1`,
          [ch.id, attempts],
        );
        await client.query("COMMIT");
        return {
          status: "invalid_code",
          attemptsRemaining: Math.max(0, ch.max_attempts - attempts),
        };
      }

      await this.markConfirmed(client, {
        challengeId: ch.id,
        userId: params.userId,
        channel: params.channel,
        requestId: params.requestId,
        clientIpHash: params.clientIpHash,
        actorRole: "authenticated",
        commandId: params.commandId,
      });
      await client.query("COMMIT");
      return { status: "confirmed", channel: params.channel };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      reportFailure({ category: classifyDbError(error), requestId: params.requestId });
      return { status: "unavailable" };
    } finally {
      client.release();
    }
  }

  static async confirmToken(params: {
    token: string;
    requestId: string;
    clientIpHash: string;
  }): Promise<ConfirmationResult> {
    if (!dbPool) return { status: "unavailable" };
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query<{
        id: string;
        user_id: string;
        channel: ContactChannel;
        is_consumed: boolean;
        invalidated_at: Date | null;
        expires_at: Date;
        destination_fingerprint: string;
      }>(
        `SELECT id,user_id,channel,is_consumed,invalidated_at,expires_at,destination_fingerprint
           FROM public.app_contact_verification_challenges
          WHERE token_digest=$1 FOR UPDATE`,
        [digestToken(params.token)],
      );
      if (!res.rowCount) {
        await client.query("ROLLBACK");
        return { status: "already_used" };
      }
      const ch = res.rows[0];
      if (ch.is_consumed || ch.invalidated_at) {
        await client.query("ROLLBACK");
        return { status: "already_used" };
      }
      if (ch.expires_at.getTime() < Date.now()) {
        await client.query("ROLLBACK");
        return { status: "expired" };
      }
      const destination = await this.currentDestination(client, ch.user_id, ch.channel);
      if (!destination) {
        await client.query("ROLLBACK");
        return { status: "unavailable" };
      }
      if (sha256Hex(destination) !== ch.destination_fingerprint) {
        await client.query("ROLLBACK");
        return { status: "destination_changed" };
      }
      await this.markConfirmed(client, {
        challengeId: ch.id,
        userId: ch.user_id,
        channel: ch.channel,
        requestId: params.requestId,
        clientIpHash: params.clientIpHash,
        actorRole: "anonymous",
      });
      await client.query("COMMIT");
      return { status: "confirmed", channel: ch.channel };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      reportFailure({ category: classifyDbError(error), requestId: params.requestId });
      return { status: "unavailable" };
    } finally {
      client.release();
    }
  }

  static async getStatus(userId: string): Promise<ContactStatusResponse> {
    if (!dbPool)
      return {
        email: { verified: false, maskedDestination: null, hasActiveChallenge: false, cooldownRemainingSeconds: 0 },
        phone: { verified: false, maskedDestination: null, hasActiveChallenge: false, cooldownRemainingSeconds: 0 },
      };
    const personRes = await dbPool.query<{
      email_normalized: string;
      phone_e164: string;
      email_verified_at: Date | null;
      phone_verified_at: Date | null;
    }>(
      `SELECT email_normalized,phone_e164,email_verified_at,phone_verified_at
         FROM public.app_people WHERE user_id=$1`,
      [userId],
    );
    if (!personRes.rowCount) throw new Error("user_not_found");
    const p = personRes.rows[0];

    const channelInfo = async (
      channel: ContactChannel,
      value: string,
      verified: Date | null,
    ) => {
      const ch = await dbPool!.query<{ seconds_since: string }>(
        `SELECT EXTRACT(EPOCH FROM (clock_timestamp()-created_at))::text AS seconds_since
           FROM public.app_contact_verification_challenges
          WHERE user_id=$1 AND channel=$2
            AND is_consumed=false AND invalidated_at IS NULL
            AND expires_at > clock_timestamp()
          ORDER BY created_at DESC LIMIT 1`,
        [userId, channel],
      );
      const hasActive = Boolean(ch.rowCount);
      const seconds = hasActive ? Number(ch.rows[0].seconds_since) : 9999;
      return {
        verified: verified !== null,
        maskedDestination: value ? maskDestination(channel, value) : null,
        hasActiveChallenge: hasActive,
        cooldownRemainingSeconds:
          hasActive && seconds < COOLDOWN_SECONDS
            ? Math.ceil(COOLDOWN_SECONDS - seconds)
            : 0,
      };
    };

    const [email, phone] = await Promise.all([
      channelInfo("email", p.email_normalized, p.email_verified_at),
      channelInfo("phone", p.phone_e164, p.phone_verified_at),
    ]);
    return { email, phone };
  }

  private static async currentDestination(
    client: import("pg").PoolClient,
    userId: string,
    channel: ContactChannel,
  ) {
    const result = await client.query<{ email_normalized: string; phone_e164: string }>(
      `SELECT email_normalized,phone_e164 FROM public.app_people WHERE user_id=$1`,
      [userId],
    );
    if (!result.rowCount) return null;
    return channel === "email"
      ? result.rows[0].email_normalized
      : result.rows[0].phone_e164;
  }

  private static async markConfirmed(
    client: import("pg").PoolClient,
    params: {
      challengeId: string;
      userId: string;
      channel: ContactChannel;
      requestId: string;
      clientIpHash: string;
      actorRole: "authenticated" | "anonymous";
      commandId?: string;
    },
  ) {
    await client.query(
      `UPDATE public.app_contact_verification_challenges
          SET is_consumed=true, consumed_at=clock_timestamp()
        WHERE id=$1 AND is_consumed=false`,
      [params.challengeId],
    );
    const column =
      params.channel === "email" ? "email_verified_at" : "phone_verified_at";
    await client.query(
      `UPDATE public.app_people
          SET ${column}=clock_timestamp(), updated_at=clock_timestamp()
        WHERE user_id=$1`,
      [params.userId],
    );
    await client.query(
      `INSERT INTO public.app_audit_events
       (request_id,actor_id,actor_role,action,target_entity,target_id,client_ip_hash,command_id)
       VALUES ($1,$2,$3,$4,'app_people',$2,$5,$6)`,
      [
        params.requestId,
        params.userId,
        params.actorRole,
        `contact.confirmed.${params.channel}${params.actorRole === "anonymous" ? ".via_token" : ""}`,
        params.clientIpHash,
        params.commandId ?? null,
      ],
    );
  }

  private static async scheduleDispatchForUser(userId: string, requestId: string) {
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
