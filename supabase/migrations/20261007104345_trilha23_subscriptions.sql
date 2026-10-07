-- T23, aditiva sobre T22/schema 60. Não ativa nem substitui o gateway T20.
SET lock_timeout='5s';
CREATE SCHEMA hvm_subscription_private;
REVOKE ALL ON SCHEMA hvm_subscription_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA hvm_subscription_private TO service_role;

CREATE TABLE public.app_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug varchar(64) NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 name varchar(128) NOT NULL CHECK(length(trim(name))>=2),
 target_audience varchar(32) NOT NULL CHECK(target_audience IN ('consumer','producer')),
 deliveries_per_week integer NOT NULL DEFAULT 1 CHECK(deliveries_per_week BETWEEN 0 AND 7),
 price_cents integer NOT NULL CHECK(price_cents>=0),
 billing_period varchar(32) NOT NULL DEFAULT 'monthly' CHECK(billing_period IN ('weekly','biweekly','monthly')),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 2 AND 2000),
 store_id uuid REFERENCES public.app_producer_stores(id) ON DELETE SET NULL,
 is_active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((target_audience='producer' AND deliveries_per_week=0 AND store_id IS NULL) OR (target_audience='consumer' AND deliveries_per_week BETWEEN 1 AND 7))
);
CREATE INDEX ix_plans_store ON public.app_plans(store_id) WHERE store_id IS NOT NULL;

CREATE TABLE public.app_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 -- Cascades preserve the homologated T06 hard-erasure flow.
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 person_id uuid NOT NULL REFERENCES public.app_people(id) ON DELETE CASCADE,
 plan_id uuid NOT NULL REFERENCES public.app_plans(id) ON DELETE RESTRICT,
 plan_snapshot jsonb NOT NULL CHECK(jsonb_typeof(plan_snapshot)='object'),
 producer_profile_id uuid REFERENCES public.app_producer_profiles(id) ON DELETE SET NULL,
 status varchar(32) NOT NULL DEFAULT 'active' CHECK(status IN ('trialing','active','paused','past_due','cancelled')),
 delivery_address_id uuid REFERENCES public.app_user_addresses(id) ON DELETE SET NULL,
 delivery_address_snapshot jsonb CHECK(jsonb_typeof(delivery_address_snapshot)='object'),
 current_period_start timestamptz NOT NULL,
 current_period_end timestamptz NOT NULL,
 cancelled_at timestamptz,
 paused_at timestamptz,
 pause_until timestamptz,
 last_cycle_index integer NOT NULL DEFAULT 0 CHECK(last_cycle_index>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(current_period_end>current_period_start),
 CHECK((paused_at IS NULL AND pause_until IS NULL) OR (paused_at IS NOT NULL AND pause_until=paused_at+interval '14 days')),
 CHECK((status='cancelled')=(cancelled_at IS NOT NULL))
);
CREATE INDEX ix_subscriptions_user ON public.app_subscriptions(user_id,created_at DESC);
CREATE INDEX ix_subscriptions_person ON public.app_subscriptions(person_id);
CREATE INDEX ix_subscriptions_plan ON public.app_subscriptions(plan_id);
CREATE INDEX ix_subscriptions_producer ON public.app_subscriptions(producer_profile_id) WHERE producer_profile_id IS NOT NULL;
CREATE INDEX ix_subscriptions_address ON public.app_subscriptions(delivery_address_id) WHERE delivery_address_id IS NOT NULL;
CREATE UNIQUE INDEX uq_subscription_live_plan ON public.app_subscriptions(user_id,plan_id) WHERE status<>'cancelled';

CREATE TABLE public.app_trial_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 producer_profile_id uuid UNIQUE REFERENCES public.app_producer_profiles(id) ON DELETE SET NULL,
 -- Stable, private anti-renewal key survives erasure/profile recreation; never raw CPF.
 identity_key char(64) NOT NULL UNIQUE CHECK(identity_key ~ '^[a-f0-9]{64}$'),
 starts_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ends_at timestamptz NOT NULL,
 policy_version varchar(32) NOT NULL DEFAULT 'trial_30d_v1' CHECK(policy_version='trial_30d_v1'),
 is_converted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(ends_at=starts_at+interval '30 days')
);
CREATE TABLE public.app_recurrence_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES public.app_subscriptions(id) ON DELETE CASCADE,
 day_of_week integer NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
 preferred_window_id uuid REFERENCES public.app_delivery_windows(id) ON DELETE SET NULL,
 window_snapshot jsonb NOT NULL CHECK(jsonb_typeof(window_snapshot)='object'),
 basket_template jsonb NOT NULL CHECK(jsonb_typeof(basket_template)='array' AND jsonb_array_length(basket_template) BETWEEN 1 AND 50),
 is_active boolean NOT NULL DEFAULT true,
 UNIQUE(subscription_id,day_of_week)
);
CREATE INDEX ix_recurrences_window ON public.app_recurrence_schedules(preferred_window_id) WHERE preferred_window_id IS NOT NULL;
CREATE TABLE public.app_billing_cycles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES public.app_subscriptions(id) ON DELETE CASCADE,
 cycle_index integer NOT NULL CHECK(cycle_index>0),
 amount_cents integer NOT NULL CHECK(amount_cents>=0),
 due_date date NOT NULL,
 period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL CHECK(period_end>period_start),
 status varchar(32) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed','refunded')),
 payment_intent_id uuid UNIQUE REFERENCES public.app_payment_intents(id) ON DELETE SET NULL,
 payment_creation_state varchar(16) NOT NULL DEFAULT 'waiting' CHECK(payment_creation_state IN ('waiting','requested','ready','uncertain')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT uq_subscription_cycle UNIQUE(subscription_id,cycle_index)
);
-- Explicit third source: previous quote/POS rules still apply exactly to their rows.
ALTER TABLE public.app_payment_intents ADD COLUMN billing_cycle_id uuid UNIQUE REFERENCES public.app_billing_cycles(id) ON DELETE CASCADE;
ALTER TABLE public.app_payment_intents DROP CONSTRAINT payment_intent_source;
ALTER TABLE public.app_payment_intents ADD CONSTRAINT payment_intent_source CHECK(num_nonnulls(quote_id,pos_sale_id,billing_cycle_id)=1);

