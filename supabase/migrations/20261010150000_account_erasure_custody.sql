-- Schema 70: exclusão consentida, custódia financeira mínima e arquivo sem reutilização.
SET lock_timeout='5s';
CREATE SCHEMA hvm_privacy_private;
REVOKE ALL ON SCHEMA hvm_privacy_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA hvm_privacy_private TO service_role;
-- Consent history stays immutable while its identity exists. Parent erasure
-- must be able to remove personal consent data, without weakening audit events.
CREATE FUNCTION hvm_privacy_private.guard_consent_erasure() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND NOT EXISTS(SELECT 1 FROM public.app_people WHERE id=OLD.person_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'VIOLACAO_DE_AUDITORIA: operação % bloqueada',TG_OP USING ERRCODE='42501';
END $$;
DROP TRIGGER trg_app_consent_records_immutable ON public.app_consent_records;
CREATE TRIGGER trg_app_consent_records_immutable BEFORE UPDATE OR DELETE ON public.app_consent_records FOR EACH ROW EXECUTE FUNCTION hvm_privacy_private.guard_consent_erasure();
REVOKE ALL ON FUNCTION hvm_privacy_private.guard_consent_erasure() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_privacy_private.guard_consent_erasure() TO service_role;
CREATE TABLE public.app_account_erasure_receipts(
 command_id uuid PRIMARY KEY,user_id uuid NOT NULL,role_code text NOT NULL CHECK(role_code IN ('consumer','producer')),
 status text NOT NULL CHECK(status IN ('processing','completed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz
);
CREATE INDEX account_erasure_receipts_user ON public.app_account_erasure_receipts(user_id);
CREATE TABLE public.app_erasure_evidence_ids(id uuid PRIMARY KEY,command_id uuid NOT NULL REFERENCES public.app_account_erasure_receipts(command_id) ON DELETE CASCADE);
ALTER TABLE public.app_erasure_evidence_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_erasure_evidence_ids FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_erasure_evidence_ids FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.app_erasure_evidence_ids TO service_role;
CREATE TABLE public.app_property_archive_deletions(
 command_id uuid PRIMARY KEY,property_id uuid NOT NULL,actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX property_archive_deletions_property ON public.app_property_archive_deletions(property_id);
DO $$ DECLARE rel text; BEGIN FOREACH rel IN ARRAY ARRAY['app_account_erasure_receipts','app_property_archive_deletions'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',rel);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',rel);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',rel);
 END LOOP; END $$;

CREATE FUNCTION hvm_privacy_private.erasing(uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_users u WHERE u.id=uid AND u.status='deleted');
$$;
REVOKE ALL ON FUNCTION hvm_privacy_private.erasing(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_privacy_private.erasing(uuid) TO service_role;

-- Identidade desaparece; obrigações, dinheiro confirmado e processos não somem
-- em cascata nem passam para outra conta. Todos continuam privados e sem titular.
ALTER TABLE public.app_payment_intents ADD COLUMN account_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.app_orders ADD COLUMN account_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.app_subscriptions ADD COLUMN account_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.app_payment_intents ALTER COLUMN command_id DROP NOT NULL;
ALTER TABLE public.app_payment_intents DROP CONSTRAINT app_payment_intents_command_id_fkey;
ALTER TABLE public.app_payment_intents ADD CONSTRAINT app_payment_intents_command_id_fkey FOREIGN KEY(command_id) REFERENCES public.app_command_receipts(command_id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.app_payment_intents DROP CONSTRAINT payment_intent_source;
ALTER TABLE public.app_payment_intents ADD CONSTRAINT payment_intent_source CHECK(num_nonnulls(quote_id,pos_sale_id,billing_cycle_id)=1 OR (account_deleted AND num_nonnulls(quote_id,pos_sale_id,billing_cycle_id)=0));
DO $$ DECLARE ref record; BEGIN
 FOR ref IN SELECT * FROM (VALUES
 ('app_payment_intents','user_id','app_users','id'),('app_orders','customer_user_id','app_users','id'),
 ('app_payment_policy_acceptances','user_id','app_users','id'),('app_refund_requests','requester_user_id','app_users','id'),
 ('app_subscriptions','user_id','app_users','id'),('app_subscriptions','person_id','app_people','id'),
 ('app_subscription_refunds','requester_user_id','app_users','id')) AS refs(tbl,col,parent,pk)
 LOOP
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL',ref.tbl,ref.col);
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',ref.tbl,ref.tbl||'_'||ref.col||'_fkey');
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(%I) REFERENCES public.%I(%I) ON DELETE SET NULL',ref.tbl,ref.tbl||'_'||ref.col||'_fkey',ref.col,ref.parent,ref.pk);
 END LOOP; END $$;
ALTER TABLE public.app_price_versions ALTER COLUMN created_by_user_id DROP NOT NULL;
ALTER TABLE public.app_price_versions DROP CONSTRAINT app_price_versions_created_by_user_id_fkey;
ALTER TABLE public.app_price_versions ADD CONSTRAINT app_price_versions_created_by_user_id_fkey FOREIGN KEY(created_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION hvm_product_private.guard_price_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.app_products WHERE id=OLD.product_id) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND NEW.created_by_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=OLD.created_by_user_id)
 AND (to_jsonb(NEW)-'created_by_user_id')=(to_jsonb(OLD)-'created_by_user_id') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'PRODUCT_PRICE_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE OR REPLACE FUNCTION hvm_commerce_private.freeze_order() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (hvm_privacy_private.erasing(OLD.customer_user_id) OR hvm_privacy_private.erasing(OLD.producer_user_id))
 AND NEW.account_deleted AND (to_jsonb(NEW)-ARRAY['account_deleted','address_snapshot','store_snapshot'])=(to_jsonb(OLD)-ARRAY['account_deleted','address_snapshot','store_snapshot'])
 AND (NEW.address_snapshot IS NULL OR NEW.address_snapshot=OLD.address_snapshot)
 AND (NEW.store_snapshot=OLD.store_snapshot OR NEW.store_snapshot='{"name":"Loja de conta excluída","slug":null}'::jsonb) THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','received_at','producer_user_id','store_id','customer_user_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','received_at','producer_user_id','store_id','customer_user_id'])
 OR (NEW.producer_user_id IS DISTINCT FROM OLD.producer_user_id AND NEW.producer_user_id IS NOT NULL)
 OR (NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id AND (NEW.customer_user_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.app_users WHERE id=OLD.customer_user_id)))
 OR (NEW.store_id IS DISTINCT FROM OLD.store_id AND NEW.store_id IS NOT NULL)
 OR (OLD.received_at IS NOT NULL AND NEW.received_at IS DISTINCT FROM OLD.received_at) THEN RAISE EXCEPTION 'ORDER_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION hvm_commerce_private.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND ((to_jsonb(OLD)->>'refund_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.app_refund_requests WHERE id=(to_jsonb(OLD)->>'refund_id')::uuid)
 OR (to_jsonb(OLD)->>'complaint_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.app_complaints WHERE id=(to_jsonb(OLD)->>'complaint_id')::uuid)
 OR (to_jsonb(OLD)->>'payment_intent_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.app_payment_intents WHERE id=(to_jsonb(OLD)->>'payment_intent_id')::uuid)
 OR (to_jsonb(OLD)->>'user_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=(to_jsonb(OLD)->>'user_id')::uuid)) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['author_user_id','actor_user_id','uploader_user_id'])=(to_jsonb(OLD)-ARRAY['author_user_id','actor_user_id','uploader_user_id'])
 AND coalesce(to_jsonb(NEW)->>'author_user_id',to_jsonb(NEW)->>'actor_user_id',to_jsonb(NEW)->>'uploader_user_id') IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND to_jsonb(NEW)->>'user_id' IS NULL AND NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=(to_jsonb(OLD)->>'user_id')::uuid)
 AND (to_jsonb(NEW)-'user_id')=(to_jsonb(OLD)-'user_id') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'COMMERCE_RECORD_IMMUTABLE' USING ERRCODE='23514';
END $$;

ALTER TABLE public.app_property_deletion_archive ADD COLUMN account_deleted boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.archive_property_before_delete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE v_snapshot jsonb;v_ids uuid[];v_deleted boolean;v_command uuid;
BEGIN
 SELECT coalesce(bool_or(u.status='deleted'),false) INTO v_deleted FROM app_producer_profiles pp JOIN app_people pe ON pe.id=pp.person_id JOIN app_users u ON u.id=pe.user_id WHERE pp.id=OLD.producer_id;
 SELECT e.command_id INTO v_command FROM app_account_erasure_receipts e JOIN app_people p ON p.user_id=e.user_id JOIN app_producer_profiles pp ON pp.person_id=p.id WHERE pp.id=OLD.producer_id AND e.status='processing' LIMIT 1;
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
 IF v_deleted AND v_command IS NOT NULL THEN
  INSERT INTO app_erasure_evidence_ids(id,command_id) SELECT unnest(v_ids),v_command ON CONFLICT DO NOTHING;
  IF OLD.status='verified' OR EXISTS(SELECT 1 FROM app_verification_requests WHERE property_id=OLD.id AND status='approved') THEN
   INSERT INTO app_property_deletion_archive(property_id,producer_id,evidence_ids,snapshot,account_deleted) VALUES(OLD.id,OLD.producer_id,'{}',jsonb_build_object('property',jsonb_build_object('id',OLD.id,'property_name',OLD.property_name,'municipality',OLD.municipality,'status','verified'),'accountDeleted',true),true);
  END IF;
 ELSE
  INSERT INTO app_property_deletion_archive(property_id,producer_id,evidence_ids,snapshot,account_deleted) VALUES(OLD.id,OLD.producer_id,v_ids,v_snapshot,v_deleted);
 END IF;
 INSERT INTO app_storage_deletion_queue(bucket,object_path,reason) SELECT storage_bucket,storage_path,'property_deleted' FROM app_documents WHERE property_id=OLD.id ON CONFLICT(bucket,object_path) DO UPDATE SET completed_at=NULL,last_error=NULL,requested_at=clock_timestamp();
 RETURN OLD;
END $$;
-- Cascade evidence deletion requires an existing custody marker for ordinary
-- property deletion, or a verified account-erasure state for self deletion.
CREATE OR REPLACE FUNCTION public.protect_document_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND (EXISTS(SELECT 1 FROM app_property_deletion_archive WHERE property_id=coalesce((to_jsonb(OLD)->>'property_id')::uuid,'00000000-0000-0000-0000-000000000000') OR evidence_ids @> ARRAY[OLD.id])
 OR EXISTS(SELECT 1 FROM app_erasure_evidence_ids m JOIN app_account_erasure_receipts e ON e.command_id=m.command_id WHERE m.id=OLD.id AND e.status='processing')) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'DOCUMENT_EVIDENCE_IMMUTABLE';
END $$;

CREATE OR REPLACE FUNCTION public.trg_fn_auth_user_deleted() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_person record;
BEGIN
 SELECT cpf_normalized,full_name,email_normalized INTO v_person FROM app_people WHERE user_id=OLD.id ORDER BY created_at LIMIT 1;
 IF v_person.cpf_normalized IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_account_erasure_receipts WHERE user_id=OLD.id AND status='processing') THEN
  INSERT INTO app_account_deletions(user_id,cpf_normalized,name_key,email_normalized,deleted_by) VALUES(OLD.id,v_person.cpf_normalized,governance_name_key(v_person.full_name),coalesce(v_person.email_normalized,lower(OLD.email)),OLD.id) ON CONFLICT DO NOTHING;
 END IF;
 IF EXISTS(SELECT 1 FROM app_people WHERE user_id=OLD.id) AND EXISTS(SELECT 1 FROM app_users WHERE id=OLD.id AND status<>'deleted') THEN PERFORM hvm_privacy_private.prepare_erasure(OLD.id); END IF;
 PERFORM purge_account_domain(OLD.id);
 DELETE FROM app_users WHERE id=OLD.id;
 RETURN OLD;
END $$;
CREATE FUNCTION hvm_privacy_private.prepare_erasure(p_user uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_person uuid;
BEGIN
 SELECT id INTO v_person FROM app_people WHERE user_id=p_user;
 UPDATE app_users SET status='deleted',authorization_revision=authorization_revision+1,block_starts_at=NULL,block_ends_at=NULL WHERE id=p_user;
 UPDATE app_orders SET account_deleted=true,address_snapshot=CASE WHEN customer_user_id=p_user THEN NULL ELSE address_snapshot END,
 store_snapshot=CASE WHEN producer_user_id=p_user THEN '{"name":"Loja de conta excluída","slug":null}'::jsonb ELSE store_snapshot END WHERE customer_user_id=p_user OR producer_user_id=p_user;
 UPDATE app_payment_intents SET account_deleted=true,quote_id=NULL,pix_copy_paste=NULL,pix_qr_code_base64=NULL WHERE user_id=p_user;
 DELETE FROM app_recurrence_schedules WHERE subscription_id IN (SELECT id FROM app_subscriptions WHERE user_id=p_user);
 UPDATE app_subscriptions SET account_deleted=true,status='cancelled',cancelled_at=coalesce(cancelled_at,clock_timestamp()),delivery_address_snapshot=NULL,revision=revision+1 WHERE user_id=p_user;
 DELETE FROM app_outbox_events WHERE recipient_user_id=p_user;
 DELETE FROM app_properties WHERE producer_id IN (SELECT id FROM app_producer_profiles WHERE person_id=v_person);
END $$;
REVOKE ALL ON FUNCTION hvm_privacy_private.prepare_erasure(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_privacy_private.prepare_erasure(uuid) TO service_role;
CREATE FUNCTION public.erase_public_account(p_user uuid,p_role text,p_command uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_person uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('hvm-account-blocks'));
 IF EXISTS(SELECT 1 FROM app_account_erasure_receipts WHERE command_id=p_command AND user_id=p_user AND status='completed') THEN RETURN; END IF;
 IF p_role NOT IN ('consumer','producer') OR EXISTS(SELECT 1 FROM app_admin_principals WHERE admin_user_id=p_user)
 OR NOT EXISTS(SELECT 1 FROM app_user_role_assignments WHERE user_id=p_user AND role_code=p_role AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp())) THEN RAISE EXCEPTION 'PUBLIC_ACCOUNT_REQUIRED' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM app_users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE='23514'; END IF;
 SELECT id INTO v_person FROM app_people WHERE user_id=p_user;
 INSERT INTO app_account_erasure_receipts(command_id,user_id,role_code,status) VALUES(p_command,p_user,p_role,'processing');
 PERFORM hvm_privacy_private.prepare_erasure(p_user);
 DELETE FROM auth.users WHERE id=p_user;
 DELETE FROM app_erasure_evidence_ids WHERE command_id=p_command;
 UPDATE app_account_erasure_receipts SET status='completed',completed_at=clock_timestamp() WHERE command_id=p_command;
END $$;
REVOKE ALL ON FUNCTION public.erase_public_account(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.erase_public_account(uuid,text,uuid) TO service_role;

CREATE FUNCTION hvm_privacy_private.archive_delete_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND (OLD.account_deleted OR NOT EXISTS(SELECT 1 FROM public.app_producer_profiles WHERE id=OLD.producer_id))
 AND EXISTS(SELECT 1 FROM public.app_property_archive_deletions d WHERE d.property_id=OLD.property_id AND hvm_governance_private.has_permission(d.actor_id,'document_verification')) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'DELETION_ARCHIVE_IMMUTABLE' USING ERRCODE='23514';
END $$;
DROP TRIGGER deletion_archive_immutable ON public.app_property_deletion_archive;
CREATE TRIGGER deletion_archive_immutable BEFORE UPDATE OR DELETE ON public.app_property_deletion_archive FOR EACH ROW EXECUTE FUNCTION hvm_privacy_private.archive_delete_guard();
GRANT DELETE ON public.app_property_deletion_archive TO service_role;
CREATE FUNCTION public.delete_deleted_account_archive(p_property uuid,p_actor uuid,p_command uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE row app_property_deletion_archive;
BEGIN
 IF NOT hvm_governance_private.has_permission(p_actor,'document_verification') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app_property_archive_deletions WHERE command_id=p_command AND property_id=p_property AND actor_id=p_actor) THEN RETURN; END IF;
 SELECT * INTO row FROM app_property_deletion_archive WHERE property_id=p_property FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ARCHIVE_NOT_FOUND' USING ERRCODE='23514'; END IF;
 IF NOT row.account_deleted AND EXISTS(SELECT 1 FROM app_producer_profiles WHERE id=row.producer_id) THEN RAISE EXCEPTION 'ACTIVE_ACCOUNT_ARCHIVE_PROTECTED' USING ERRCODE='23514'; END IF;
 INSERT INTO app_property_archive_deletions(command_id,property_id,actor_id) VALUES(p_command,p_property,p_actor);
 INSERT INTO app_storage_deletion_queue(bucket,object_path,reason) SELECT d->>'storage_bucket',d->>'storage_path','deleted_account_archive_removed' FROM jsonb_array_elements(coalesce(row.snapshot->'documents','[]')) d WHERE d->>'storage_bucket' IS NOT NULL AND d->>'storage_path' IS NOT NULL ON CONFLICT DO NOTHING;
 DELETE FROM app_property_deletion_archive WHERE property_id=p_property;
END $$;
REVOKE ALL ON FUNCTION public.delete_deleted_account_archive(uuid,uuid,uuid),hvm_privacy_private.archive_delete_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_deleted_account_archive(uuid,uuid,uuid),hvm_privacy_private.archive_delete_guard() TO service_role;

-- Keep governance deletion protections and use the same financial minimisation.
CREATE OR REPLACE FUNCTION public.delete_active_account(p_user_id uuid,p_actor_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE v_person uuid; v_public boolean;
BEGIN
 IF p_user_id=p_actor_id THEN RAISE EXCEPTION 'SUPER_ADMIN_PROTECTED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('hvm-account-blocks'));
 IF EXISTS(SELECT 1 FROM app_user_role_assignments WHERE user_id=p_user_id AND role_code='platform_super_admin' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())) AND (
 NOT hvm_governance_private.has_permission(p_actor_id,'account_governance') OR NOT EXISTS(SELECT 1 FROM app_admin_principals WHERE admin_user_id=p_actor_id AND portal_role='platform_super_admin') OR NOT EXISTS(
 SELECT 1 FROM app_admin_principals ap JOIN app_users u ON u.id=ap.admin_user_id JOIN app_user_role_assignments r ON r.user_id=u.id AND r.role_code='platform_super_admin'
 WHERE u.id<>p_user_id AND ap.portal_role='platform_super_admin' AND r.revoked_at IS NULL AND r.expires_at IS NULL AND u.status='active'
 AND hvm_governance_private.has_permission(u.id,'account_governance'))
 ) THEN RAISE EXCEPTION 'LAST_SUPER_ADMIN_PROTECTED'; END IF;
 PERFORM 1 FROM app_users WHERE id=p_user_id FOR UPDATE;
 SELECT p.id,p.user_id=p_user_id INTO v_person,v_public FROM app_people p LEFT JOIN app_admin_principals ap ON ap.person_id=p.id WHERE p.user_id=p_user_id OR ap.admin_user_id=p_user_id LIMIT 1;
 IF v_public THEN PERFORM hvm_privacy_private.prepare_erasure(p_user_id); DELETE FROM app_producer_profiles WHERE person_id=v_person; END IF;
 DELETE FROM app_registration_reviews WHERE user_id=p_user_id;
 DELETE FROM auth.users WHERE id=p_user_id;
 DELETE FROM app_users WHERE id=p_user_id;
 IF v_person IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_people WHERE id=v_person AND user_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM app_admin_principals WHERE person_id=v_person) THEN DELETE FROM app_people WHERE id=v_person; END IF;
END;
$$;
