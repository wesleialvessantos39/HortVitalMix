import { createHash, randomBytes } from "node:crypto";
import { dbPool } from "../db/pool.ts";
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

export async function findActiveIdentityForRole(
  email: string,
  role: PortalRole,
) {
  if (!dbPool) return null;
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
    [email.toLowerCase(), role],
  );
  return result.rows[0] ?? null;
}

async function invalidateActive(
  userId: string,
  purpose: ChallengePurpose,
  role?: PortalRole,
) {
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
  if (!dbPool) return null;
  await invalidateActive(userId, "password_recovery", role);
  const rawToken = generateFlowToken();
  const expiresAt = new Date(Date.now() + RECOVERY_TTL_MINUTES * 60_000);
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
  if (!dbPool) return null;

  // Um novo código de segurança invalida qualquer código anterior da mesma
  // identidade, inclusive de outro portal. Assim o código mais recente e o
  // contexto de papel formam um único desafio efetivo.
  await invalidateActive(userId, "security_code");

  const expiresAt = new Date(Date.now() + SECURITY_CODE_TTL_MINUTES * 60_000);
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
