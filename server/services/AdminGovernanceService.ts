import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { createSupabasePublicClient, supabaseAdmin, supabasePublic } from "../supabase/client.ts";
import { authEmailRetryAfter } from "../security/authEmailRateLimit.ts";
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

type AdminPrincipalRow = {
  admin_user_id: string;
  email_verified_at: string | null;
  portal_role: AdminRole;
  auth_email: string | null;
};

async function adminPrincipalFor(
  email: string,
  portalRole?: AdminRole,
): Promise<{
  principal: AdminPrincipalRow | null;
  unavailable: boolean;
  ambiguous: boolean;
}> {
  const normalized = email.trim().toLowerCase();

  if (supabaseAdmin) {
    let query = supabaseAdmin
      .from("app_admin_principals")
      .select("admin_user_id,email_verified_at,portal_role,auth_email")
      .eq("admin_email", normalized);
    if (portalRole) query = query.eq("portal_role", portalRole);

    const { data, error } = await query.limit(2);
    if (!error) {
      const rows = (data ?? []) as AdminPrincipalRow[];
      if (!portalRole && rows.length > 1)
        return { principal: null, unavailable: false, ambiguous: true };
      return {
        principal: rows[0] ?? null,
        unavailable: false,
        ambiguous: false,
      };
    }
  }

  // Vercel pode estar com a chave server-side do Supabase indisponível,
  // mas com o Postgres configurado. Não transformar isso em HTTP 503 se a
  // mesma fonte canônica puder ser consultada diretamente no banco.
  if (dbPool) {
    try {
      const params: unknown[] = [normalized];
      let roleSql = "";
      if (portalRole) {
        params.push(portalRole);
        roleSql = " AND portal_role=$2";
      }
      const result = await dbPool.query<AdminPrincipalRow>(
        `SELECT admin_user_id,email_verified_at,portal_role,auth_email
           FROM public.app_admin_principals
          WHERE admin_email=$1${roleSql}
          ORDER BY created_at DESC
          LIMIT 2`,
        params,
      );
      if (!portalRole && result.rows.length > 1)
        return { principal: null, unavailable: false, ambiguous: true };
      return {
        principal: result.rows[0] ?? null,
        unavailable: false,
        ambiguous: false,
      };
    } catch {
      return { principal: null, unavailable: true, ambiguous: false };
    }
  }

  return { principal: null, unavailable: true, ambiguous: false };
}

