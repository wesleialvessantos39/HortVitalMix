import { createHash, randomBytes } from "node:crypto";
import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import type { PortalRole } from "../../shared/contracts/auth.ts";

type ChallengePurpose = "password_recovery" | "security_code";

const RECOVERY_TTL_MINUTES = 30;
const SECURITY_CODE_TTL_MINUTES = 10;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function generateFlowToken() {
  return randomBytes(32).toString("base64url");
}

function isAdministrativeRole(role: PortalRole) {
  return role === "platform_admin" || role === "platform_super_admin";
}

export async function findActiveIdentityForRole(
  email: string,
  role: PortalRole,
) {
  const normalized = email.trim().toLowerCase();

  if (supabaseAdmin) {
    let userId: string | null = null;
    let identityEmail = normalized;

    if (isAdministrativeRole(role)) {
      const { data: principal, error } = await supabaseAdmin
        .from("app_admin_principals")
        .select("admin_user_id,admin_email")
        .eq("admin_email", normalized)
        .maybeSingle();
      if (error) return null;
      userId = principal?.admin_user_id ?? null;
      identityEmail = principal?.admin_email ?? normalized;
    } else {
      const { data: person, error } = await supabaseAdmin
        .from("app_people")
        .select("user_id,email_normalized")
        .eq("email_normalized", normalized)
        .maybeSingle();
      if (error) return null;
      userId = person?.user_id ?? null;
      identityEmail = person?.email_normalized ?? normalized;
    }

    if (!userId) return null;

    const [{ data: user, error: userError }, { data: assignments, error: roleError }] =
      await Promise.all([
        supabaseAdmin
          .from("app_users")
          .select("status")
          .eq("id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("app_user_role_assignments")
          .select("role_code,expires_at")
          .eq("user_id", userId)
          .eq("role_code", role)
          .is("revoked_at", null),
      ]);

    if (userError || roleError || user?.status !== "active") return null;
    const active = (assignments ?? []).some(
      (row) => !row.expires_at || new Date(row.expires_at).getTime() > Date.now(),
    );
    return active ? { user_id: userId, email_normalized: identityEmail } : null;
  }

  if (!dbPool) return null;
  if (isAdministrativeRole(role)) {
    const result = await dbPool.query<{ user_id: string; email_normalized: string }>(
      `SELECT u.id AS user_id, ap.admin_email AS email_normalized
         FROM public.app_users u
         JOIN public.app_admin_principals ap ON ap.admin_user_id=u.id
         JOIN public.app_user_role_assignments r ON r.user_id=u.id
        WHERE ap.admin_email=$1
          AND u.status='active'
          AND r.role_code=$2
          AND r.revoked_at IS NULL
          AND (r.expires_at IS NULL OR r.expires_at>now())
        LIMIT 1`,
      [normalized, role],
    );
    return result.rows[0] ?? null;
  }

  const result = await dbPool.query<{ user_id: string; email_normalized: string }>(
    `SELECT u.id AS user_id, p.email_normalized
       FROM public.app_users u
       JOIN public.app_people p ON p.user_id = u.id
       JOIN public.app_user_role_assignments r ON r.user_id = u.id
      WHERE p.email_normalized = $1
        AND u.status = 'active'
        AND r.role_code = $2
        AND r.revoked_at IS NULL
        AND (r.expires_at IS NULL OR r.expires_at > now())
      LIMIT 1`,
    [normalized, role],
  );
  return result.rows[0] ?? null;
}

async function invalidateActive(
  userId: string,
  purpose: ChallengePurpose,
  role?: PortalRole,
) {
  if (supabaseAdmin) {
    let query = supabaseAdmin
      .from("app_role_security_challenges")
      .update({ invalidated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("purpose", purpose)
      .is("consumed_at", null)
      .is("invalidated_at", null);
    if (role) query = query.eq("role_code", role);
    const { error } = await query;
    if (!error) return;
  }

  if (!dbPool) return;
  const params: unknown[] = [userId, purpose];
  let roleSql = "";
  if (role) {
    params.push(role);
    roleSql = " AND role_code = $3";
  }
  await dbPool.query(
    `UPDATE public.app_role_security_challenges
        SET invalidated_at = clock_timestamp()
      WHERE user_id = $1
        AND purpose = $2
        ${roleSql}
        AND consumed_at IS NULL
        AND invalidated_at IS NULL`,
    params,
  );
}

export async function issueRecoveryChallenge(
  userId: string,
  role: PortalRole,
  requestId: string,
) {
  await invalidateActive(userId, "password_recovery", role);
  const rawToken = generateFlowToken();
  const expiresAt = new Date(Date.now() + RECOVERY_TTL_MINUTES * 60_000);

  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("app_role_security_challenges")
      .insert({
        user_id: userId,
        role_code: role,
        purpose: "password_recovery",
        token_digest: digest(rawToken),
        expires_at: expiresAt.toISOString(),
        request_id: requestId,
      })
      .select("id")
      .single();
    if (!error && data)
      return { id: data.id as string, rawToken, expiresAt };
  }

  if (!dbPool) return null;
  const result = await dbPool.query<{ id: string }>(
    `INSERT INTO public.app_role_security_challenges
      (user_id, role_code, purpose, token_digest, expires_at, request_id)
     VALUES ($1,$2,'password_recovery',$3,$4,$5)
     RETURNING id`,
    [userId, role, digest(rawToken), expiresAt, requestId],
  );
  return { id: result.rows[0].id, rawToken, expiresAt };
}

export async function invalidateChallenge(id: string) {
  if (supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from("app_role_security_challenges")
      .update({ invalidated_at: new Date().toISOString() })
      .eq("id", id)
      .is("consumed_at", null)
      .is("invalidated_at", null);
    if (!error) return;
  }
  if (!dbPool) return;
  await dbPool.query(
    `UPDATE public.app_role_security_challenges
        SET invalidated_at = clock_timestamp()
      WHERE id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
    [id],
  );
}

export async function validateRecoveryChallenge(
  userId: string,
  role: PortalRole,
  rawToken: string,
) {
  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("app_role_security_challenges")
      .select("id,expires_at")
      .eq("user_id", userId)
      .eq("role_code", role)
      .eq("purpose", "password_recovery")
      .eq("token_digest", digest(rawToken))
      .is("consumed_at", null)
      .is("invalidated_at", null)
      .limit(1);
    if (!error)
      return Boolean(
        data?.some((row) => new Date(row.expires_at).getTime() > Date.now()),
      );
  }
  if (!dbPool) return false;
  const result = await dbPool.query(
    `SELECT 1
       FROM public.app_role_security_challenges
      WHERE user_id = $1
        AND role_code = $2
        AND purpose = 'password_recovery'
        AND token_digest = $3
        AND consumed_at IS NULL
        AND invalidated_at IS NULL
        AND expires_at > now()
      LIMIT 1`,
    [userId, role, digest(rawToken)],
  );
  return Boolean(result.rowCount);
}

export async function consumeRecoveryChallenge(
  userId: string,
  role: PortalRole,
  rawToken: string,
) {
  if (supabaseAdmin) {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("app_role_security_challenges")
      .update({ consumed_at: now })
      .eq("user_id", userId)
      .eq("role_code", role)
      .eq("purpose", "password_recovery")
      .eq("token_digest", digest(rawToken))
      .is("consumed_at", null)
      .is("invalidated_at", null)
      .gt("expires_at", now)
      .select("id");
    if (!error) return Boolean(data?.length);
  }
  if (!dbPool) return false;
  const result = await dbPool.query(
    `UPDATE public.app_role_security_challenges
        SET consumed_at = clock_timestamp()
      WHERE user_id = $1
        AND role_code = $2
        AND purpose = 'password_recovery'
        AND token_digest = $3
        AND consumed_at IS NULL
        AND invalidated_at IS NULL
        AND expires_at > now()`,
    [userId, role, digest(rawToken)],
  );
  return Boolean(result.rowCount);
}

export async function issueSecurityCodeChallenge(
  userId: string,
  role: PortalRole,
  requestId: string,
) {
  await invalidateActive(userId, "security_code");
  const expiresAt = new Date(Date.now() + SECURITY_CODE_TTL_MINUTES * 60_000);

  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("app_role_security_challenges")
      .insert({
        user_id: userId,
        role_code: role,
        purpose: "security_code",
        expires_at: expiresAt.toISOString(),
        request_id: requestId,
      })
      .select("id")
      .single();
    if (!error && data) return { id: data.id as string, expiresAt };
  }

  if (!dbPool) return null;
  const result = await dbPool.query<{ id: string }>(
    `INSERT INTO public.app_role_security_challenges
      (user_id, role_code, purpose, expires_at, request_id)
     VALUES ($1,$2,'security_code',$3,$4)
     RETURNING id`,
    [userId, role, expiresAt, requestId],
  );
  return { id: result.rows[0].id, expiresAt };
}

export async function validateSecurityCodeChallenge(
  challengeId: string,
  userId: string,
  role: PortalRole,
) {
  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("app_role_security_challenges")
      .select("id,expires_at,attempts_count,max_attempts")
      .eq("id", challengeId)
      .eq("user_id", userId)
      .eq("role_code", role)
      .eq("purpose", "security_code")
      .is("consumed_at", null)
      .is("invalidated_at", null)
      .limit(1);
    if (!error) {
      const row = data?.[0];
      return Boolean(
        row &&
          new Date(row.expires_at).getTime() > Date.now() &&
          Number(row.attempts_count) < Number(row.max_attempts),
      );
    }
  }

  if (!dbPool) return false;
  const result = await dbPool.query(
    `SELECT 1
       FROM public.app_role_security_challenges
      WHERE id = $1
        AND user_id = $2
        AND role_code = $3
        AND purpose = 'security_code'
        AND consumed_at IS NULL
        AND invalidated_at IS NULL
        AND expires_at > now()
        AND attempts_count < max_attempts
      LIMIT 1`,
    [challengeId, userId, role],
  );
  return Boolean(result.rowCount);
}

export async function recordSecurityCodeFailure(challengeId: string) {
  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("app_role_security_challenges")
      .select("attempts_count,max_attempts")
      .eq("id", challengeId)
      .maybeSingle();
    if (!error && data) {
      const attempts = Number(data.attempts_count) + 1;
      await supabaseAdmin
        .from("app_role_security_challenges")
        .update({
          attempts_count: attempts,
          ...(attempts >= Number(data.max_attempts)
            ? { invalidated_at: new Date().toISOString() }
            : {}),
        })
        .eq("id", challengeId);
      return;
    }
  }

  if (!dbPool) return;
  await dbPool.query(
    `UPDATE public.app_role_security_challenges
        SET attempts_count = attempts_count + 1,
            invalidated_at = CASE
              WHEN attempts_count + 1 >= max_attempts THEN clock_timestamp()
              ELSE invalidated_at
            END
      WHERE id = $1
        AND purpose = 'security_code'
        AND consumed_at IS NULL
        AND invalidated_at IS NULL`,
    [challengeId],
  );
}

export async function consumeSecurityCodeChallenge(challengeId: string) {
  if (supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from("app_role_security_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", challengeId)
      .eq("purpose", "security_code")
      .is("consumed_at", null)
      .is("invalidated_at", null);
    if (!error) return;
  }

  if (!dbPool) return;
  await dbPool.query(
    `UPDATE public.app_role_security_challenges
        SET consumed_at = clock_timestamp()
      WHERE id = $1
        AND purpose = 'security_code'
        AND consumed_at IS NULL
        AND invalidated_at IS NULL`,
    [challengeId],
  );
}
