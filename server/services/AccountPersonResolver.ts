import type { PoolClient } from "pg";

export type AccountRole =
  | "consumer"
  | "producer"
  | "platform_admin"
  | "platform_super_admin";

type Queryable = Pick<PoolClient, "query">;

export class AccountPersonResolutionError extends Error {
  constructor(
    public code: "PERSON_NOT_FOUND" = "PERSON_NOT_FOUND",
    public status = 404,
  ) {
    super(code);
    this.name = "AccountPersonResolutionError";
  }
}

function isAdministrativeRole(
  role: AccountRole,
): role is "platform_admin" | "platform_super_admin" {
  return role === "platform_admin" || role === "platform_super_admin";
}

/**
 * Resolve a sessão autenticada para a única pessoa física canônica.
 *
 * Ordem deliberada e fail-closed:
 * 1. identidade pública app_people.user_id;
 * 2. somente para papel administrativo da sessão, principal ativo e do mesmo
 *    portal_role -> app_admin_principals.person_id;
 * 3. nenhuma inferência por CPF/e-mail.
 *
 * current_person_id() permanece inalterada. Este helper é server-side e não
 * amplia RLS/Data API para credenciais administrativas.
 */
export async function resolveAccountPersonId(
  client: Queryable,
  userId: string,
  role: AccountRole,
  options: { lock?: boolean } = {},
): Promise<string> {
  const lock = options.lock ? " FOR UPDATE OF p" : "";

  const publicPerson = await client.query<{ id: string }>(
    `SELECT p.id
       FROM public.app_people p
      WHERE p.user_id=$1${lock}`,
    [userId],
  );
  if (publicPerson.rows[0]?.id) return publicPerson.rows[0].id;

  if (!isAdministrativeRole(role))
    throw new AccountPersonResolutionError();

  const administrativePerson = await client.query<{ id: string }>(
    `SELECT p.id
       FROM public.app_admin_principals ap
       JOIN public.app_users u
         ON u.id=ap.admin_user_id
        AND u.status='active'
       JOIN public.app_people p
         ON p.id=ap.person_id
       JOIN public.app_user_role_assignments r
         ON r.user_id=ap.admin_user_id
        AND r.role_code=ap.portal_role
        AND r.revoked_at IS NULL
        AND (r.expires_at IS NULL OR r.expires_at>now())
      WHERE ap.admin_user_id=$1
        AND ap.portal_role=$2${lock}
      LIMIT 1`,
    [userId, role],
  );

  if (!administrativePerson.rows[0]?.id)
    throw new AccountPersonResolutionError();

  return administrativePerson.rows[0].id;
}
