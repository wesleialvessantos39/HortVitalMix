-- Bloqueio efetivo por intervalo; sem cron e sem alteração de credenciais Auth.
ALTER TABLE public.app_users ADD COLUMN block_starts_at timestamptz, ADD COLUMN block_ends_at timestamptz;
ALTER TABLE public.app_users ADD CONSTRAINT ck_block_interval CHECK (block_ends_at IS NULL OR (block_starts_at IS NOT NULL AND block_ends_at > block_starts_at));
CREATE FUNCTION public.effective_account_status(account_status text, starts_at timestamptz, ends_at timestamptz)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT CASE WHEN account_status='blocked' AND
 ((starts_at IS NOT NULL AND now()<starts_at) OR (ends_at IS NOT NULL AND now()>=ends_at))
 THEN 'active' ELSE account_status END;
$$;
-- Preserve existing RLS helper identities/privileges while using the effective clock.
DO $$ DECLARE f regprocedure; definition text; BEGIN
 FOREACH f IN ARRAY ARRAY['public.has_role(text)'::regprocedure,'public.has_role_for(uuid,text)'::regprocedure,'public.current_person_id()'::regprocedure,'public.fn_is_last_active_super_admin(uuid)'::regprocedure] LOOP
 definition:=pg_get_functiondef(f);
 definition:=replace(definition, 'u.status=''active''', 'public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)=''active''');
 EXECUTE definition;
 END LOOP;
END $$;

ALTER TABLE public.app_properties
 ADD COLUMN draft_data jsonb,
 ADD COLUMN completed_at timestamptz,
 ALTER COLUMN property_name DROP NOT NULL,
 ALTER COLUMN rural_zone_sector DROP NOT NULL,
 ALTER COLUMN line_vicinal DROP NOT NULL,
 ALTER COLUMN latitude_sede DROP NOT NULL,
 ALTER COLUMN longitude_sede DROP NOT NULL;
ALTER TABLE public.app_properties DROP CONSTRAINT app_properties_status_check;
ALTER TABLE public.app_properties ADD CONSTRAINT app_properties_status_check CHECK(status IN ('draft','completed','submitted','verified','rejected','suspended'));
ALTER TABLE public.app_properties DROP CONSTRAINT ck_app_properties_submission_complete;
ALTER TABLE public.app_properties ADD CONSTRAINT ck_app_properties_submission_complete CHECK(status='draft' OR
 (property_name IS NOT NULL AND rural_zone_sector IS NOT NULL AND line_vicinal IS NOT NULL AND latitude_sede IS NOT NULL AND longitude_sede IS NOT NULL AND total_area_hectares IS NOT NULL AND cultivated_area_hectares IS NOT NULL AND water_source IS NOT NULL AND irrigation_system IS NOT NULL AND wizard_current_step=5));
ALTER TABLE public.app_properties ADD CONSTRAINT ck_property_draft_data CHECK(draft_data IS NULL OR (jsonb_typeof(draft_data)='object' AND octet_length(draft_data::text)<=100000));
CREATE OR REPLACE FUNCTION public.trg_fn_t08_property_status_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.completed_at IS NOT NULL OR OLD.status<>'draft' THEN RAISE EXCEPTION 'COMPLETED_PROPERTY_DELETE_FORBIDDEN' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.completed_at IS NOT NULL THEN NEW.completed_at:=OLD.completed_at; END IF;
 IF NEW.status IN ('completed','submitted','verified','rejected','suspended') THEN NEW.completed_at:=COALESCE(NEW.completed_at,clock_timestamp()); END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
 (OLD.status='draft' AND NEW.status IN ('completed','submitted')) OR
 (OLD.status='completed' AND NEW.status IN ('draft','submitted')) OR
 (OLD.status='submitted' AND NEW.status IN ('draft','verified','rejected','suspended')) OR
 (OLD.status IN ('verified','rejected') AND NEW.status IN ('draft','suspended')) OR
 (OLD.status='suspended' AND NEW.status='draft')
 ) THEN RAISE EXCEPTION 'INVALID_PROPERTY_STATUS_TRANSITION' USING ERRCODE='23514'; END IF;
 IF OLD.status='verified' AND NEW.status='verified' AND
 (to_jsonb(NEW)-'revision'-'updated_at'-'completed_at') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'updated_at'-'completed_at') THEN
 RAISE EXCEPTION 'VERIFIED_PROPERTY_REHOMOLOGATION_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
UPDATE public.app_properties SET completed_at=updated_at WHERE status<>'draft';
CREATE TRIGGER trg_app_properties_delete_guard BEFORE DELETE ON public.app_properties FOR EACH ROW EXECUTE FUNCTION public.trg_fn_t08_property_status_guard();
