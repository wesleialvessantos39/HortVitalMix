import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { createSupabasePublicClient, supabaseAdmin } from "../supabase/client.ts";
import type {
  AcceptInviteInput,
  AcceptInviteResult,
  AdminLoginResult,
  AdminRole,
  AdminSectorCode,
  AdminVerifySessionResponse,
  BootstrapRequestInput,
  BootstrapResult,
  BootstrapStatusResponse,
  CreateInviteInput,
  InviteResponse,
  MfaVerifyResult,
  ValidateInviteResponse,
} from "../../shared/contracts/adminGovernance.ts";

const MFA_TTL_MINUTES = 10;
const INVITE_TTL_HOURS = 24;
const RATE_WINDOW_MINUTES = 15;
const RATE_MAX_FAILURES = 5;
const ZERO_HASH = "0".repeat(64);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const maskEmail = (email: string) => {
  const [name, domain = ""] = email.split("@");
  return `${name.slice(0, Math.min(2, name.length))}***@${domain}`;
};

async function audit(
  client: PoolClient,
  input: {
    requestId: string;
    actorId?: string | null;
    actorRole?: string;
    action: string;
    targetEntity: string;
    targetId?: string | null;
    after?: unknown;
    commandId?: string | null;
    ipHash?: string;
  },
) {
  await client.query(
    `INSERT INTO public.app_audit_events
      (request_id,actor_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash,command_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
    [
      input.requestId,
      input.actorId ?? null,
      input.actorRole ?? "anonymous",
      input.action,
      input.targetEntity,
      input.targetId ?? null,
      JSON.stringify(input.after ?? {}),
      input.ipHash || ZERO_HASH,
      input.commandId ?? null,
    ],
  );
}

async function activeAdminRole(userId: string) {
  if (!dbPool) return null;
  const result = await dbPool.query<{ status: string; role_code: AdminRole }>(
    `SELECT u.status,r.role_code
       FROM public.app_users u
       JOIN public.app_user_role_assignments r ON r.user_id=u.id
      WHERE u.id=$1
        AND r.role_code IN ('platform_super_admin','platform_admin')
        AND r.revoked_at IS NULL
        AND (r.expires_at IS NULL OR r.expires_at>now())
      ORDER BY CASE r.role_code WHEN 'platform_super_admin' THEN 0 ELSE 1 END
      LIMIT 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

async function sectorsFor(userId: string): Promise<AdminSectorCode[]> {
  if (!dbPool) return [];
  const result = await dbPool.query<{ sector_code: AdminSectorCode }>(
    `SELECT sector_code FROM public.app_admin_sector_members
      WHERE user_id=$1 AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at>now())
      ORDER BY sector_code`,
    [userId],
  );
  return result.rows.map((row) => row.sector_code);
}

export class AdminGovernanceService {
  static async getBootstrapStatus(): Promise<BootstrapStatusResponse> {
    const authorizedEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    if (!authorizedEmail)
      return { status: "disabled", reason: "BOOTSTRAP_ADMIN_EMAIL não configurado." };
    if (!dbPool)
      return { status: "disabled", reason: "Banco de dados indisponível." };
    const result = await dbPool.query(
      `SELECT 1 FROM public.app_user_role_assignments r
       JOIN public.app_users u ON u.id=r.user_id
       WHERE r.role_code='platform_super_admin' AND r.revoked_at IS NULL
       AND (r.expires_at IS NULL OR r.expires_at>now()) AND u.status='active' LIMIT 1`,
    );
    return result.rowCount
      ? { status: "closed", reason: "Já existe Super administrador ativo." }
      : { status: "open", reason: null };
  }

  static async executeBootstrap(
    input: BootstrapRequestInput,
    requestId: string,
    ipHash: string,
  ): Promise<BootstrapResult> {
    if (!dbPool || !supabaseAdmin) return { status: "unavailable" };
    const authorizedEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    if (!authorizedEmail) return { status: "disabled" };
    if (input.email !== authorizedEmail) return { status: "email_not_authorized" };

    const client = await dbPool.connect();
    let authUserId: string | null = null;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('hortivitalmix_admin_bootstrap'))");
      const existing = await client.query(
        `SELECT 1 FROM public.app_user_role_assignments r
         JOIN public.app_users u ON u.id=r.user_id
         WHERE r.role_code='platform_super_admin' AND r.revoked_at IS NULL
           AND (r.expires_at IS NULL OR r.expires_at>now()) AND u.status='active' LIMIT 1`,
      );
      if (existing.rowCount) {
        await client.query("ROLLBACK");
        return { status: "already_closed" };
      }
      const duplicate = await client.query(
        `SELECT 1 FROM public.app_people
         WHERE email_normalized=$1 OR cpf_normalized=$2 LIMIT 1`,
        [input.email, input.cpf],
      );
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        return { status: "identity_conflict", message: "E-mail ou CPF já vinculado." };
      }

      const created = await supabaseAdmin.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { full_name: input.fullName, hvm_portal: "administrative" },
      });
      if (created.error || !created.data.user) {
        await client.query("ROLLBACK");
        return {
          status: "identity_conflict",
          message: created.error?.message ?? "Não foi possível criar a identidade.",
        };
      }
      authUserId = created.data.user.id;

      await client.query(
        `INSERT INTO public.app_users(id,status) VALUES ($1,'active')`,
        [authUserId],
      );
      await client.query(
        `INSERT INTO public.app_people
          (user_id,full_name,cpf_normalized,email_normalized,phone_e164,email_verified_at)
         VALUES ($1,$2,$3,$4,$5,clock_timestamp())`,
        [authUserId, input.fullName, input.cpf, input.email, input.phone],
      );
      await client.query(
        `INSERT INTO public.app_user_role_assignments(user_id,role_code,granted_by)
         VALUES ($1,'platform_super_admin',$1)`,
        [authUserId],
      );
      await audit(client, {
        requestId,
        actorId: authUserId,
        actorRole: "platform_super_admin",
        action: "admin.bootstrap.completed",
        targetEntity: "app_users",
        targetId: authUserId,
        after: { role: "platform_super_admin" },
        commandId: input.commandId,
        ipHash,
      });
      await client.query("COMMIT");
      return { status: "completed", userId: authUserId };
    } catch {
      try { await client.query("ROLLBACK"); } catch {}
      if (authUserId) {
        try { await supabaseAdmin.auth.admin.deleteUser(authUserId); } catch {}
      }
      return { status: "unavailable" };
    } finally {
      client.release();
    }
  }

  private static async rateLimit(email: string, ipHash: string) {
    if (!dbPool) return { limited: false, retryAfterSeconds: 0 };
    const result = await dbPool.query<{ last_at: Date | string | null; failures: string }>(
      `SELECT max(occurred_at) AS last_at,count(*)::text AS failures
       FROM public.app_admin_auth_attempts
       WHERE occurred_at > now() - interval '15 minutes'
         AND outcome IN ('failure','mfa_failure')
         AND (email_hash=$1 OR ip_hash=$2)`,
      [sha256(email), ipHash],
    );
    const failures = Number(result.rows[0]?.failures ?? 0);
    const lastAt = result.rows[0]?.last_at;
    if (failures < RATE_MAX_FAILURES || !lastAt)
      return { limited: false, retryAfterSeconds: 0 };
    const until = new Date(lastAt).getTime() + RATE_WINDOW_MINUTES * 60_000;
    return {
      limited: until > Date.now(),
      retryAfterSeconds: Math.max(1, Math.ceil((until - Date.now()) / 1000)),
    };
  }

  private static async recordAttempt(
    email: string,
    ipHash: string,
    outcome: "success" | "failure" | "mfa_pending" | "mfa_failure",
  ) {
    if (!dbPool) return;
    await dbPool.query(
      `INSERT INTO public.app_admin_auth_attempts(email_hash,ip_hash,outcome)
       VALUES ($1,$2,$3)`,
      [sha256(email), ipHash, outcome],
    );
  }

  static async login(
    email: string,
    password: string,
    ipHash: string,
    requestId: string,
  ): Promise<AdminLoginResult> {
    if (!dbPool) return { status: "unavailable" };
    const limited = await this.rateLimit(email, ipHash);
    if (limited.limited)
      return { status: "rate_limited", retryAfterSeconds: limited.retryAfterSeconds };

    const client = createSupabasePublicClient();
    if (!client) return { status: "unavailable" };
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.user || !signed.data.session) {
      await this.recordAttempt(email, ipHash, "failure");
      return { status: "invalid_credentials" };
    }
    const role = await activeAdminRole(signed.data.user.id);
    if (!role) {
      await client.auth.signOut().catch(() => {});
      await this.recordAttempt(email, ipHash, "failure");
      return { status: "no_admin_role" };
    }
    if (role.status !== "active") {
      await client.auth.signOut().catch(() => {});
      await this.recordAttempt(email, ipHash, "failure");
      return { status: "account_blocked" };
    }

    if (role.role_code === "platform_super_admin") {
      const otpClient = createSupabasePublicClient();
      if (!otpClient) return { status: "unavailable" };
      const sent = await otpClient.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      await client.auth.signOut().catch(() => {});
      if (sent.error) {
        await this.recordAttempt(email, ipHash, "failure");
        return { status: "unavailable" };
      }
      const challengeId = randomUUID();
      const expiresAt = new Date(Date.now() + MFA_TTL_MINUTES * 60_000);
      await dbPool.query(
        `UPDATE public.app_admin_mfa_challenges SET invalidated_at=clock_timestamp()
         WHERE user_id=$1 AND is_verified=false AND invalidated_at IS NULL`,
        [signed.data.user.id],
      );
      await dbPool.query(
        `INSERT INTO public.app_admin_mfa_challenges
          (id,user_id,provider,expires_at,request_id,command_id)
         VALUES ($1,$2,'supabase_auth_email_otp',$3,$4,$5)`,
        [challengeId, signed.data.user.id, expiresAt, requestId, randomUUID()],
      );
      await this.recordAttempt(email, ipHash, "mfa_pending");
      return {
        status: "mfa_required",
        mfaChallengeId: challengeId,
        maskedDestination: maskEmail(email),
        expiresAt: expiresAt.toISOString(),
      };
    }

    const sectors = await sectorsFor(signed.data.user.id);
    if (!sectors.length) {
      await client.auth.signOut().catch(() => {});
      await this.recordAttempt(email, ipHash, "failure");
      return { status: "no_admin_role" };
    }
    await this.recordAttempt(email, ipHash, "success");
    return {
      status: "session_created",
      accessToken: signed.data.session.access_token,
      refreshToken: signed.data.session.refresh_token,
      expiresIn: signed.data.session.expires_in,
      role: "platform_admin",
      sectors,
    };
  }

  static async verifyMfa(
    challengeId: string,
    otp: string,
    ipHash: string,
  ): Promise<MfaVerifyResult> {
    if (!dbPool || !supabaseAdmin) return { status: "unavailable" };
    const row = await dbPool.query<{
      user_id: string;
      attempts: number;
      max_attempts: number;
      expires_at: Date | string;
      is_verified: boolean;
      invalidated_at: Date | string | null;
    }>(
      `SELECT user_id,attempts,max_attempts,expires_at,is_verified,invalidated_at
       FROM public.app_admin_mfa_challenges WHERE id=$1`,
      [challengeId],
    );
    const challenge = row.rows[0];
    if (!challenge) return { status: "expired" };
    if (challenge.is_verified || challenge.invalidated_at) return { status: "already_used" };
    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await dbPool.query(
        `UPDATE public.app_admin_mfa_challenges SET invalidated_at=clock_timestamp() WHERE id=$1`,
        [challengeId],
      );
      return { status: "expired" };
    }
    const user = await supabaseAdmin.auth.admin.getUserById(challenge.user_id);
    const email = user.data.user?.email?.toLowerCase();
    if (user.error || !email) return { status: "unavailable" };

    const verifyClient = createSupabasePublicClient();
    if (!verifyClient) return { status: "unavailable" };
    const verified = await verifyClient.auth.verifyOtp({ email, token: otp, type: "email" });
    if (
      verified.error ||
      !verified.data.session ||
      verified.data.user?.id !== challenge.user_id
    ) {
      const attempts = challenge.attempts + 1;
      const invalidate = attempts >= challenge.max_attempts;
      await dbPool.query(
        `UPDATE public.app_admin_mfa_challenges
         SET attempts=$2,invalidated_at=CASE WHEN $3 THEN clock_timestamp() ELSE invalidated_at END
         WHERE id=$1`,
        [challengeId, attempts, invalidate],
      );
      await this.recordAttempt(email, ipHash, "mfa_failure");
      return {
        status: "invalid_code",
        attemptsRemaining: Math.max(0, challenge.max_attempts - attempts),
      };
    }
    await dbPool.query(
      `UPDATE public.app_admin_mfa_challenges
       SET is_verified=true,verified_at=clock_timestamp() WHERE id=$1`,
      [challengeId],
    );
    await this.recordAttempt(email, ipHash, "success");
    return {
      status: "verified",
      accessToken: verified.data.session.access_token,
      refreshToken: verified.data.session.refresh_token,
      expiresIn: verified.data.session.expires_in,
      role: "platform_super_admin",
      sectors: [],
    };
  }

  static async createInvite(
    input: CreateInviteInput,
    actorId: string,
    requestId: string,
    ipHash: string,
    origin: string,
  ): Promise<{ status: "created"; invite: InviteResponse } | { status: "conflict" } | { status: "unavailable" }> {
    if (!dbPool || !supabaseAdmin) return { status: "unavailable" };

    const duplicate = await dbPool.query(
      `SELECT 1 FROM public.app_people WHERE email_normalized=$1
       UNION ALL
       SELECT 1 FROM public.app_admin_invites
        WHERE lower(email)=$1 AND is_accepted=false AND invalidated_at IS NULL
          AND expires_at>now() LIMIT 1`,
      [input.email],
    );
    if (duplicate.rowCount) return { status: "conflict" };

    if (input.targetRole === "platform_admin") {
      const valid = await dbPool.query<{ code: string }>(
        `SELECT code FROM public.app_admin_sectors
          WHERE code=ANY($1::text[]) AND is_active=true`,
        [input.sectors],
      );
      if (valid.rowCount !== input.sectors.length) return { status: "conflict" };
    }

    const token = randomBytes(32).toString("hex");
    const digest = sha256(token);
    const inviteId = randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60_000);
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO public.app_admin_invites
          (id,email,target_role,token_digest,invited_by,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [inviteId, input.email, input.targetRole, digest, actorId, expiresAt],
      );
      for (const sector of input.sectors) {
        await client.query(
          `INSERT INTO public.app_admin_invite_sectors(invite_id,sector_code)
           VALUES ($1,$2)`,
          [inviteId, sector],
        );
      }
      await audit(client, {
        requestId,
        actorId,
        actorRole: "platform_super_admin",
        action: "admin.invite.created",
        targetEntity: "app_admin_invites",
        targetId: inviteId,
        after: { emailHash: sha256(input.email), targetRole: input.targetRole, sectors: input.sectors },
        commandId: input.commandId,
        ipHash,
      });
      await client.query("COMMIT");
    } catch {
      try { await client.query("ROLLBACK"); } catch {}
      return { status: "unavailable" };
    } finally {
      client.release();
    }

    let base = "https://hortvitalmix.vercel.app";
    try { base = new URL(origin).origin; } catch {}
    const redirectTo = `${base}/admin/convite?token=${encodeURIComponent(token)}`;
    const sent = await supabaseAdmin.auth.admin.inviteUserByEmail(input.email, {
      redirectTo,
      data: { hvm_admin_invite_id: inviteId, hvm_admin_role: input.targetRole },
    });
    if (sent.error || !sent.data.user) {
      await dbPool.query(
        `UPDATE public.app_admin_invites SET invalidated_at=clock_timestamp() WHERE id=$1`,
        [inviteId],
      );
      return { status: "unavailable" };
    }
    await dbPool.query(
      `UPDATE public.app_admin_invites SET auth_user_id=$2 WHERE id=$1`,
      [inviteId, sent.data.user.id],
    );

    return {
      status: "created",
      invite: {
        id: inviteId,
        email: input.email,
        targetRole: input.targetRole,
        sectors: input.sectors,
        revision: 1,
        isAccepted: false,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
        invalidatedAt: null,
      },
    };
  }

  static async listInvites(): Promise<InviteResponse[]> {
    if (!dbPool) return [];
    const result = await dbPool.query<{
      id: string; email: string; target_role: AdminRole; revision: number;
      is_accepted: boolean; expires_at: Date | string; created_at: Date | string;
      invalidated_at: Date | string | null; sectors: AdminSectorCode[] | null;
    }>(
      `SELECT i.id,i.email,i.target_role,i.revision,i.is_accepted,i.expires_at,
              i.created_at,i.invalidated_at,
              COALESCE(array_agg(s.sector_code) FILTER (WHERE s.sector_code IS NOT NULL),'{}') AS sectors
         FROM public.app_admin_invites i
         LEFT JOIN public.app_admin_invite_sectors s ON s.invite_id=i.id
        GROUP BY i.id ORDER BY i.created_at DESC LIMIT 100`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      targetRole: row.target_role,
      sectors: row.sectors ?? [],
      revision: row.revision,
      isAccepted: row.is_accepted,
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      invalidatedAt: row.invalidated_at ? new Date(row.invalidated_at).toISOString() : null,
    }));
  }

  static async validateInviteToken(token: string): Promise<ValidateInviteResponse> {
    if (!dbPool || !/^[0-9a-f]{64}$/i.test(token)) return { status: "invalid" };
    const result = await dbPool.query<{
      id: string; email: string; target_role: AdminRole; is_accepted: boolean;
      expires_at: Date | string; invalidated_at: Date | string | null;
      sectors: AdminSectorCode[] | null;
    }>(
      `SELECT i.id,i.email,i.target_role,i.is_accepted,i.expires_at,i.invalidated_at,
              COALESCE(array_agg(s.sector_code) FILTER (WHERE s.sector_code IS NOT NULL),'{}') AS sectors
         FROM public.app_admin_invites i
         LEFT JOIN public.app_admin_invite_sectors s ON s.invite_id=i.id
        WHERE i.token_digest=$1 GROUP BY i.id`,
      [sha256(token)],
    );
    const row = result.rows[0];
    if (!row) return { status: "invalid" };
    if (row.is_accepted) return { status: "already_accepted" };
    if (row.invalidated_at) return { status: "invalidated" };
    if (new Date(row.expires_at).getTime() <= Date.now()) return { status: "expired" };
    return {
      status: "valid",
      email: row.email,
      targetRole: row.target_role,
      sectors: row.sectors ?? [],
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  }

  static async acceptInvite(
    input: AcceptInviteInput,
    requestId: string,
    ipHash: string,
  ): Promise<AcceptInviteResult> {
    if (!dbPool || !supabaseAdmin) return { status: "unavailable" };
    const found = await dbPool.query<{
      id: string; email: string; target_role: AdminRole; auth_user_id: string | null;
      is_accepted: boolean; expires_at: Date | string; invalidated_at: Date | string | null;
    }>(
      `SELECT id,email,target_role,auth_user_id,is_accepted,expires_at,invalidated_at
       FROM public.app_admin_invites WHERE token_digest=$1`,
      [sha256(input.token)],
    );
    const invite = found.rows[0];
    if (!invite) return { status: "invalid_token" };
    if (invite.is_accepted) return { status: "already_accepted" };
    if (invite.invalidated_at) return { status: "invalid_token" };
    if (new Date(invite.expires_at).getTime() <= Date.now()) return { status: "expired" };
    if (!invite.auth_user_id) return { status: "unavailable" };

    const duplicate = await dbPool.query(
      `SELECT 1 FROM public.app_people WHERE cpf_normalized=$1 OR email_normalized=$2 LIMIT 1`,
      [input.cpf, invite.email],
    );
    if (duplicate.rowCount)
      return { status: "identity_conflict", message: "CPF ou e-mail já vinculado." };

    const updated = await supabaseAdmin.auth.admin.updateUserById(invite.auth_user_id, {
      password: input.password,
      email_confirm: true,
      user_metadata: {
        full_name: input.fullName,
        hvm_portal: "administrative",
        hvm_admin_role: invite.target_role,
      },
    });
    if (updated.error) return { status: "unavailable" };

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO public.app_users(id,status) VALUES ($1,'active')
         ON CONFLICT (id) DO UPDATE SET status='active',updated_at=clock_timestamp()`,
        [invite.auth_user_id],
      );
      await client.query(
        `INSERT INTO public.app_people
          (user_id,full_name,cpf_normalized,email_normalized,phone_e164,email_verified_at)
         VALUES ($1,$2,$3,$4,$5,clock_timestamp())`,
        [invite.auth_user_id, input.fullName, input.cpf, invite.email, input.phone],
      );
      await client.query(
        `INSERT INTO public.app_user_role_assignments(user_id,role_code,granted_by)
         VALUES ($1,$2,(SELECT invited_by FROM public.app_admin_invites WHERE id=$3))`,
        [invite.auth_user_id, invite.target_role, invite.id],
      );
      if (invite.target_role === "platform_admin") {
        await client.query(
          `INSERT INTO public.app_admin_sector_members(user_id,sector_code,assigned_by)
           SELECT $1,s.sector_code,i.invited_by
             FROM public.app_admin_invite_sectors s
             JOIN public.app_admin_invites i ON i.id=s.invite_id
            WHERE s.invite_id=$2`,
          [invite.auth_user_id, invite.id],
        );
      }
      await client.query(
        `UPDATE public.app_admin_invites
         SET is_accepted=true,accepted_by=$2,accepted_at=clock_timestamp()
         WHERE id=$1 AND is_accepted=false`,
        [invite.id, invite.auth_user_id],
      );
      await audit(client, {
        requestId,
        actorId: invite.auth_user_id,
        actorRole: invite.target_role,
        action: "admin.invite.accepted",
        targetEntity: "app_admin_invites",
        targetId: invite.id,
        after: { role: invite.target_role },
        commandId: input.commandId,
        ipHash,
      });
      await client.query("COMMIT");
      return { status: "accepted", userId: invite.auth_user_id };
    } catch {
      try { await client.query("ROLLBACK"); } catch {}
      return { status: "unavailable" };
    } finally {
      client.release();
    }
  }
  static async verifyAdminSession(
    userId: string,
    role: AdminRole,
    sessionIssuedAt: string,
  ): Promise<AdminVerifySessionResponse> {
    const current = await activeAdminRole(userId);
    if (!current || current.status !== "active" || current.role_code !== role)
      return { authorized: false, role: null, sectors: [], requiresReauth: true };
    const sectors = role === "platform_admin" ? await sectorsFor(userId) : [];
    if (role === "platform_admin" && sectors.length === 0)
      return { authorized: false, role: null, sectors: [], requiresReauth: true };
    const issued = new Date(sessionIssuedAt).getTime();
    return {
      authorized: true,
      role,
      sectors,
      requiresReauth: !Number.isFinite(issued) || Date.now() - issued > 15 * 60_000,
    };
  }
}
