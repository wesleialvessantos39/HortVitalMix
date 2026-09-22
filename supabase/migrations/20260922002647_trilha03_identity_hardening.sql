-- HortiVitalMix — Volume 01 / Trilha 03 — identidade canônica e portais separados.
-- Migration aditiva equivalente ao hardening 0010 do Manual Mestre Técnico v10.
-- Não cria tabela nova e preserva integralmente os avanços das Trilhas 01 e 02.

CREATE OR REPLACE FUNCTION public.fn_assert_public_role(role_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF role_code IS NULL OR role_code NOT IN ('consumer', 'producer') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PUBLIC_ROLE_NOT_ALLOWED';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_assert_public_role(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_assert_public_role(text) TO service_role;

CREATE INDEX IF NOT EXISTS ix_app_people_email_login
  ON public.app_people(email_normalized)
  WHERE email_normalized IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_check_auth_people_consistency()
RETURNS TABLE (app_user_id uuid, auth_email text, app_email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.user_id, lower(trim(u.email)), p.email_normalized::text
  FROM public.app_people p
  JOIN auth.users u ON u.id = p.user_id
  WHERE u.email IS NOT NULL
    AND lower(trim(u.email)) IS DISTINCT FROM p.email_normalized::text;
$$;
REVOKE ALL ON FUNCTION public.fn_check_auth_people_consistency() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_auth_people_consistency() TO service_role;

CREATE OR REPLACE FUNCTION public.trg_fn_auth_user_email_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    UPDATE public.app_people
       SET email_normalized = lower(trim(NEW.email)),
           updated_at = clock_timestamp(),
           revision = revision + 1
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hortivital_auth_user_email_changed ON auth.users;
CREATE TRIGGER trg_hortivital_auth_user_email_changed
AFTER UPDATE OF email ON auth.users
FOR EACH ROW
WHEN (OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION public.trg_fn_auth_user_email_changed();

COMMENT ON FUNCTION public.fn_assert_public_role(text) IS 'Trilha 03: somente consumer/producer no cadastro público.';
COMMENT ON FUNCTION public.fn_check_auth_people_consistency() IS 'Trilha 03: diagnostica divergências auth.users x app_people.';
COMMENT ON FUNCTION public.trg_fn_auth_user_email_changed() IS 'Trilha 03: sincroniza e-mail canônico após alteração no Supabase Auth.';
