-- Lifecycle: active entities are deleted; custody snapshots remain private and immutable.
CREATE TABLE public.app_property_deletion_archive (
 property_id uuid PRIMARY KEY, producer_id uuid NOT NULL,
 deleted_at timestamptz NOT NULL DEFAULT now(), evidence_ids uuid[] NOT NULL,
 snapshot jsonb NOT NULL
);
ALTER TABLE public.app_property_deletion_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_property_deletion_archive FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_property_deletion_archive FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.app_property_deletion_archive TO service_role;
CREATE TRIGGER deletion_archive_immutable BEFORE UPDATE OR DELETE ON public.app_property_deletion_archive
 FOR EACH ROW EXECUTE FUNCTION public.trg_fn_prevent_audit_tampering();
CREATE FUNCTION public.archive_property_before_delete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE v_snapshot jsonb; v_ids uuid[];
BEGIN
 v_snapshot:=jsonb_build_object('property',to_jsonb(OLD),
 'documents',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM app_documents d WHERE property_id=OLD.id),
 'extractions',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM app_document_extractions d WHERE property_id=OLD.id),
 'scans',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM app_document_scans s JOIN app_documents d ON d.id=s.document_id WHERE d.property_id=OLD.id),
 'validations',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM app_car_validations v WHERE property_id=OLD.id),
 'reviews',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM app_document_reviews v JOIN app_document_extractions e ON e.id=v.extraction_id WHERE e.property_id=OLD.id),
 'requests',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM app_verification_requests v WHERE property_id=OLD.id),
 'decisions',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM app_verification_decisions v JOIN app_verification_requests q ON q.id=v.request_id WHERE q.property_id=OLD.id));
 SELECT coalesce(array_agg((item->>'id')::uuid),'{}') INTO v_ids FROM jsonb_each(v_snapshot) s(key,value)
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(value)='array' THEN value ELSE '[]'::jsonb END) item WHERE item ? 'id';
 INSERT INTO app_property_deletion_archive(property_id,producer_id,evidence_ids,snapshot) VALUES(OLD.id,OLD.producer_id,v_ids,v_snapshot);
 INSERT INTO app_storage_deletion_queue(bucket,object_path,reason)
 SELECT storage_bucket,storage_path,'property_deleted' FROM app_documents WHERE property_id=OLD.id
 ON CONFLICT(bucket,object_path) DO UPDATE SET completed_at=NULL,last_error=NULL,requested_at=now();
 RETURN OLD;
END $$;
DROP TRIGGER trg_app_properties_delete_guard ON public.app_properties;
CREATE TRIGGER archive_property_delete BEFORE DELETE ON public.app_properties FOR EACH ROW EXECUTE FUNCTION public.archive_property_before_delete();
CREATE OR REPLACE FUNCTION public.protect_document_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND EXISTS(SELECT 1 FROM app_property_deletion_archive WHERE evidence_ids @> ARRAY[OLD.id]) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'DOCUMENT_EVIDENCE_IMMUTABLE';
END $$;
-- Only entity dependencies cascade; auditor identifiers remain historical UUIDs.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT oid,conrelid,conname,pg_get_constraintdef(oid) def FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace
 AND (confrelid IN ('public.app_properties'::regclass,'public.app_documents'::regclass,'public.app_document_extractions'::regclass)
 OR (conrelid='public.app_document_extractions'::regclass AND confrelid='public.app_producer_profiles'::regclass))
 LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.conrelid::regclass,c.conname);
 EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s ON DELETE CASCADE',c.conrelid::regclass,c.conname,regexp_replace(c.def,' ON DELETE (RESTRICT|CASCADE|SET NULL|NO ACTION)','')); END LOOP;
