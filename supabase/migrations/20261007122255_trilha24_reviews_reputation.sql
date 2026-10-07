-- T24, aditiva sobre T23/schema 61. Não altera estados T20/T21/T22.
SET lock_timeout='5s';
CREATE SCHEMA hvm_reviews_private;
REVOKE ALL ON SCHEMA hvm_reviews_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA hvm_reviews_private TO service_role;

CREATE TABLE public.app_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 -- Cascades preserve the homologated T06 erasure of customers/orders/stores.
 order_id uuid NOT NULL UNIQUE REFERENCES public.app_orders(id) ON DELETE CASCADE,
 customer_person_id uuid NOT NULL REFERENCES public.app_people(id) ON DELETE CASCADE,
 store_id uuid NOT NULL REFERENCES public.app_producer_stores(id) ON DELETE CASCADE,
 rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment text CHECK(length(comment)<=1000),
 is_moderated boolean NOT NULL DEFAULT false,
 moderation_reason text CHECK(length(trim(moderation_reason)) BETWEEN 10 AND 500),
 moderated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 moderated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(is_moderated=(moderation_reason IS NOT NULL AND moderated_at IS NOT NULL)),
 CHECK(is_moderated OR (moderation_reason IS NULL AND moderated_by IS NULL AND moderated_at IS NULL))
);
CREATE INDEX ix_reviews_store ON public.app_reviews(store_id,created_at DESC,id DESC);
CREATE INDEX ix_reviews_customer ON public.app_reviews(customer_person_id);
CREATE INDEX ix_reviews_moderator ON public.app_reviews(moderated_by) WHERE moderated_by IS NOT NULL;

CREATE TABLE public.app_reputation_projections (
 store_id uuid PRIMARY KEY REFERENCES public.app_producer_stores(id) ON DELETE CASCADE,
 average_rating numeric(3,2) NOT NULL DEFAULT 0.00 CHECK(average_rating BETWEEN 0 AND 5),
 total_reviews integer NOT NULL DEFAULT 0 CHECK(total_reviews>=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((total_reviews=0)=(average_rating=0))
);
ALTER TABLE public.app_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_reputation_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_reputation_projections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_reviews,public.app_reputation_projections FROM PUBLIC,anon,authenticated,service_role;
-- Public reviews do not disclose order/customer/moderator IDs or private reasons.
GRANT SELECT(id,store_id,rating,comment,created_at) ON public.app_reviews TO anon,authenticated;
GRANT SELECT ON public.app_reputation_projections TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.app_reviews TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.app_reputation_projections TO service_role;
CREATE POLICY reviews_public_read ON public.app_reviews FOR SELECT TO anon,authenticated
 USING(NOT is_moderated AND hvm_store_private.store_is_visible(store_id));
CREATE POLICY reputation_public_read ON public.app_reputation_projections FOR SELECT TO anon,authenticated
 USING(hvm_store_private.store_is_visible(store_id));

CREATE FUNCTION hvm_reviews_private.guard_review() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  -- The logical delivered status is in the T21 fulfillment table, not T20 finance.
  IF NOT EXISTS(SELECT 1 FROM public.app_orders o
   JOIN public.app_order_fulfillment f ON f.order_id=o.id
   JOIN public.app_people p ON p.user_id=o.customer_user_id
   WHERE o.id=NEW.order_id AND f.status='delivered'
   AND o.store_id=NEW.store_id AND p.id=NEW.customer_person_id) THEN
   RAISE EXCEPTION 'REVIEW_VERIFIED_DELIVERY_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF NEW.is_moderated THEN RAISE EXCEPTION 'REVIEW_INITIAL_STATE_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['is_moderated','moderation_reason','moderated_by','moderated_at','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['is_moderated','moderation_reason','moderated_by','moderated_at','updated_at']) THEN
   RAISE EXCEPTION 'REVIEW_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.is_moderated AND (NOT NEW.is_moderated OR NEW.moderation_reason IS DISTINCT FROM OLD.moderation_reason OR NEW.moderated_at IS DISTINCT FROM OLD.moderated_at OR (NEW.moderated_by IS DISTINCT FROM OLD.moderated_by AND NEW.moderated_by IS NOT NULL)) THEN
   RAISE EXCEPTION 'REVIEW_MODERATION_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  NEW.updated_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_reviews_guard BEFORE INSERT OR UPDATE ON public.app_reviews
 FOR EACH ROW EXECUTE FUNCTION hvm_reviews_private.guard_review();

CREATE FUNCTION public.fn_refresh_store_reputation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE target uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.store_id ELSE NEW.store_id END;
BEGIN
 -- Serialize each store before taking a fresh aggregate snapshot (including deletes).
 PERFORM pg_advisory_xact_lock(24,hashtext(target::text));
 -- Parent cascades must not recreate projections for an erased store.
 IF EXISTS(SELECT 1 FROM public.app_producer_stores WHERE id=target) THEN
  INSERT INTO public.app_reputation_projections(store_id,average_rating,total_reviews,updated_at)
  SELECT target,coalesce(round(avg(rating)::numeric,2),0),count(*)::integer,clock_timestamp()
  FROM public.app_reviews WHERE store_id=target AND NOT is_moderated
  ON CONFLICT(store_id) DO UPDATE SET average_rating=excluded.average_rating,total_reviews=excluded.total_reviews,updated_at=excluded.updated_at;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_reviews_reputation AFTER INSERT OR UPDATE OR DELETE ON public.app_reviews
 FOR EACH ROW EXECUTE FUNCTION public.fn_refresh_store_reputation();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hvm_reviews_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hvm_reviews_private TO service_role;
REVOKE ALL ON FUNCTION public.fn_refresh_store_reputation() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_refresh_store_reputation() TO service_role;
COMMENT ON TABLE public.app_reviews IS 'T24: compra/entrega verificadas, conteúdo imutável, moderação sem exclusão; erasure T06 preservado.';
COMMENT ON TABLE public.app_reputation_projections IS 'T24: projeção nativa por trigger, inclusive zero avaliações; sem cron ou serviço pago.';
