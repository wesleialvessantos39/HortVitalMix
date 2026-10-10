-- Continuação aditiva, schema 69. Nenhum pagamento, exclusão de usuário ou envio externo.
SET lock_timeout='5s';
INSERT INTO public.app_admin_sectors(code,name,description) VALUES
 ('subscription_management','Assinaturas e planos','Planos por público, contratos, cancelamento e conexão com reembolsos'),
 ('review_management','Avaliações e reputação','Busca, moderação, restauração justificada e histórico de avaliações'),
 ('refund_policy','Política de reembolso','Políticas versionadas de compras e assinaturas, sem permissão para estornar')
ON CONFLICT(code) DO NOTHING;

-- Preserva a autoridade existente ao separar áreas anteriormente agrupadas.
INSERT INTO public.app_admin_sector_members(user_id,sector_code,assigned_by,assigned_at,authorization_version,expires_at,revoked_at,revoked_by,revoke_reason)
SELECT m.user_id,map.new,m.assigned_by,m.assigned_at,m.authorization_version,m.expires_at,m.revoked_at,m.revoked_by,m.revoke_reason
FROM public.app_admin_sector_members m JOIN (VALUES
 ('payment_configuration','subscription_management'),('complaint_management','review_management'),('refund_management','refund_policy')) map(old,new) ON m.sector_code=map.old
ON CONFLICT DO NOTHING;
INSERT INTO public.app_admin_permission_overrides(user_id,sector_code,allowed,changed_by,updated_at)
SELECT o.user_id,map.new,o.allowed,o.changed_by,o.updated_at FROM public.app_admin_permission_overrides o JOIN (VALUES
 ('payment_configuration','subscription_management'),('complaint_management','review_management'),('refund_management','refund_policy')) map(old,new) ON o.sector_code=map.old
ON CONFLICT DO NOTHING;

CREATE TABLE public.app_subscription_refund_policies(
 version integer PRIMARY KEY CHECK(version>0),policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),
 created_by uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((policy->>'withdrawalDays')::integer>=7 AND (policy->>'withdrawalDays')::integer<=60),
 CHECK((policy->>'version')::integer=version)
);
INSERT INTO public.app_subscription_refund_policies(version,policy) VALUES(1,
 '{"version":1,"withdrawalDays":7,"prorateUnused":false,"additionalTerms":"Cancelamento impede novos ciclos. Arrependimento em contratação a distância: sete dias quando aplicável (CDC, art. 49). Fora desse prazo, problemas de serviço e outros direitos legais são analisados; renovação de ciclo não reinicia automaticamente o prazo da contratação. Devolução depende de análise e confirmação do meio de pagamento."}');
ALTER TABLE public.app_subscriptions ADD COLUMN refund_policy_snapshot jsonb;

CREATE TABLE public.app_subscription_refunds(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),subscription_id uuid NOT NULL REFERENCES public.app_subscriptions(id) ON DELETE CASCADE,
 requester_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 plan_snapshot jsonb NOT NULL,policy_snapshot jsonb NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 2000),
 requested_amount_cents integer NOT NULL CHECK(requested_amount_cents>0),
 approved_amount_cents integer CHECK(approved_amount_cents>0 AND approved_amount_cents<=requested_amount_cents),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','under_review','approved','processing','refunded','rejected')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),gateway_refund_reference text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX subscription_refund_one_open ON public.app_subscription_refunds(subscription_id) WHERE status NOT IN ('rejected','refunded');
CREATE INDEX subscription_refund_requester ON public.app_subscription_refunds(requester_user_id,created_at DESC);
CREATE INDEX subscription_refund_state ON public.app_subscription_refunds(status,created_at DESC);
CREATE TABLE public.app_subscription_refund_items(
 refund_id uuid NOT NULL REFERENCES public.app_subscription_refunds(id) ON DELETE CASCADE,
 billing_cycle_id uuid NOT NULL REFERENCES public.app_billing_cycles(id) ON DELETE CASCADE,
 payment_intent_id uuid NOT NULL REFERENCES public.app_payment_intents(id) ON DELETE CASCADE,
 amount_cents integer NOT NULL CHECK(amount_cents>0),confirmed_amount_cents integer NOT NULL DEFAULT 0 CHECK(confirmed_amount_cents>=0 AND confirmed_amount_cents<=amount_cents),
 gateway_refund_reference text,PRIMARY KEY(refund_id,billing_cycle_id)
);
CREATE INDEX subscription_refund_items_payment ON public.app_subscription_refund_items(payment_intent_id);
CREATE TABLE public.app_subscription_refund_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),refund_id uuid NOT NULL REFERENCES public.app_subscription_refunds(id) ON DELETE CASCADE,
 actor_id uuid,action text NOT NULL,note text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX subscription_refund_history_case ON public.app_subscription_refund_history(refund_id,created_at);
