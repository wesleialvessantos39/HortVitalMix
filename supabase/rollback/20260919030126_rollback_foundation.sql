-- HortiVitalMix v10 / Trilha 01.
-- USO EXCLUSIVO EM DEVELOPMENT. NUNCA aplicar em homologation/production.
DO $$
BEGIN
  IF current_setting('app.environment', true) NOT IN ('development', 'local') THEN
    RAISE EXCEPTION 'Rollback proibido fora de development.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_app_audit_events_immutable ON public.app_audit_events;
DROP TRIGGER IF EXISTS trg_app_audit_events_no_truncate ON public.app_audit_events;
DROP TRIGGER IF EXISTS trg_app_global_config_bump_revision ON public.app_global_config;
DROP TRIGGER IF EXISTS trg_app_users_bump_revision ON public.app_users;
DROP TRIGGER IF EXISTS trg_app_people_revision ON public.app_people;
DROP TRIGGER IF EXISTS trg_app_producer_profiles_revision ON public.app_producer_profiles;
DROP TRIGGER IF EXISTS trg_hortivital_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS trg_hortivital_auth_user_deleted ON auth.users;

DROP VIEW IF EXISTS public.v_rls_audit;

DROP TABLE IF EXISTS public.app_producer_profiles CASCADE;
DROP TABLE IF EXISTS public.app_user_role_assignments CASCADE;
DROP TABLE IF EXISTS public.app_roles CASCADE;
DROP TABLE IF EXISTS public.app_people CASCADE;
DROP TABLE IF EXISTS public.app_users CASCADE;
DROP TABLE IF EXISTS public.app_audit_events CASCADE;
DROP TABLE IF EXISTS public.app_global_config CASCADE;
DROP TABLE IF EXISTS public.app_releases CASCADE;

DROP FUNCTION IF EXISTS public.trg_fn_prevent_audit_tampering();
DROP FUNCTION IF EXISTS public.trg_fn_global_config_bump_revision();
DROP FUNCTION IF EXISTS public.trg_fn_auth_user_created();
DROP FUNCTION IF EXISTS public.trg_fn_auth_user_deleted();
DROP FUNCTION IF EXISTS public.trg_fn_app_users_bump_revision();
DROP FUNCTION IF EXISTS public.trg_fn_entity_revision();
DROP FUNCTION IF EXISTS public.has_role(TEXT);
DROP FUNCTION IF EXISTS public.is_platform_super_admin();
DROP FUNCTION IF EXISTS public.is_any_platform_admin();
DROP FUNCTION IF EXISTS public.current_person_id();
DROP FUNCTION IF EXISTS public.hash_ip(TEXT);
