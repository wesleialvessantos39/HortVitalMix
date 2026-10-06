-- Auditoria 2026-10-06: remove privilégios destrutivos herdados sem alterar RLS
-- nem as allowlists de colunas usadas pelo titular autenticado.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.app_consent_records, public.app_user_preferences FROM anon;
REVOKE TRUNCATE
  ON public.app_consent_records, public.app_user_preferences FROM authenticated;

-- O Auth permanece responsável pela validação do JWT. Somente o backend pode
-- consultar a data/validade da sessão para autorização e reautenticação.
CREATE FUNCTION public.fn_live_auth_session(p_user_id uuid, p_session_id uuid)
RETURNS TABLE(created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT s.created_at
    FROM auth.sessions s
   WHERE s.id = p_session_id
     AND s.user_id = p_user_id
     AND (s.not_after IS NULL OR s.not_after > now())
$$;

REVOKE ALL ON FUNCTION public.fn_live_auth_session(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_live_auth_session(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.fn_live_auth_session(uuid, uuid) IS
  'Backend-only: sessão canônica viva e vinculada ao usuário validado pelo Auth.';
