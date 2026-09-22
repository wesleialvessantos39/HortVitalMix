import { dbPool } from "../db/pool.ts";

export type IdentityAccessSnapshot = {
  status: string;
  roles: string[];
  personId: string | null;
  liveSession: boolean;
};

export async function resolveIdentityAccess(
  userId: string,
  sessionId: string | null = null,
): Promise<IdentityAccessSnapshot | null> {
  if (!dbPool) return null;

  const result = await dbPool.query<{
    status: string;
    person_id: string | null;
    live_session: boolean;
    roles: string[] | null;
  }>(
    `SELECT
       u.status,
       p.id::text AS person_id,
       CASE
         WHEN $2::uuid IS NULL THEN true
         ELSE EXISTS (
           SELECT 1
             FROM auth.sessions s
            WHERE s.id = $2::uuid
              AND s.user_id = u.id
         )
       END AS live_session,
       COALESCE(
         array_agg(r.role_code ORDER BY r.role_code)
           FILTER (WHERE r.role_code IS NOT NULL),
         ARRAY[]::varchar[]
       ) AS roles
     FROM public.app_users u
     LEFT JOIN public.app_people p
       ON p.user_id = u.id
     LEFT JOIN public.app_user_role_assignments r
       ON r.user_id = u.id
      AND r.revoked_at IS NULL
      AND (r.expires_at IS NULL OR r.expires_at > now())
    WHERE u.id = $1
    GROUP BY u.status, p.id`,
    [userId, sessionId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    status: row.status,
    roles: row.roles ?? [],
    personId: row.person_id ?? null,
    liveSession: row.live_session,
  };
}