CREATE TRIGGER subscription_refund_policy_immutable BEFORE UPDATE OR DELETE ON public.app_subscription_refund_policies FOR EACH ROW EXECUTE FUNCTION public.trg_fn_prevent_audit_tampering();

ALTER TABLE public.app_reviews ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
CREATE TABLE public.app_review_moderation_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),review_id uuid NOT NULL REFERENCES public.app_reviews(id) ON DELETE CASCADE,revision integer NOT NULL CHECK(revision>1),
 action text NOT NULL CHECK(action IN ('hide','restore')),reason text NOT NULL,actor_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX review_moderation_history_revision ON public.app_review_moderation_history(review_id,revision);
CREATE INDEX review_moderation_history_review ON public.app_review_moderation_history(review_id,created_at DESC);
CREATE INDEX reviews_admin_rating ON public.app_reviews(rating,created_at DESC);

DO $$ DECLARE rel text; BEGIN FOREACH rel IN ARRAY ARRAY['app_subscription_refund_policies','app_subscription_refunds','app_subscription_refund_items','app_subscription_refund_history','app_review_moderation_history'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',rel);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',rel);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',rel);
 END LOOP; END $$;
-- Histórico é anexado exclusivamente pelo backend; remoção somente com exclusão do caso.
CREATE FUNCTION hvm_subscription_private.protect_case_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND NOT EXISTS(SELECT 1 FROM public.app_subscription_refunds WHERE id=OLD.refund_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'HISTORY_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER subscription_refund_history_immutable BEFORE UPDATE OR DELETE ON public.app_subscription_refund_history FOR EACH ROW EXECUTE FUNCTION hvm_subscription_private.protect_case_history();
REVOKE ALL ON FUNCTION hvm_subscription_private.protect_case_history() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_subscription_private.protect_case_history() TO service_role;

-- Preserve immutable client content; moderation requires justified, authorized history.
CREATE OR REPLACE FUNCTION hvm_reviews_private.guard_review() RETURNS trigger
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
  IF (to_jsonb(NEW)-ARRAY['is_moderated','moderation_reason','moderated_by','moderated_at','updated_at','revision']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['is_moderated','moderation_reason','moderated_by','moderated_at','updated_at','revision']) THEN
   RAISE EXCEPTION 'REVIEW_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.is_moderated IS DISTINCT FROM OLD.is_moderated THEN
   IF NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM public.app_review_moderation_history h
    WHERE h.review_id=OLD.id AND h.revision=NEW.revision AND h.action=CASE WHEN NEW.is_moderated THEN 'hide' ELSE 'restore' END
    AND hvm_governance_private.has_permission(h.actor_id,'review_management')) THEN
    RAISE EXCEPTION 'REVIEW_MODERATION_HISTORY_REQUIRED' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.revision<>OLD.revision OR NEW.moderation_reason IS DISTINCT FROM OLD.moderation_reason OR NEW.moderated_at IS DISTINCT FROM OLD.moderated_at
   OR (NEW.moderated_by IS DISTINCT FROM OLD.moderated_by AND NEW.moderated_by IS NOT NULL) THEN
   RAISE EXCEPTION 'REVIEW_MODERATION_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  NEW.updated_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION hvm_reviews_private.guard_moderation_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND NOT EXISTS(SELECT 1 FROM public.app_reviews WHERE id=OLD.review_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'REVIEW_HISTORY_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER review_history_immutable BEFORE UPDATE OR DELETE ON public.app_review_moderation_history FOR EACH ROW EXECUTE FUNCTION hvm_reviews_private.guard_moderation_history();
REVOKE ALL ON FUNCTION hvm_reviews_private.guard_moderation_history() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_reviews_private.guard_moderation_history() TO service_role;
