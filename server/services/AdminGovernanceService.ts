import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { createSupabasePublicClient, supabaseAdmin, supabasePublic } from "../supabase/client.ts";
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
const RATE_MAX_FAILURES = 10;
const ZERO_HASH = "0".repeat(64);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// Política canônica do bootstrap: o e-mail autorizado é representado somente
// por seu SHA-256 no código server-side. Isso elimina divergências entre
// Google Studio e Vercel sem expor o endereço em texto puro no repositório.
const CANONICAL_BOOTSTRAP_EMAIL_SHA256 =
  "e5529eeb9b99fcafc370d6fb5855ade0082855cbfee746a7a85aa9a09f29d699";
const maskEmail = (email: string) => {
  const [name, domain = ""] = email.split("@");
  const start = name.slice(0, Math.min(2, name.length));
  const end = name.length > 4 ? name.slice(-2) : "";
  return `${start}***${end}@${domain}`;
};

const normalizeBootstrapAdminEmail = (value: string | undefined) => {
  let normalized = (value ?? "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim();

  const assignment =
    /^BOOTSTRAP_ADMIN_EMAIL\s*=\s*(.+)$/i.exec(normalized) ||
    /^BOOTSTRAP_ADMIN_EMAIL\s*:\s*(.+)$/i.exec(normalized);
  if (assignment?.[1]) normalized = assignment[1].trim();

  if (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")) ||
      (normalized.startsWith("<") && normalized.endsWith(">")))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  normalized = normalized.replace(/[;,]+$/, "").trim();

  return normalized
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim()
    .toLowerCase();
};

const isCanonicalBootstrapAdminEmail = (value: string | undefined) => {
  const normalized = normalizeBootstrapAdminEmail(value);
  if (!normalized) return false;
  const actual = Buffer.from(sha256(normalized), "hex");
  const expected = Buffer.from(CANONICAL_BOOTSTRAP_EMAIL_SHA256, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

async function resolveBootstrapAuthorizedEmailFromSupabase() {
  const client = supabaseAdmin ?? supabasePublic;
  if (!client) return { email: null as string | null, unavailable: true };

  const { data, error } = await client
    .from("app_global_config")
    .select("support_email")
    .eq("singleton_guard", true)
    .maybeSingle();

  if (error) {
    console.error("[BOOTSTRAP] Falha ao ler app_global_config via Data API", {
      code: error.code,
    });
    return { email: null as string | null, unavailable: true };
  }

  const databaseEmail = normalizeBootstrapAdminEmail(
    data?.support_email ?? undefined,
  );
  if (!databaseEmail || !isCanonicalBootstrapAdminEmail(databaseEmail))
    return { email: null as string | null, unavailable: false };

  const configured = normalizeBootstrapAdminEmail(
    process.env.BOOTSTRAP_ADMIN_EMAIL,
  );
  if (configured && configured !== databaseEmail) {
    console.warn(
      "[BOOTSTRAP] BOOTSTRAP_ADMIN_EMAIL diverge do e-mail canônico " +
        "persistido no Supabase; a política do banco prevalecerá.",
    );
  }

  return { email: databaseEmail, unavailable: false };
}

async function activeSuperAdminViaDataApi() {
  if (!supabaseAdmin)
    return { active: false, unavailable: true };

  const { data: roles, error: rolesError } = await supabaseAdmin
    .from("app_user_role_assignments")
    .select("user_id,expires_at")
    .eq("role_code", "platform_super_admin")
    .is("revoked_at", null)
    .limit(50);

  if (rolesError)
    return { active: false, unavailable: true };

  const now = Date.now();
  const userIds = (roles ?? [])
    .filter((row) => {
      if (!row.expires_at) return true;
      const expires = new Date(row.expires_at).getTime();
      return Number.isFinite(expires) && expires > now;
    })
    .map((row) => row.user_id);

  if (!userIds.length)
    return { active: false, unavailable: false };

  const { data: users, error: usersError } = await supabaseAdmin
    .from("app_users")
    .select("id")
    .in("id", userIds)
    .eq("status", "active")
    .limit(1);

  if (usersError)
    return { active: false, unavailable: true };

  return { active: Boolean(users?.length), unavailable: false };
}

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
    const policy = await resolveBootstrapAuthorizedEmailFromSupabase();
    if (policy.unavailable)
      return {
        status: "disabled",
        reason: "Não foi possível consultar a política de bootstrap no Supabase.",
        authorizedEmailHint: null,
      };
    if (!policy.email)
      return {
        status: "disabled",
        reason: "Política do primeiro Super administrador não encontrada no Supabase.",
        authorizedEmailHint: null,
      };

    const dataApiStatus = await activeSuperAdminViaDataApi();
    if (!dataApiStatus.unavailable)
      return dataApiStatus.active
        ? {
            status: "closed",
            reason: "Já existe Super administrador ativo.",
            authorizedEmailHint: null,
          }
        : {
            status: "open",
            reason: null,
            authorizedEmailHint: null,
          };

    if (!dbPool)
      return {
        status: "open",
        reason: null,
        authorizedEmailHint: null,
      };

    try {
      const result = await dbPool.query(
        `SELECT 1 FROM public.app_user_role_assignments r
         JOIN public.app_users u ON u.id=r.user_id
         WHERE r.role_code='platform_super_admin' AND r.revoked_at IS NULL
         AND (r.expires_at IS NULL OR r.expires_at>now()) AND u.status='active' LIMIT 1`,
      );
      return result.rowCount
        ? {
            status: "closed",
            reason: "Já existe Super administrador ativo.",
            authorizedEmailHint: null,
          }
        : {
            status: "open",
            reason: null,
            authorizedEmailHint: null,
          };
    } catch {
      // A tela de bootstrap não é a barreira de segurança. Se a consulta de
      // status falhar, o POST continuará validando lock, identidade e fechamento.
      return {
        status: "open",
        reason: null,
        authorizedEmailHint: null,
      };
    }
  }

  static async executeBootstrap(
    input: BootstrapRequestInput,
    requestId: string,
    ipHash: string,
  ): Promise<BootstrapResult> {
    if (!supabaseAdmin) return { status: "unavailable" };

    const policy = await resolveBootstrapAuthorizedEmailFromSupabase();
    if (policy.unavailable) return { status: "unavailable" };
    if (!policy.email) return { status: "disabled" };

    const bootstrapEmail = normalizeBootstrapAdminEmail(input.email);
    if (bootstrapEmail !== policy.email)
      return { status: "email_not_authorized" };

    const status = await activeSuperAdminViaDataApi();
    if (!status.unavailable && status.active)
      return { status: "already_closed" };

    const [emailConflict, cpfConflict] = await Promise.all([
      supabaseAdmin
        .from("app_people")
        .select("user_id")
        .eq("email_normalized", bootstrapEmail)
        .limit(1),
      supabaseAdmin
        .from("app_people")
        .select("user_id")
        .eq("cpf_normalized", input.cpf)
        .limit(1),
    ]);

    if (emailConflict.error || cpfConflict.error)
      return { status: "unavailable" };
    if (emailConflict.data?.length || cpfConflict.data?.length)
      return {
        status: "identity_conflict",
        message: "E-mail ou CPF já vinculado.",
      };

    const created = await supabaseAdmin.auth.admin.createUser({
      email: bootstrapEmail,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        full_name: input.fullName,
        hvm_portal: "administrative",
      },
    });

    if (created.error || !created.data.user) {
      return {
        status: "identity_conflict",
        message:
          created.error?.message ?? "Não foi possível criar a identidade.",
      };
    }

    const authUserId = created.data.user.id;

    const cleanup = async () => {
      try {
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
      } catch {
        // Melhor esforço: a função RPC não confirmou o bootstrap.
      }
      try {
        await supabaseAdmin.from("app_users").delete().eq("id", authUserId);
      } catch {
        // O trigger de auth pode deixar um espelho suspenso; não bloqueia nova tentativa.
      }
    };

    const { data, error } = await supabaseAdmin.rpc(
      "fn_finalize_first_super_admin",
      {
        p_user_id: authUserId,
        p_full_name: input.fullName,
        p_cpf_normalized: input.cpf,
        p_email_normalized: bootstrapEmail,
        p_phone_e164: input.phone,
        p_request_id: requestId,
        p_command_id: input.commandId,
        p_client_ip_hash: ipHash || ZERO_HASH,
      },
    );

    if (error) {
      console.error("[BOOTSTRAP] RPC finalize failed", { code: error.code });
      await cleanup();
      return { status: "unavailable" };
    }

    const rpcStatus =
      data && typeof data === "object" && "status" in data
        ? String((data as { status?: unknown }).status ?? "")
        : "";

    if (rpcStatus === "completed")
      return { status: "completed", userId: authUserId };

    await cleanup();

    if (rpcStatus === "already_closed")
      return { status: "already_closed" };
    if (rpcStatus === "email_not_authorized")
      return { status: "email_not_authorized" };
    if (rpcStatus === "identity_conflict")
      return {
        status: "identity_conflict",
        message: "E-mail ou CPF já vinculado.",
      };
    if (rpcStatus === "validation_failed")
      return {
        status: "validation_failed",
        message: "Dados inválidos para o primeiro Super administrador.",
      };
    if (rpcStatus === "disabled")
      return { status: "disabled" };

    return { status: "unavailable" };
  }

  private static async rateLimit(email: string, ipHash: string) {
    if (!dbPool) return { limited: false, retryAfterSeconds: 0 };
    const result = await dbPool.query<{
      email_failures: string;
      ip_failures: string;
      last_at: Date | string | null;
    }>(
      `SELECT
         count(*) FILTER (WHERE email_hash=$1)::text AS email_failures,
         count(*) FILTER (WHERE ip_hash=$2)::text AS ip_failures,
         max(occurred_at) FILTER (WHERE email_hash=$1 OR ip_hash=$2) AS last_at
       FROM public.app_admin_auth_attempts
       WHERE occurred_at > now() - interval '15 minutes'
         AND outcome IN ('failure','mfa_failure')
         AND (email_hash=$1 OR ip_hash=$2)`,
      [sha256(email), ipHash],
    );
    const emailFailures = Number(result.rows[0]?.email_failures ?? 0);
    const ipFailures = Number(result.rows[0]?.ip_failures ?? 0);
    const lastAt = result.rows[0]?.last_at;
    if (
      (emailFailures < RATE_MAX_FAILURES && ipFailures < RATE_MAX_FAILURES) ||
      !lastAt
    )
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

    const client = await dbPool.connect();
    let inviteId = "";
    let token = "";
    let expiresAt = new Date(0);
    let createdAt = new Date();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`invite:${input.email}`],
      );

      await client.query(
        `UPDATE public.app_admin_invites
            SET invalidated_at=clock_timestamp(),revision=revision+1
          WHERE lower(email)=$1 AND is_accepted=false AND invalidated_at IS NULL
            AND expires_at<=now()`,
        [input.email],
      );

      const duplicate = await client.query(
        `SELECT 1 FROM public.app_people WHERE email_normalized=$1
         UNION ALL
         SELECT 1 FROM public.app_admin_invites
          WHERE lower(email)=$1 AND is_accepted=false AND invalidated_at IS NULL
            AND expires_at>now() LIMIT 1`,
        [input.email],
      );
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        return { status: "conflict" };
      }

      if (input.targetRole === "platform_admin") {
        const valid = await client.query<{ code: string }>(
          `SELECT code FROM public.app_admin_sectors
            WHERE code=ANY($1::text[]) AND is_active=true`,
          [input.sectors],
        );
        if (valid.rowCount !== input.sectors.length) {
          await client.query("ROLLBACK");
          return { status: "conflict" };
        }
      }

      token = randomBytes(32).toString("hex");
      const digest = sha256(token);
      inviteId = randomUUID();
      expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60_000);
      const inserted = await client.query<{ created_at: Date | string }>(
        `INSERT INTO public.app_admin_invites
          (id,email,target_role,token_digest,invited_by,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING created_at`,
        [inviteId, input.email, input.targetRole, digest, actorId, expiresAt],
      );
      createdAt = new Date(inserted.rows[0]?.created_at ?? Date.now());

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
        after: {
          emailHash: sha256(input.email),
          targetRole: input.targetRole,
          sectors: input.sectors,
        },
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
    const redirectTo = `${base}/admin/aceitar-convite?token=${encodeURIComponent(token)}`;
    const sent = await supabaseAdmin.auth.admin.inviteUserByEmail(input.email, {
      redirectTo,
      data: { hvm_admin_invite_id: inviteId, hvm_admin_role: input.targetRole },
    });
    if (sent.error || !sent.data.user) {
      if (sent.data.user?.id) {
        await supabaseAdmin.auth.admin.deleteUser(sent.data.user.id).catch(() => undefined);
      }
      await dbPool.query(
        `UPDATE public.app_admin_invites
            SET invalidated_at=clock_timestamp(),revision=revision+1
          WHERE id=$1 AND is_accepted=false`,
        [inviteId],
      ).catch(() => undefined);
      return { status: "unavailable" };
    }

    try {
      await dbPool.query(
        `UPDATE public.app_admin_invites SET auth_user_id=$2 WHERE id=$1`,
        [inviteId, sent.data.user.id],
      );
    } catch {
      await supabaseAdmin.auth.admin.deleteUser(sent.data.user.id).catch(() => undefined);
      await dbPool.query(
        `UPDATE public.app_admin_invites
            SET invalidated_at=clock_timestamp(),revision=revision+1
          WHERE id=$1 AND is_accepted=false`,
        [inviteId],
      ).catch(() => undefined);
      return { status: "unavailable" };
    }

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
        createdAt: createdAt.toISOString(),
        invalidatedAt: null,
        invitedBy: actorId,
      },
    };
  }

  static async listInvites(): Promise<InviteResponse[]> {
    if (!dbPool) return [];
    const result = await dbPool.query<{
      id: string; email: string; target_role: AdminRole; revision: number;
      is_accepted: boolean; expires_at: Date | string; created_at: Date | string;
      invalidated_at: Date | string | null; invited_by: string; sectors: AdminSectorCode[] | null;
    }>(
      `SELECT i.id,i.email,i.target_role,i.revision,i.is_accepted,i.expires_at,
              i.created_at,i.invalidated_at,i.invited_by,
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
      invitedBy: row.invited_by,
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

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{
        id: string;
        email: string;
        target_role: AdminRole;
        auth_user_id: string | null;
        is_accepted: boolean;
        expires_at: Date | string;
        invalidated_at: Date | string | null;
      }>(
        `SELECT id,email,target_role,auth_user_id,is_accepted,expires_at,invalidated_at
           FROM public.app_admin_invites
          WHERE token_digest=$1
          FOR UPDATE`,
        [sha256(input.token)],
      );
      const invite = found.rows[0];
      if (!invite) {
        await client.query("ROLLBACK");
        return { status: "invalid_token" };
      }
      if (invite.is_accepted) {
        await client.query("ROLLBACK");
        return { status: "already_accepted" };
      }
      if (invite.invalidated_at) {
        await client.query("ROLLBACK");
        return { status: "invalid_token" };
      }
      if (new Date(invite.expires_at).getTime() <= Date.now()) {
        await client.query(
          `UPDATE public.app_admin_invites
              SET invalidated_at=clock_timestamp(),revision=revision+1
            WHERE id=$1`,
          [invite.id],
        );
        await client.query("COMMIT");
        return { status: "expired" };
      }
      if (!invite.auth_user_id) {
        await client.query("ROLLBACK");
        return { status: "unavailable" };
      }

      const duplicate = await client.query(
        `SELECT 1 FROM public.app_people
          WHERE cpf_normalized=$1 OR email_normalized=$2
          LIMIT 1`,
        [input.cpf, invite.email],
      );
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        return { status: "identity_conflict", message: "CPF ou e-mail já vinculado." };
      }

      const updated = await supabaseAdmin.auth.admin.updateUserById(
        invite.auth_user_id,
        {
          password: input.password,
          email_confirm: true,
          user_metadata: {
            full_name: input.fullName,
            hvm_portal: "administrative",
            hvm_admin_role: invite.target_role,
          },
        },
      );
      if (updated.error) {
        await client.query("ROLLBACK");
        return { status: "unavailable" };
      }

      await client.query(
        `INSERT INTO public.app_users(id,status) VALUES ($1,'active')
         ON CONFLICT (id) DO UPDATE
           SET status='active',
               blocked_at=NULL,
               blocked_by=NULL,
               block_reason=NULL,
               authorization_revision=public.app_users.authorization_revision+1,
               revision=public.app_users.revision+1,
               updated_at=clock_timestamp()`,
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
            SET is_accepted=true,
                accepted_by=$2,
                accepted_at=clock_timestamp(),
                revision=revision+1
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
