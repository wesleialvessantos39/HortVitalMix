import {
  effectiveAccountStatus,
  accountBlockCode,
} from "../../shared/accountBlock.ts";
import { dbPool } from "../db/pool.ts";
import { createSupabaseUserClient, supabaseAdmin } from "../supabase/client.ts";
import { resolveLiveAuthSession } from "../security/liveSession.ts";

export type IdentityAccessSnapshot = {
  status: string;
  blockCode?: string;
  block_starts_at?: string;
  block_ends_at?: string;
  roles: string[];
  personId: string | null;
  fullName: string | null;
  liveSession: boolean;
};

async function resolveViaDataApi(
  userId: string,
  accessToken?: string | null,
  sessionId?: string | null,
): Promise<IdentityAccessSnapshot | null> {
  const dataClient =
    supabaseAdmin ??
    (accessToken ? createSupabaseUserClient(accessToken) : null);
  if (!dataClient) return null;

  const [
    { data: user, error: userError },
    { data: roles, error: rolesError },
    principal,
    person,
  ] = await Promise.all([
    dataClient
      .from("app_users")
      .select("status,block_starts_at,block_ends_at")
      .eq("id", userId)
      .maybeSingle(),
    dataClient
      .from("app_user_role_assignments")
      .select("role_code,expires_at")
      .eq("user_id", userId)
      .is("revoked_at", null),
    dataClient
      .from("app_admin_principals")
      .select("person_id")
      .eq("admin_user_id", userId)
      .maybeSingle(),
    dataClient
      .from("app_people")
      .select("id,full_name")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (userError || rolesError || !user) return null;
  const session = sessionId
    ? await resolveLiveAuthSession(userId, sessionId, false)
    : null;
  if (session?.status === "unavailable") return null;

  const activeRoles = (roles ?? [])
    .filter(
      (row) =>
        !row.expires_at || new Date(row.expires_at).getTime() > Date.now(),
    )
    .map((row) => String(row.role_code));

  const personId = principal.data?.person_id ?? person.data?.id ?? null;

  return {
    status: effectiveAccountStatus(user),
    blockCode: accountBlockCode(user),
    roles: activeRoles,
    personId,
    fullName: person.data?.full_name ?? null,
    // Login recém-validado não tem sessionId nesta chamada; sessões existentes
    // mantêm o controle de validade mesmo sem conexão direta com o Pooler.
    liveSession: !sessionId || session?.status === "active",
  };
}

export async function resolveIdentityAccess(
  userId: string,
  sessionId: string | null = null,
  accessToken: string | null = null,
): Promise<IdentityAccessSnapshot | null> {
  // A fresh password grant has just been validated by Auth. Resolve its roles
  // through the Data API without first waiting for a cold/unreachable pooler.
  // Existing sessions still use the auth.sessions check below.
  if (!sessionId && accessToken) {
    const fresh = await resolveViaDataApi(userId, accessToken);
    if (fresh) return fresh;
  }
  if (dbPool) {
    try {
      const result = await dbPool.query<{
        status: string;
        person_id: string | null;
        full_name: string | null;
        live_session: boolean;
        roles: string[] | null;
      }>(
        `SELECT
           u.status,u.block_starts_at,u.block_ends_at,
           COALESCE(public_person.id, admin_person.id)::text AS person_id,
           COALESCE(public_person.full_name, admin_person.full_name) AS full_name,
           CASE
             WHEN $2::uuid IS NULL THEN true
             ELSE EXISTS (
               SELECT 1
                 FROM auth.sessions s
                WHERE s.id = $2::uuid
                  AND s.user_id = u.id
                  AND (s.not_after IS NULL OR s.not_after > now())
             )
           END AS live_session,
           COALESCE(
             array_agg(r.role_code ORDER BY r.role_code)
               FILTER (WHERE r.role_code IS NOT NULL),
             ARRAY[]::varchar[]
           ) AS roles
         FROM public.app_users u
         LEFT JOIN public.app_people public_person
           ON public_person.user_id = u.id
         LEFT JOIN public.app_admin_principals ap
           ON ap.admin_user_id = u.id
         LEFT JOIN public.app_people admin_person
           ON admin_person.id = ap.person_id
         LEFT JOIN public.app_user_role_assignments r
           ON r.user_id = u.id
          AND r.revoked_at IS NULL
          AND (r.expires_at IS NULL OR r.expires_at > now())
        WHERE u.id = $1
        GROUP BY
          u.id,
          u.status,
          public_person.id,
          admin_person.id`,
        [userId, sessionId],
      );

      const row = result.rows[0];
      if (row)
        return {
          status: effectiveAccountStatus(row),
          blockCode: accountBlockCode(row),
          roles: row.roles ?? [],
          personId: row.person_id ?? null,
          fullName: row.full_name ?? null,
          liveSession: row.live_session,
        };
    } catch {
      // Runtime serverless pode operar sem acesso ao Pooler. A autenticação
      // Supabase já foi verificada pelo middleware e a Data API mantém o
      // espelho de autorização como fallback canônico.
    }
  }

  return resolveViaDataApi(userId, accessToken, sessionId);
}