ALTER TABLE public.app_plans ENABLE ROW LEVEL SECURITY; ALTER TABLE public.app_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_subscriptions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.app_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_trial_grants ENABLE ROW LEVEL SECURITY; ALTER TABLE public.app_trial_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_recurrence_schedules ENABLE ROW LEVEL SECURITY; ALTER TABLE public.app_recurrence_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_billing_cycles ENABLE ROW LEVEL SECURITY; ALTER TABLE public.app_billing_cycles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_plans,public.app_subscriptions,public.app_trial_grants,public.app_recurrence_schedules,public.app_billing_cycles FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.app_plans TO anon,authenticated;
GRANT SELECT ON public.app_subscriptions,public.app_trial_grants,public.app_recurrence_schedules,public.app_billing_cycles TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.app_plans,public.app_subscriptions,public.app_recurrence_schedules,public.app_billing_cycles TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.app_trial_grants TO service_role;
CREATE POLICY plans_public_read ON public.app_plans FOR SELECT TO anon,authenticated USING(is_active);
CREATE POLICY subscription_owner_read ON public.app_subscriptions FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY trial_owner_read ON public.app_trial_grants FOR SELECT TO authenticated USING(producer_profile_id IN (SELECT id FROM public.app_producer_profiles WHERE person_id=(SELECT public.current_person_id())));
CREATE POLICY recurrence_owner_read ON public.app_recurrence_schedules FOR SELECT TO authenticated USING(subscription_id IN (SELECT id FROM public.app_subscriptions WHERE user_id=(SELECT auth.uid())));
CREATE POLICY billing_owner_read ON public.app_billing_cycles FOR SELECT TO authenticated USING(subscription_id IN (SELECT id FROM public.app_subscriptions WHERE user_id=(SELECT auth.uid())));

CREATE FUNCTION hvm_subscription_private.trial_key(profile_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT encode(sha256(convert_to('hvm-producer-trial-v1:'||trim(p.cpf_normalized),'UTF8')),'hex')
 FROM public.app_producer_profiles pp JOIN public.app_people p ON p.id=pp.person_id WHERE pp.id=profile_id
$$;
CREATE FUNCTION hvm_subscription_private.grant_trial(profile_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE key text; started timestamptz:=clock_timestamp();
BEGIN
 key:=hvm_subscription_private.trial_key(profile_id);
 IF key IS NULL THEN RAISE EXCEPTION 'PRODUCER_REQUIRED' USING ERRCODE='23514'; END IF;
 INSERT INTO public.app_trial_grants(producer_profile_id,identity_key,starts_at,ends_at)
 VALUES(profile_id,key,started,started+interval '30 days') ON CONFLICT(identity_key) DO NOTHING;
 -- Rebind only an orphan after lawful erasure, retaining the original deadline.
 UPDATE public.app_trial_grants SET producer_profile_id=profile_id WHERE identity_key=key AND producer_profile_id IS NULL;
END $$;
CREATE FUNCTION hvm_subscription_private.profile_trial() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN PERFORM hvm_subscription_private.grant_trial(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER subscription_profile_trial AFTER INSERT ON public.app_producer_profiles FOR EACH ROW EXECUTE FUNCTION hvm_subscription_private.profile_trial();

CREATE FUNCTION hvm_subscription_private.guard_trial() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'TRIAL_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.producer_profile_id IS NOT NULL AND NEW.identity_key<>hvm_subscription_private.trial_key(NEW.producer_profile_id) THEN
  RAISE EXCEPTION 'TRIAL_IDENTITY_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.identity_key IS DISTINCT FROM OLD.identity_key OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at OR NEW.policy_version IS DISTINCT FROM OLD.policy_version OR NEW.created_at IS DISTINCT FROM OLD.created_at OR (OLD.is_converted AND NOT NEW.is_converted)) THEN
  RAISE EXCEPTION 'TRIAL_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subscription_trial_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.app_trial_grants FOR EACH ROW EXECUTE FUNCTION hvm_subscription_private.guard_trial();
CREATE FUNCTION hvm_subscription_private.guard_cycle() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.subscription_id IS DISTINCT FROM OLD.subscription_id OR NEW.cycle_index IS DISTINCT FROM OLD.cycle_index OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end OR (OLD.status='paid' AND NEW.status NOT IN ('paid','refunded')) THEN
  RAISE EXCEPTION 'BILLING_CYCLE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subscription_cycle_immutable BEFORE UPDATE ON public.app_billing_cycles FOR EACH ROW EXECUTE FUNCTION hvm_subscription_private.guard_cycle();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hvm_subscription_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hvm_subscription_private TO service_role;
-- Existing profiles receive their first grant on T23 launch; no old row is updated.
SELECT hvm_subscription_private.grant_trial(id) FROM public.app_producer_profiles;
COMMENT ON TABLE public.app_trial_grants IS 'Trial único de 30 dias. Registro antirrenovação privado preservado após exclusão; datas imutáveis.';
COMMENT ON TABLE public.app_plans IS 'Preços/nome/frequência definidos exclusivamente pelo operador; sem seeds comerciais inventados.';