function roleScopedInviteAuthEmail(
  displayEmail: string,
  role: AdminRole,
  inviteId: string,
) {
  const normalized = displayEmail.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return normalized;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  // Gmail/Googlemail entregam aliases com "+tag" na mesma caixa. O e-mail
  // digitado pelo operador continua sendo admin_email; auth_email existe apenas
  // para permitir uma senha independente por portal no Supabase Auth, que exige
  // e-mail único por identidade.
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const tag = role === "platform_admin" ? "admin" : "super";
    return `${local}+hvm-${tag}-${inviteId.slice(0, 8)}@${domain}`;
  }
  return normalized;
}

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
  if (supabaseAdmin) {
    const [{ data: user, error: userError }, { data: roles, error: rolesError }] =
      await Promise.all([
        supabaseAdmin.from("app_users").select("status").eq("id", userId).maybeSingle(),
        supabaseAdmin
          .from("app_user_role_assignments")
          .select("role_code,expires_at")
          .eq("user_id", userId)
          .in("role_code", ["platform_super_admin", "platform_admin"])
          .is("revoked_at", null),
      ]);
    if (!userError && !rolesError && user) {
      const active = (roles ?? [])
        .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > Date.now())
        .sort((a, b) => a.role_code === "platform_super_admin" ? -1 : b.role_code === "platform_super_admin" ? 1 : 0);
      const role = active[0]?.role_code as AdminRole | undefined;
      return role ? { status: user.status, role_code: role } : null;
    }
  }
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
  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("app_admin_sector_members")
      .select("sector_code,expires_at")
      .eq("user_id", userId)
      .is("revoked_at", null);
    if (!error)
      return (data ?? [])
        .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > Date.now())
        .map((row) => row.sector_code as AdminSectorCode)
        .sort();
  }
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
        message: "Não foi possível vincular o acesso administrativo a esta pessoa.",
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
    const emailHash = sha256(email);
    const since = new Date(
      Date.now() - RATE_WINDOW_MINUTES * 60_000,
    ).toISOString();

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("app_admin_auth_attempts")
        .select("email_hash,ip_hash,occurred_at,outcome")
        .gte("occurred_at", since)
        .in("outcome", ["failure", "mfa_failure"])
        .or(`email_hash.eq.${emailHash},ip_hash.eq.${ipHash}`);

      if (!error) {
        const attempts = data ?? [];
        const emailFailures = attempts.filter(
          (row) => String(row.email_hash).trim() === emailHash,
        ).length;
        const ipFailures = attempts.filter(
          (row) => String(row.ip_hash).trim() === ipHash,
        ).length;
        const lastAt = attempts
          .map((row) => new Date(row.occurred_at).getTime())
          .filter(Number.isFinite)
          .sort((a, b) => b - a)[0];

        if (
          (emailFailures < RATE_MAX_FAILURES &&
            ipFailures < RATE_MAX_FAILURES) ||
          !lastAt
        )
          return { limited: false, retryAfterSeconds: 0 };

        const until = lastAt + RATE_WINDOW_MINUTES * 60_000;
        return {
          limited: until > Date.now(),
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((until - Date.now()) / 1000),
          ),
        };
      }
    }

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
      [emailHash, ipHash],
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
    const payload = {
      email_hash: sha256(email),
      ip_hash: ipHash,
      outcome,
    };

    if (supabaseAdmin) {
      const { error } = await supabaseAdmin
        .from("app_admin_auth_attempts")
        .insert(payload);
      if (!error) return;
    }

    if (!dbPool) return;
    await dbPool.query(
      `INSERT INTO public.app_admin_auth_attempts(email_hash,ip_hash,outcome)
       VALUES ($1,$2,$3)`,
      [payload.email_hash, payload.ip_hash, payload.outcome],
    );
  }

  static async requestAdminEmailConfirmation(
    email: string,
    portalRole?: AdminRole,
  ): Promise<{
    status:
      | "sent"
      | "already_verified"
      | "accepted"
      | "cooldown"
      | "unavailable";
    maskedDestination?: string;
    retryAfterSeconds?: number;
  }> {
    const normalized = email.trim().toLowerCase();
    const resolved = await adminPrincipalFor(normalized, portalRole);
    if (resolved.unavailable) return { status: "unavailable" };
    // Sem papel explícito, duas credenciais com o mesmo e-mail são ambíguas.
    // Mantemos resposta anti-enumeração; os portais dedicados sempre enviam o papel.
    if (resolved.ambiguous || !resolved.principal) return { status: "accepted" };

    const principal = resolved.principal;
    if (principal.email_verified_at)
      return {
        status: "already_verified",
        maskedDestination: maskEmail(normalized),
      };

    const client = createSupabasePublicClient();
    if (!client) return { status: "unavailable" };
    const authEmail = principal.auth_email || normalized;
    const sent = await client.auth.signInWithOtp({
      email: authEmail,
      options: { shouldCreateUser: false },
    });
    if (sent.error) {
      const retryAfterSeconds = authEmailRetryAfter(sent.error);
      if (retryAfterSeconds)
        return {
          status: "cooldown",
          maskedDestination: maskEmail(normalized),
          retryAfterSeconds,
        };
      return { status: "unavailable" };
    }

    return {
      status: "sent",
      maskedDestination: maskEmail(normalized),
    };
  }

  static async verifyAdminEmailConfirmation(
    email: string,
    otp: string,
    portalRole?: AdminRole,
  ): Promise<{
    status: "verified" | "invalid_code" | "already_verified" | "unavailable";
  }> {
    const normalized = email.trim().toLowerCase();
    const resolved = await adminPrincipalFor(normalized, portalRole);
    if (resolved.unavailable || resolved.ambiguous || !resolved.principal)
      return { status: "unavailable" };

    const principal = resolved.principal;
    if (principal.email_verified_at) return { status: "already_verified" };

    const client = createSupabasePublicClient();
    if (!client) return { status: "unavailable" };
    const authEmail = principal.auth_email || normalized;
    const verified = await client.auth.verifyOtp({
      email: authEmail,
      token: otp,
      type: "email",
    });

    if (
      verified.error ||
      !verified.data.user ||
      verified.data.user.id !== principal.admin_user_id
    ) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      return { status: "invalid_code" };
    }

    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    const { error: updateError } = await supabaseAdmin!
      .from("app_admin_principals")
      .update({
        email_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("admin_user_id", principal.admin_user_id);

    return updateError ? { status: "unavailable" } : { status: "verified" };
  }

  static async login(
    email: string,
    password: string,
    ipHash: string,
    requestId: string,
    portalRole?: AdminRole,
  ): Promise<AdminLoginResult> {
    const normalized = email.trim().toLowerCase();
    const resolved = await adminPrincipalFor(normalized, portalRole);
    if (resolved.unavailable) return { status: "unavailable" };

    const limited = await this.rateLimit(normalized, ipHash);
    if (limited.limited)
      return {
        status: "rate_limited",
        retryAfterSeconds: limited.retryAfterSeconds,
      };

    if (resolved.ambiguous || !resolved.principal) {
      await this.recordAttempt(normalized, ipHash, "failure");
      return { status: "invalid_credentials" };
    }

    const principal = resolved.principal;
    const authEmail = principal.auth_email || normalized;
    const client = createSupabasePublicClient();
    if (!client) return { status: "unavailable" };
    const signed = await client.auth.signInWithPassword({
      email: authEmail,
      password,
    });
    if (signed.error || !signed.data.user || !signed.data.session) {
      await this.recordAttempt(normalized, ipHash, "failure");
      return { status: "invalid_credentials" };
    }

    if (signed.data.user.id !== principal.admin_user_id) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      await this.recordAttempt(normalized, ipHash, "failure");
      return { status: "no_admin_role" };
    }

    if (!principal.email_verified_at) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      return {
        status: "email_confirmation_required",
        maskedDestination: maskEmail(normalized),
      };
    }

    const role = await activeAdminRole(signed.data.user.id);
    if (!role || role.role_code !== principal.portal_role || (portalRole && role.role_code !== portalRole)) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      await this.recordAttempt(normalized, ipHash, "failure");
      return { status: "no_admin_role" };
    }
    if (role.status !== "active") {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      await this.recordAttempt(normalized, ipHash, "failure");
      return { status: "account_blocked" };
    }

    if (role.role_code === "platform_super_admin") {
      // O e-mail já foi confirmado. Este segundo código é MFA obrigatório do
      // Super administrador (Manual Mestre T05), nunca repetição da confirmação.
      const { data: pending, error: pendingError } = await supabaseAdmin
        .from("app_admin_mfa_challenges")
        .select("id,expires_at,created_at,attempts,max_attempts")
        .eq("user_id", signed.data.user.id)
        .eq("is_verified", false)
        .is("invalidated_at", null)
        .gt("expires_at", new Date().toISOString())
        .gt("created_at", new Date(Date.now() - 60_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pendingError) {
        await client.auth.signOut({ scope: "local" }).catch(() => undefined);
        return { status: "unavailable" };
      }
      if (pending && Number(pending.attempts) < Number(pending.max_attempts)) {
        await client.auth.signOut({ scope: "local" }).catch(() => undefined);
        return {
          status: "mfa_required",
          mfaChallengeId: pending.id,
          maskedDestination: maskEmail(normalized),
          expiresAt: pending.expires_at,
        };
      }

      const otpClient = createSupabasePublicClient();
      if (!otpClient) return { status: "unavailable" };
      const sent = await otpClient.auth.signInWithOtp({
        email: authEmail,
        options: { shouldCreateUser: false },
      });
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      if (sent.error) {
        const retryAfterSeconds = authEmailRetryAfter(sent.error);
        if (retryAfterSeconds)
          return {
            status: "email_rate_limited",
            retryAfterSeconds,
            phase: "mfa",
          };
        return { status: "unavailable" };
      }

      const challengeId = randomUUID();
      const expiresAt = new Date(Date.now() + MFA_TTL_MINUTES * 60_000);

      const invalidated = await supabaseAdmin
        .from("app_admin_mfa_challenges")
        .update({ invalidated_at: new Date().toISOString() })
        .eq("user_id", signed.data.user.id)
        .eq("is_verified", false)
        .is("invalidated_at", null);
      if (invalidated.error) return { status: "unavailable" };

      const inserted = await supabaseAdmin
        .from("app_admin_mfa_challenges")
        .insert({
          id: challengeId,
          user_id: signed.data.user.id,
          provider: "supabase_auth_email_otp",
          expires_at: expiresAt.toISOString(),
          request_id: requestId,
          command_id: randomUUID(),
        });
      if (inserted.error) return { status: "unavailable" };

      await this.recordAttempt(normalized, ipHash, "mfa_pending");
      return {
        status: "mfa_required",
        mfaChallengeId: challengeId,
        maskedDestination: maskEmail(normalized),
        expiresAt: expiresAt.toISOString(),
      };
    }

    const sectors = await sectorsFor(signed.data.user.id);
    if (!sectors.length) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      await this.recordAttempt(normalized, ipHash, "failure");
      return { status: "no_admin_role" };
    }

    await this.recordAttempt(normalized, ipHash, "success");
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
    if (!supabaseAdmin) return { status: "unavailable" };

    const { data: challenge, error } = await supabaseAdmin
      .from("app_admin_mfa_challenges")
      .select(
        "user_id,attempts,max_attempts,expires_at,is_verified,invalidated_at",
      )
      .eq("id", challengeId)
      .maybeSingle();

    if (error) return { status: "unavailable" };
    if (!challenge) return { status: "expired" };
    if (challenge.is_verified || challenge.invalidated_at)
      return { status: "already_used" };

    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await supabaseAdmin
        .from("app_admin_mfa_challenges")
        .update({ invalidated_at: new Date().toISOString() })
        .eq("id", challengeId);
      return { status: "expired" };
    }

    const user = await supabaseAdmin.auth.admin.getUserById(challenge.user_id);
    const email = user.data.user?.email?.toLowerCase();
    if (user.error || !email) return { status: "unavailable" };

    const verifyClient = createSupabasePublicClient();
    if (!verifyClient) return { status: "unavailable" };
    const verified = await verifyClient.auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });

    if (
      verified.error ||
      !verified.data.session ||
      verified.data.user?.id !== challenge.user_id
    ) {
      const attempts = Number(challenge.attempts ?? 0) + 1;
      const invalidate = attempts >= Number(challenge.max_attempts ?? 5);
      await supabaseAdmin
        .from("app_admin_mfa_challenges")
        .update({
          attempts,
          ...(invalidate
            ? { invalidated_at: new Date().toISOString() }
            : {}),
        })
        .eq("id", challengeId);
      await this.recordAttempt(email, ipHash, "mfa_failure");
      return {
        status: "invalid_code",
        attemptsRemaining: Math.max(
          0,
          Number(challenge.max_attempts ?? 5) - attempts,
        ),
      };
    }

    await supabaseAdmin
      .from("app_admin_mfa_challenges")
      .update({
        is_verified: true,
        verified_at: new Date().toISOString(),
      })
      .eq("id", challengeId);

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
    actorRole: AdminRole,
    actorSectors: AdminSectorCode[],
    requestId: string,
    ipHash: string,
    origin: string,
  ): Promise<
    | { status: "created"; invite: InviteResponse }
    | { status: "conflict"; message?: string }
    | { status: "forbidden" }
    | { status: "unavailable" }
  > {
    if (!dbPool || !supabaseAdmin) return { status: "unavailable" };

    if (actorRole === "platform_admin") {
      if (input.targetRole !== "platform_admin") return { status: "forbidden" };
      if (input.sectors.some((sector) => !actorSectors.includes(sector)))
        return { status: "forbidden" };
    }

    const client = await dbPool.connect();
    let inviteId = "";
    let token = "";
    let expiresAt = new Date(0);
    let createdAt = new Date();
    let identityMode: "new" | "existing" = "new";
    let targetPersonId: string | null = null;
    let authEmail = input.email;
    let needsAuthAlias = false;

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

      const pending = await client.query(
        `SELECT 1
           FROM public.app_admin_invites
          WHERE is_accepted=false
            AND invalidated_at IS NULL
            AND expires_at>now()
            AND target_role=$3
            AND (
              lower(email)=$1
              OR ($2::text IS NOT NULL AND target_person_id IN (
                SELECT id FROM public.app_people WHERE cpf_normalized=$2
              ))
            )
          LIMIT 1`,
        [input.email, input.targetCpf ?? null, input.targetRole],
      );
      if (pending.rowCount) {
        await client.query("ROLLBACK");
        return { status: "conflict", message: "Já existe convite administrativo pendente." };
      }

      const emailInUse = await client.query(
        `SELECT 1
           FROM public.app_admin_principals
          WHERE admin_email=$1 AND portal_role=$2
          LIMIT 1`,
        [input.email, input.targetRole],
      );
      if (emailInUse.rowCount) {
        await client.query("ROLLBACK");
        return {
          status: "conflict",
          message: "Este e-mail já possui uma credencial para este mesmo portal.",
        };
      }

      const emailUsedByOtherPortal = await client.query(
        `SELECT 1
           FROM public.app_admin_principals
          WHERE admin_email=$1 AND portal_role<>$2
          LIMIT 1`,
        [input.email, input.targetRole],
      );
      needsAuthAlias = Boolean(emailUsedByOtherPortal.rowCount);

      if (input.targetCpf) {
        const person = await client.query<{
          id: string;
          user_id: string;
          email_normalized: string;
          status: string;
        }>(
          `SELECT p.id,p.user_id,p.email_normalized,u.status
             FROM public.app_people p
             JOIN public.app_users u ON u.id=p.user_id
            WHERE p.cpf_normalized=$1
            LIMIT 1`,
          [input.targetCpf],
        );
        const existing = person.rows[0];
        if (!existing || existing.status !== "active") {
          await client.query("ROLLBACK");
          return { status: "conflict", message: "CPF não localizado em cadastro ativo." };
        }

        const eligibleIdentity = await client.query(
          `SELECT 1
             FROM public.app_user_role_assignments
            WHERE user_id=$1
              AND role_code IN ('consumer','producer')
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at>now())
            UNION ALL
           SELECT 1
             FROM public.app_admin_principals
            WHERE person_id=$2
            LIMIT 1`,
          [existing.user_id, existing.id],
        );
        if (!eligibleIdentity.rowCount) {
          await client.query("ROLLBACK");
          return {
            status: "conflict",
            message: "CPF não pertence a uma identidade ativa elegível para acesso administrativo.",
          };
        }

        const alreadyLinked = await client.query(
          `SELECT 1
             FROM public.app_admin_principals
            WHERE person_id=$1 AND portal_role=$2
            LIMIT 1`,
          [existing.id, input.targetRole],
        );
        if (alreadyLinked.rowCount) {
          await client.query("ROLLBACK");
          return {
            status: "conflict",
            message: "Esta pessoa já possui credencial para este mesmo portal administrativo.",
          };
        }

        // A mesma pessoa pode usar o mesmo Gmail no cadastro público e nos
        // portais administrativos. A senha continua independente porque o Auth
        // recebe um alias técnico por portal e o login resolve o alias no backend.
        if (existing.email_normalized === input.email) needsAuthAlias = true;

        identityMode = "existing";
        targetPersonId = existing.id;
      } else {
        const publicEmail = await client.query(
          `SELECT 1 FROM public.app_people WHERE email_normalized=$1 LIMIT 1`,
          [input.email],
        );
        if (publicEmail.rowCount) {
          await client.query("ROLLBACK");
          return {
            status: "conflict",
            message: "Informe o CPF do cadastro existente para vinculá-lo ao acesso administrativo.",
          };
        }
      }

      if (input.targetRole === "platform_admin") {
        const valid = await client.query<{ code: string }>(
          `SELECT code FROM public.app_admin_sectors
            WHERE code=ANY($1::text[]) AND is_active=true`,
          [input.sectors],
        );
        if (valid.rowCount !== input.sectors.length) {
          await client.query("ROLLBACK");
          return { status: "conflict", message: "Setor administrativo inválido." };
        }
      }

      token = randomBytes(32).toString("hex");
      const digest = sha256(token);
      inviteId = randomUUID();
      authEmail = needsAuthAlias
        ? roleScopedInviteAuthEmail(input.email, input.targetRole, inviteId)
        : input.email;
      if (needsAuthAlias && authEmail === input.email) {
        await client.query("ROLLBACK");
        return {
          status: "conflict",
          message:
            "Para manter duas senhas no mesmo endereço de e-mail, o provedor precisa aceitar alias. Use uma conta Gmail/Googlemail ou outro e-mail administrativo.",
        };
      }
      expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60_000);
      const inserted = await client.query<{ created_at: Date | string }>(
        `INSERT INTO public.app_admin_invites
          (id,email,auth_email,target_role,token_digest,invited_by,expires_at,target_person_id,identity_mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING created_at`,
        [
          inviteId,
          input.email,
          authEmail,
          input.targetRole,
          digest,
          actorId,
          expiresAt,
          targetPersonId,
          identityMode,
        ],
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
        actorRole,
        action: identityMode === "existing"
          ? "admin.identity.link_invited"
          : "admin.invite.created",
        targetEntity: "app_admin_invites",
        targetId: inviteId,
        after: {
          emailHash: sha256(input.email),
          targetRole: input.targetRole,
          sectors: input.sectors,
          identityMode,
          targetPersonId,
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

    const sent = await supabaseAdmin.auth.admin.inviteUserByEmail(authEmail, {
      redirectTo,
      data: {
        hvm_admin_invite_id: inviteId,
        hvm_admin_role: input.targetRole,
        hvm_identity_mode: identityMode,
      },
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
      return {
        status: sent.error?.status === 422 ? "conflict" : "unavailable",
        message: sent.error?.status === 422
          ? "Já existe uma identidade de autenticação para este endereço técnico."
          : undefined,
      };
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
        identityMode,
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

  static async listInvites(
    actorId: string,
    actorRole: AdminRole,
  ): Promise<InviteResponse[]> {
    if (!dbPool) return [];
    const params: unknown[] = [];
    let where = "";
    if (actorRole === "platform_admin") {
      params.push(actorId);
      where = "WHERE i.invited_by=$1";
    }
    const result = await dbPool.query<{
      id: string; email: string; target_role: AdminRole; identity_mode: "new" | "existing";
      revision: number; is_accepted: boolean; expires_at: Date | string;
      created_at: Date | string; invalidated_at: Date | string | null;
      invited_by: string; sectors: AdminSectorCode[] | null;
    }>(
      `SELECT i.id,i.email,i.target_role,i.identity_mode,i.revision,i.is_accepted,i.expires_at,
              i.created_at,i.invalidated_at,i.invited_by,
              COALESCE(array_agg(s.sector_code) FILTER (WHERE s.sector_code IS NOT NULL),'{}') AS sectors
         FROM public.app_admin_invites i
         LEFT JOIN public.app_admin_invite_sectors s ON s.invite_id=i.id
         ${where}
        GROUP BY i.id ORDER BY i.created_at DESC LIMIT 100`,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      targetRole: row.target_role,
      identityMode: row.identity_mode,
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
      id: string; email: string; target_role: AdminRole; identity_mode: "new" | "existing";
      target_person_id: string | null; auth_user_id: string | null;
      is_accepted: boolean; expires_at: Date | string;
      invalidated_at: Date | string | null; sectors: AdminSectorCode[] | null;
    }>(
      `SELECT i.id,i.email,i.target_role,i.identity_mode,i.target_person_id,i.auth_user_id,
              i.is_accepted,i.expires_at,i.invalidated_at,
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

    let existingRoles: Array<"consumer" | "producer"> = [];
    if (row.identity_mode === "existing" && row.target_person_id) {
      const roles = await dbPool.query<{ role_code: "consumer" | "producer" }>(
        `SELECT r.role_code
           FROM public.app_people p
           JOIN public.app_user_role_assignments r ON r.user_id=p.user_id
          WHERE p.id=$1
            AND r.role_code IN ('consumer','producer')
            AND r.revoked_at IS NULL
            AND (r.expires_at IS NULL OR r.expires_at>now())
          ORDER BY r.role_code`,
        [row.target_person_id],
      );
      existingRoles = roles.rows.map((item) => item.role_code);
    }

    return {
      status: "valid",
      email: row.email,
      targetRole: row.target_role,
      identityMode: row.identity_mode,
      existingRoles,
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
        identity_mode: "new" | "existing";
        target_person_id: string | null;
        auth_user_id: string | null;
        auth_email: string | null;
        invited_by: string;
        is_accepted: boolean;
        expires_at: Date | string;
        invalidated_at: Date | string | null;
      }>(
        `SELECT id,email,target_role,identity_mode,target_person_id,auth_user_id,auth_email,invited_by,
                is_accepted,expires_at,invalidated_at
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

      const targetUserId = invite.auth_user_id;
      let personId = invite.target_person_id;

      const updated = await supabaseAdmin.auth.admin.updateUserById(
        targetUserId,
        {
          password: input.password,
          email_confirm: true,
          user_metadata: {
            full_name: input.fullName ?? undefined,
            hvm_portal: "administrative",
            hvm_admin_role: invite.target_role,
            hvm_identity_mode: invite.identity_mode,
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
        [targetUserId],
      );

      if (invite.identity_mode === "existing") {
        if (!personId) {
          await client.query("ROLLBACK");
          return { status: "unavailable" };
        }
        const person = await client.query<{
          id: string;
          cpf_normalized: string;
          status: string;
        }>(
          `SELECT p.id,p.cpf_normalized,u.status
             FROM public.app_people p
             JOIN public.app_users u ON u.id=p.user_id
            WHERE p.id=$1
            FOR UPDATE`,
          [personId],
        );
        const existing = person.rows[0];
        if (
          !existing ||
          existing.status !== "active" ||
          existing.cpf_normalized !== input.cpf
        ) {
          await client.query("ROLLBACK");
          return {
            status: "identity_conflict",
            message: "Os dados não correspondem ao cadastro público selecionado.",
          };
        }

        const alreadyLinked = await client.query(
          `SELECT 1 FROM public.app_admin_principals
            WHERE portal_role=$3
              AND (person_id=$1 OR admin_email=$2)
            LIMIT 1`,
          [personId, invite.email, invite.target_role],
        );
        if (alreadyLinked.rowCount) {
          await client.query("ROLLBACK");
          return {
            status: "identity_conflict",
            message: "A pessoa já possui credencial para este mesmo portal administrativo.",
          };
        }
      } else {
        if (!input.fullName || !input.phone) {
          await client.query("ROLLBACK");
          return {
            status: "validation_failed",
            message: "Nome e celular são obrigatórios para uma nova identidade.",
          };
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

        const createdPerson = await client.query<{ id: string }>(
          `INSERT INTO public.app_people
            (user_id,full_name,cpf_normalized,email_normalized,phone_e164,email_verified_at)
           VALUES ($1,$2,$3,$4,$5,clock_timestamp())
           RETURNING id`,
          [targetUserId, input.fullName, input.cpf, invite.email, input.phone],
        );
        personId = createdPerson.rows[0]?.id ?? null;
      }

      if (!personId) {
        await client.query("ROLLBACK");
        return { status: "unavailable" };
      }

      await client.query(
        `INSERT INTO public.app_admin_principals
          (admin_user_id,person_id,admin_email,portal_role,auth_email,created_by,email_verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp())`,
        [
          targetUserId,
          personId,
          invite.email,
          invite.target_role,
          invite.auth_email ?? invite.email,
          invite.invited_by,
        ],
      );

      await client.query(
        `INSERT INTO public.app_user_role_assignments
          (user_id,role_code,granted_by,granted_at,expires_at,revoked_at,revoked_by,revoke_reason)
         VALUES ($1,$2,$3,clock_timestamp(),NULL,NULL,NULL,NULL)
         ON CONFLICT (user_id,role_code) DO UPDATE
           SET granted_by=EXCLUDED.granted_by,
               granted_at=clock_timestamp(),
               expires_at=NULL,
               revoked_at=NULL,
               revoked_by=NULL,
               revoke_reason=NULL`,
        [targetUserId, invite.target_role, invite.invited_by],
      );

      if (invite.target_role === "platform_super_admin") {
        await client.query(
          `UPDATE public.app_user_role_assignments
              SET revoked_at=clock_timestamp(),
                  revoked_by=$2,
                  revoke_reason='promoted_to_super_admin'
            WHERE user_id=$1
              AND role_code='platform_admin'
              AND revoked_at IS NULL`,
          [targetUserId, invite.invited_by],
        );
        await client.query(
          `UPDATE public.app_admin_sector_members
              SET revoked_at=clock_timestamp(),
                  revoked_by=$2,
                  revoke_reason='promoted_to_super_admin',
                  authorization_version=authorization_version+1
            WHERE user_id=$1 AND revoked_at IS NULL`,
          [targetUserId, invite.invited_by],
        );
      }

      if (invite.target_role === "platform_admin") {
        await client.query(
          `INSERT INTO public.app_admin_sector_members
            (user_id,sector_code,assigned_by,assigned_at,expires_at,revoked_at,revoked_by,revoke_reason)
           SELECT $1,s.sector_code,i.invited_by,clock_timestamp(),NULL,NULL,NULL,NULL
             FROM public.app_admin_invite_sectors s
             JOIN public.app_admin_invites i ON i.id=s.invite_id
            WHERE s.invite_id=$2
           ON CONFLICT (user_id,sector_code) DO UPDATE
             SET assigned_by=EXCLUDED.assigned_by,
                 assigned_at=clock_timestamp(),
                 expires_at=NULL,
                 revoked_at=NULL,
                 revoked_by=NULL,
                 revoke_reason=NULL,
                 authorization_version=public.app_admin_sector_members.authorization_version+1`,
          [targetUserId, invite.id],
        );
      }

      await client.query(
        `UPDATE public.app_users
            SET authorization_revision=authorization_revision+1,
                revision=revision+1,
                updated_at=clock_timestamp()
          WHERE id=$1`,
        [targetUserId],
      );

      await client.query(
        `UPDATE public.app_admin_invites
            SET is_accepted=true,
                accepted_by=$2,
                accepted_at=clock_timestamp(),
                revision=revision+1
          WHERE id=$1 AND is_accepted=false`,
        [invite.id, targetUserId],
      );

      await audit(client, {
        requestId,
        actorId: targetUserId,
        actorRole: invite.target_role,
        action: invite.identity_mode === "existing"
          ? "admin.identity.linked"
          : "admin.invite.accepted",
        targetEntity: "app_admin_principals",
        targetId: targetUserId,
        after: {
          role: invite.target_role,
          identityMode: invite.identity_mode,
          personId,
          preservedPublicIdentity: invite.identity_mode === "existing",
        },
        commandId: input.commandId,
        ipHash,
      });

      await client.query("COMMIT");
      return { status: "accepted", userId: targetUserId };
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