END $$;
CREATE FUNCTION public.protect_consent_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND NOT EXISTS(SELECT 1 FROM app_people WHERE id=OLD.person_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'CONSENT_IMMUTABLE';
END $$;
DROP TRIGGER trg_app_consent_records_immutable ON public.app_consent_records;
CREATE TRIGGER trg_app_consent_records_immutable BEFORE UPDATE OR DELETE ON public.app_consent_records FOR EACH ROW EXECUTE FUNCTION public.protect_consent_lifecycle();
CREATE FUNCTION public.delete_active_account(p_user_id uuid,p_actor_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE v_person uuid; v_public boolean;
BEGIN
 IF p_user_id=p_actor_id OR EXISTS(SELECT 1 FROM app_user_role_assignments WHERE user_id=p_user_id AND role_code='platform_super_admin' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'SUPER_ADMIN_PROTECTED'; END IF;
 PERFORM 1 FROM app_users WHERE id=p_user_id FOR UPDATE;
 SELECT p.id,p.user_id=p_user_id INTO v_person,v_public FROM app_people p LEFT JOIN app_admin_principals ap ON ap.person_id=p.id WHERE p.user_id=p_user_id OR ap.admin_user_id=p_user_id LIMIT 1;
 IF v_public THEN DELETE FROM app_producer_profiles WHERE person_id=v_person; END IF;
 DELETE FROM app_registration_reviews WHERE user_id=p_user_id;
 DELETE FROM auth.users WHERE id=p_user_id;
 DELETE FROM app_users WHERE id=p_user_id;
 IF v_person IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_people WHERE id=v_person AND user_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM app_admin_principals WHERE person_id=v_person) THEN DELETE FROM app_people WHERE id=v_person; END IF;
END $$;
REVOKE ALL ON FUNCTION public.delete_active_account(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_active_account(uuid,uuid) TO service_role;
ALTER TABLE public.app_people ADD COLUMN registration_review_pending boolean NOT NULL DEFAULT false;
DROP INDEX public.uq_people_current_cpf;
CREATE UNIQUE INDEX uq_people_current_cpf ON public.app_people(cpf_normalized) WHERE archived_at IS NULL AND NOT registration_review_pending;
CREATE FUNCTION public.registration_matches(p_cpf text,p_name text) RETURNS TABLE(user_id uuid,reason text) LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT d.user_id,CASE WHEN d.cpf_normalized=p_cpf THEN 'cpf' ELSE 'name' END FROM app_account_deletions d WHERE d.cpf_normalized=p_cpf OR d.name_key=governance_name_key(p_name)
 UNION SELECT u.id,CASE WHEN p.cpf_normalized=p_cpf THEN 'cpf' ELSE 'name' END FROM app_people p JOIN app_users u ON u.id=p.user_id
 WHERE p.archived_at IS NULL AND (u.status IN ('suspended','deleted') OR (u.status IN ('blocked','blocked_indefinite') AND (u.block_starts_at IS NULL OR u.block_starts_at<=now()) AND (u.block_ends_at IS NULL OR u.block_ends_at>now())))
 AND (p.cpf_normalized=p_cpf OR governance_name_key(p.full_name)=governance_name_key(p_name));
$$;
REVOKE ALL ON FUNCTION public.registration_matches(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.registration_matches(text,text) TO service_role;
CREATE FUNCTION public.prepare_registration_review() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF NEW.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM registration_matches(NEW.cpf_normalized,NEW.full_name) m WHERE m.user_id<>NEW.user_id) THEN NEW.registration_review_pending:=true; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prepare_people_review BEFORE INSERT ON public.app_people FOR EACH ROW EXECUTE FUNCTION public.prepare_registration_review();
CREATE OR REPLACE FUNCTION public.trg_registration_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE matches uuid[]; why text[];
BEGIN
 IF NEW.registration_review_pending THEN
 SELECT array_agg(DISTINCT m.user_id),array_agg(DISTINCT m.reason) INTO matches,why FROM registration_matches(NEW.cpf_normalized,NEW.full_name) m WHERE m.user_id<>NEW.user_id;
 UPDATE app_users SET status='pending',authorization_revision=authorization_revision+1 WHERE id=NEW.user_id;
 INSERT INTO app_registration_reviews(user_id,matched_user_ids,reasons) VALUES(NEW.user_id,matches,why);
 END IF; RETURN NEW;
END $$;
CREATE FUNCTION public.request_blocked_registration_review(p_user_id uuid,p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF p_role NOT IN ('consumer','producer') OR NOT EXISTS(SELECT 1 FROM app_users WHERE id=p_user_id AND status IN ('blocked','blocked_indefinite','suspended','pending')) OR EXISTS(SELECT 1 FROM app_admin_principals WHERE admin_user_id=p_user_id) THEN RAISE EXCEPTION 'REVIEW_NOT_ALLOWED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('hvm-account-blocks'));
 IF NOT EXISTS(SELECT 1 FROM app_registration_reviews WHERE user_id=p_user_id AND status='pending') THEN
 INSERT INTO app_registration_reviews(user_id,matched_user_ids,reasons,requested_role) VALUES(p_user_id,ARRAY[p_user_id],ARRAY['blocked_identity'],p_role); END IF;
END $$;
REVOKE ALL ON FUNCTION public.request_blocked_registration_review(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_blocked_registration_review(uuid,text) TO service_role;
-- Approved region eligibility is independent of a producer's global approval.
CREATE FUNCTION public.fn_publish_eligible_properties(p_user_id uuid,p_municipality_id uuid) RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT p.id FROM app_properties p JOIN app_producer_profiles pp ON pp.id=p.producer_id JOIN app_people pe ON pe.id=pp.person_id JOIN app_users u ON u.id=pe.user_id
 JOIN app_municipalities m ON m.state=p.state AND m.name_normalized=fn_locality_normalize(p.municipality)
 WHERE pe.user_id=p_user_id AND pe.archived_at IS NULL AND u.status='active' AND p.status='verified' AND m.id=p_municipality_id AND m.is_active
 AND NOT fn_is_publish_blocked(p_user_id,p_municipality_id)
 AND NOT EXISTS(SELECT 1 FROM app_access_partial_blocks b JOIN app_access_partial_block_properties bp ON bp.block_id=b.id WHERE b.user_id=p_user_id AND b.subject='producer_publishing' AND bp.property_id=p.id AND b.is_active AND b.revoked_at IS NULL);
$$;
REVOKE ALL ON FUNCTION public.fn_publish_eligible_properties(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_publish_eligible_properties(uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.fn_producer_delivers_to(p_producer_id uuid, p_municipality_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
  SELECT
    public.fn_locality_coverage_by_id(p_municipality_id) = 'active'
    AND (
      CASE coalesce((
        SELECT s.scope FROM public.app_producer_delivery_scopes s
         WHERE s.producer_id = p_producer_id
      ), 'property_municipality')
        WHEN 'all' THEN true
        WHEN 'custom' THEN EXISTS (
          SELECT 1 FROM public.app_producer_delivery_municipalities dm
           WHERE dm.producer_id = p_producer_id
             AND dm.municipality_id = p_municipality_id
        )
        ELSE EXISTS (
          SELECT 1
            FROM public.app_properties p
            JOIN public.app_municipalities m
              ON m.state = p.state
             AND m.name_normalized = public.fn_locality_normalize(p.municipality)
           WHERE p.producer_id = p_producer_id
             AND p.status = 'verified'
             AND m.id = p_municipality_id
        )
      END
    )
$$;

ALTER TABLE public.app_registration_reviews ADD COLUMN confirmation_sent_at timestamptz;
CREATE INDEX property_archive_evidence_ids ON public.app_property_deletion_archive USING gin(evidence_ids);
CREATE INDEX account_deletions_email ON public.app_account_deletions(email_normalized);
CREATE OR REPLACE FUNCTION public.complete_public_registration(
  p_user_id uuid,
  p_full_name text,
  p_cpf_normalized text,
  p_email_normalized text,
  p_phone_e164 text,
  p_role text,
  p_property_name text DEFAULT NULL::text,
  p_activity_type text DEFAULT NULL::text,
  p_municipality text DEFAULT NULL::text,
  p_state text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_person_id UUID;
  v_municipality_id UUID;
BEGIN
  IF p_role NOT IN ('consumer', 'producer') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PUBLIC_ROLE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.app_users
     WHERE id = p_user_id
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'APP_USER_NOT_READY';
  END IF;

  -- Trava de cobertura: consumidor e produtor só entram em município ativo.
  IF nullif(trim(coalesce(p_municipality, '')), '') IS NOT NULL THEN
    v_municipality_id := public.fn_assert_locality_covered(
      coalesce(nullif(trim(coalesce(p_state, '')), ''), 'RO'),
      p_municipality);
  END IF;

  INSERT INTO public.app_people(
    user_id,
    full_name,
    cpf_normalized,
    email_normalized,
    phone_e164,
    municipality_id
  )
  VALUES(
    p_user_id,
    trim(p_full_name),
    p_cpf_normalized,
    lower(trim(p_email_normalized)),
    p_phone_e164,
    v_municipality_id
  )
  RETURNING id INTO v_person_id;

  INSERT INTO public.app_user_role_assignments(user_id, role_code)
  VALUES(p_user_id, p_role);

  IF p_role='producer' THEN
    INSERT INTO public.app_producer_profiles(person_id,property_name,rural_activity_type,verification_status,trust_level) VALUES(v_person_id,NULL,NULL,'declared',0);
  END IF;
  RETURN v_person_id;
END;
$function$;

-- Auth deletion must also preserve an independent administrative principal's shared person.
CREATE OR REPLACE FUNCTION public.purge_account_domain(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_person uuid; v_public boolean;
BEGIN
 SELECT p.id,p.user_id=p_user_id INTO v_person,v_public FROM app_people p LEFT JOIN app_admin_principals ap ON ap.person_id=p.id WHERE p.user_id=p_user_id OR ap.admin_user_id=p_user_id LIMIT 1;
 IF v_public THEN DELETE FROM app_producer_profiles WHERE person_id=v_person; END IF;
 DELETE FROM app_admin_principals WHERE admin_user_id=p_user_id;
 DELETE FROM app_registration_reviews WHERE user_id=p_user_id;
 IF v_person IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_admin_principals WHERE person_id=v_person)
 AND NOT EXISTS(SELECT 1 FROM app_people WHERE id=v_person AND user_id IS NOT NULL AND user_id<>p_user_id) THEN DELETE FROM app_people WHERE id=v_person; END IF;
END $$;
REVOKE ALL ON FUNCTION public.purge_account_domain(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_account_domain(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_draft_property(p_property_id uuid,p_producer_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_count integer;
BEGIN
 DELETE FROM app_properties WHERE id=p_property_id AND producer_id=p_producer_id;
 GET DIAGNOSTICS v_count=ROW_COUNT;RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.purge_draft_property(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_draft_property(uuid,uuid) TO service_role;
