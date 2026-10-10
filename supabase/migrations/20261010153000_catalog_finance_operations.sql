-- Schema 71: moderação sem alteração de preço/estoque e conciliação sem caixa de terceiros.
SET lock_timeout='5s';
ALTER TABLE public.app_products ADD COLUMN admin_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE public.app_producer_stores ADD COLUMN admin_hidden boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION hvm_store_private.store_is_visible(p_store_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_producer_stores s WHERE s.id=p_store_id AND s.status='active' AND NOT s.admin_hidden AND hvm_store_private.property_is_eligible(s.producer_profile_id,s.property_id));
$$;
CREATE FUNCTION hvm_product_private.guard_admin_hold() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.admin_hidden AND NEW.is_published THEN RAISE EXCEPTION 'PRODUCT_ADMIN_HOLD' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_product_admin_hold BEFORE INSERT OR UPDATE ON public.app_products FOR EACH ROW EXECUTE FUNCTION hvm_product_private.guard_admin_hold();
REVOKE ALL ON FUNCTION hvm_product_private.guard_admin_hold() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_product_private.guard_admin_hold() TO service_role;
CREATE TABLE public.app_catalog_moderation_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),target_type text NOT NULL CHECK(target_type IN ('product','store')),
 target_id uuid NOT NULL,actor_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('hide','release')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 2000),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX catalog_moderation_history_target ON public.app_catalog_moderation_history(target_type,target_id,created_at DESC);
CREATE TABLE public.app_finance_cases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),target_type text NOT NULL CHECK(target_type IN ('pos','subscriptions','refunds','payments','orders')),
 target_id uuid NOT NULL,status text NOT NULL CHECK(status IN ('open','in_review','resolved')),
 note text NOT NULL CHECK(length(trim(note)) BETWEEN 10 AND 2000),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(target_type,target_id)
);
CREATE INDEX finance_cases_state ON public.app_finance_cases(status,updated_at DESC);
DO $$ DECLARE rel text; BEGIN FOREACH rel IN ARRAY ARRAY['app_catalog_moderation_history','app_finance_cases'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',rel);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',rel);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',rel);
 END LOOP; END $$;
CREATE TRIGGER catalog_moderation_immutable BEFORE UPDATE OR DELETE ON public.app_catalog_moderation_history FOR EACH ROW EXECUTE FUNCTION public.trg_fn_prevent_audit_tampering();
