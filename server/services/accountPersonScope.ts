// $1 is always the authenticated actor id, never a client-selected person id.
// Administrative credentials can belong to the same person as a public account.
export const ACCOUNT_PERSON_SCOPE = `id = COALESCE(
  (SELECT person_id FROM public.app_admin_principals WHERE admin_user_id=$1),
  (SELECT id FROM public.app_people WHERE user_id=$1)
)`;
