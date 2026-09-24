-- Trilha 04/05 — revogação de sessões após recuperação sem depender do Pooler.
CREATE OR REPLACE FUNCTION public.fn_revoke_auth_sessions(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth, public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  DELETE FROM auth.sessions
   WHERE user_id = p_user_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_revoke_auth_sessions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_revoke_auth_sessions(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_revoke_auth_sessions(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_revoke_auth_sessions(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_revoke_auth_sessions(uuid) IS
'Revoga todas as sessões GoTrue do usuário após redefinição de senha. Restrita ao service_role.';
