-- T12 additive to logical schema 46. Drafts may precede an approved property.
-- Nullable property/SET NULL and profile/CASCADE preserve the v46 deletion flow.
CREATE TABLE public.app_producer_stores (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 producer_profile_id uuid NOT NULL UNIQUE REFERENCES public.app_producer_profiles(id) ON DELETE CASCADE,
 property_id uuid REFERENCES public.app_properties(id) ON DELETE SET NULL,
 store_slug varchar(128) NOT NULL CHECK (store_slug ~ '^[a-z0-9][a-z0-9-]{1,126}[a-z0-9]$'),
 store_name varchar(128) NOT NULL CHECK (length(trim(store_name)) >= 2),
 bio_clean text NOT NULL DEFAULT '' CHECK (length(bio_clean) <= 2000),
 logo_url varchar(512), banner_url varchar(512),
 min_order_amount_cents integer NOT NULL DEFAULT 2000 CHECK (min_order_amount_cents BETWEEN 0 AND 100000000),
 cutoff_hour time NOT NULL DEFAULT '14:00',
 status varchar(32) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','active','paused','closed')),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT store_active_settings CHECK (status <> 'active' OR (property_id IS NOT NULL AND length(trim(bio_clean)) >= 10))
);
CREATE UNIQUE INDEX uq_app_producer_stores_slug_active ON public.app_producer_stores(store_slug) WHERE status <> 'closed';
CREATE INDEX ix_app_producer_stores_property ON public.app_producer_stores(property_id) WHERE property_id IS NOT NULL;
COMMENT ON TABLE public.app_producer_stores IS 'T12: vitrine comercial; 1 por produtor, mutações somente backend; exclusão de conta preserva hard delete v46.';
COMMENT ON COLUMN public.app_producer_stores.property_id IS 'Vínculo privado do imóvel titular; remoção/retirada pausa a vitrine. Nunca exposto na resposta pública.';
COMMENT ON COLUMN public.app_producer_stores.bio_clean IS 'Texto sanitizado pelo backend, renderizado sem HTML; rascunho pode estar vazio, publicação exige 10 caracteres.';

CREATE TABLE public.app_store_operating_hours (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES public.app_producer_stores(id) ON DELETE CASCADE,
 day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
 is_harvest_day boolean NOT NULL DEFAULT true,
 is_delivery_day boolean NOT NULL DEFAULT true,
 cutoff_time time NOT NULL DEFAULT '14:00',
 CONSTRAINT uq_store_day UNIQUE (store_id,day_of_week)
);
COMMENT ON TABLE public.app_store_operating_hours IS 'T12: sete dias operacionais da loja, horário local America/Porto_Velho; upsert atômico pelo backend.';
ALTER TABLE public.app_producer_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_producer_stores FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_store_operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_store_operating_hours FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_producer_stores,public.app_store_operating_hours FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.app_producer_stores,public.app_store_operating_hours TO anon,authenticated;
GRANT ALL ON public.app_producer_stores,public.app_store_operating_hours TO service_role;

-- These boolean predicates require private verification/account tables. They
-- live outside the exposed schema, pin search_path and return no personal data.
CREATE SCHEMA hvm_store_private;
REVOKE ALL ON SCHEMA hvm_store_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA hvm_store_private TO anon,authenticated,service_role;
CREATE FUNCTION hvm_store_private.property_is_eligible(p_profile_id uuid,p_property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.app_producer_profiles pp
  JOIN public.app_people pe ON pe.id=pp.person_id
  JOIN public.app_users u ON u.id=pe.user_id
  JOIN public.app_properties p ON p.producer_id=pp.id AND p.id=p_property_id
  JOIN public.app_property_current_verification v ON v.property_id=p.id
  JOIN public.app_municipalities m ON m.state=p.state AND m.name_normalized=public.fn_locality_normalize(p.municipality)
  WHERE pp.id=p_profile_id AND pp.verification_status='verified' AND pp.trust_level>=2
   AND pe.archived_at IS NULL
   AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
   AND p.status='verified' AND v.review_decision='approved' AND m.is_active
   AND p.id IN (SELECT public.fn_publish_eligible_properties(pe.user_id,m.id))
   AND public.fn_producer_delivers_to(pp.id,m.id) IS DISTINCT FROM false
 );
$$;
REVOKE ALL ON FUNCTION hvm_store_private.property_is_eligible(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_store_private.property_is_eligible(uuid,uuid) TO service_role;
CREATE FUNCTION hvm_store_private.store_is_visible(p_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 -- Deliberately callable by anon: this is the public showcase predicate. Unlike
 -- an owner predicate it permits an absent auth.uid(), but ONLY for active,
 -- eligible stores, returning false for every hidden/nonexistent store.
 SELECT EXISTS (SELECT 1 FROM public.app_producer_stores s WHERE s.id=p_store_id
  AND s.status='active' AND hvm_store_private.property_is_eligible(s.producer_profile_id,s.property_id));
$$;
REVOKE ALL ON FUNCTION hvm_store_private.store_is_visible(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_store_private.store_is_visible(uuid) TO anon,authenticated,service_role;
CREATE POLICY store_public_read ON public.app_producer_stores FOR SELECT TO anon,authenticated
 USING (status='active' AND hvm_store_private.store_is_visible(id));
CREATE POLICY store_owner_read ON public.app_producer_stores FOR SELECT TO authenticated
 USING (producer_profile_id IN (SELECT id FROM public.app_producer_profiles WHERE person_id=(SELECT public.current_person_id())));
CREATE POLICY hours_public_read ON public.app_store_operating_hours FOR SELECT TO anon,authenticated
 USING (hvm_store_private.store_is_visible(store_id));
CREATE POLICY hours_owner_read ON public.app_store_operating_hours FOR SELECT TO authenticated
 USING (store_id IN (SELECT id FROM public.app_producer_stores WHERE producer_profile_id IN
  (SELECT id FROM public.app_producer_profiles WHERE person_id=(SELECT public.current_person_id()))));

-- Invoker trigger: the existing privileged property deletion/withdrawal owns
-- this change. No previous function, trigger or policy is replaced.
CREATE FUNCTION hvm_store_private.pause_property_store() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_store record;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.status='verified' OR OLD.status=NEW.status) THEN RETURN NEW; END IF;
 FOR v_store IN
  UPDATE public.app_producer_stores SET
   status=CASE WHEN status='active' THEN 'paused' ELSE status END,
   property_id=CASE WHEN TG_OP='DELETE' THEN NULL ELSE property_id END,
   revision=revision+1,updated_at=clock_timestamp()
  WHERE property_id=OLD.id RETURNING id,status,revision
 LOOP
  INSERT INTO public.app_audit_events(request_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash)
  VALUES(gen_random_uuid(),'system','store.property_unavailable','app_producer_stores',v_store.id,
   jsonb_build_object('status',v_store.status,'revision',v_store.revision,'cause',lower(TG_OP)),repeat('0',64));
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION hvm_store_private.pause_property_store() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_store_private.pause_property_store() TO service_role;
CREATE TRIGGER trg_t12_store_property_delete BEFORE DELETE ON public.app_properties
 FOR EACH ROW EXECUTE FUNCTION hvm_store_private.pause_property_store();
CREATE TRIGGER trg_t12_store_property_status AFTER UPDATE OF status ON public.app_properties
 FOR EACH ROW EXECUTE FUNCTION hvm_store_private.pause_property_store();
