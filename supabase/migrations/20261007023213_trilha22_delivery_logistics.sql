-- T22 aditiva: capacidade por janela/data e prova formal atômica com T21.
SET lock_timeout = '5s';
CREATE SCHEMA hvm_logistics_private;
REVOKE ALL ON SCHEMA hvm_logistics_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA hvm_logistics_private TO service_role;
CREATE TABLE public.app_delivery_windows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES public.app_producer_stores(id) ON DELETE CASCADE,
 day_of_week integer NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
 start_time time NOT NULL, end_time time NOT NULL CHECK(end_time>start_time),
 max_orders_capacity integer NOT NULL DEFAULT 15 CHECK(max_orders_capacity>0),
 is_active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(store_id,day_of_week,start_time,end_time)
);
CREATE TABLE public.app_delivery_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 -- Snapshot mantém rastreabilidade sem impedir exclusão de loja/conta homologada.
 window_id uuid REFERENCES public.app_delivery_windows(id) ON DELETE SET NULL,
 scheduled_date date NOT NULL, order_id uuid NOT NULL UNIQUE REFERENCES public.app_orders(id) ON DELETE CASCADE,
 window_snapshot jsonb NOT NULL, allocated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_delivery_allocations_capacity ON public.app_delivery_allocations(window_id,scheduled_date);
CREATE TABLE public.app_delivery_proofs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES public.app_orders(id) ON DELETE CASCADE,
 received_by_name varchar(128) NOT NULL CHECK(length(btrim(received_by_name)) BETWEEN 2 AND 128),
 receiver_document_masked varchar(32) CHECK(receiver_document_masked ~ '^\*\*\*\.\*\*\*\.[0-9]{3}-\*\*$'),
 notes text CHECK(length(notes)<=500), delivery_latitude numeric(10,8) CHECK(delivery_latitude BETWEEN -90 AND 90),
 delivery_longitude numeric(11,8) CHECK(delivery_longitude BETWEEN -180 AND 180),
 recorded_by_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 delivered_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK((delivery_latitude IS NULL)=(delivery_longitude IS NULL))
);
CREATE INDEX ix_delivery_proofs_actor ON public.app_delivery_proofs(recorded_by_user_id) WHERE recorded_by_user_id IS NOT NULL;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['app_delivery_windows','app_delivery_allocations','app_delivery_proofs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
END $$;
CREATE POLICY delivery_windows_owner_read ON public.app_delivery_windows FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.app_producer_stores s JOIN public.app_producer_profiles p ON p.id=s.producer_profile_id
 WHERE s.id=store_id AND p.person_id=public.current_person_id()));
CREATE POLICY delivery_allocations_participant_read ON public.app_delivery_allocations FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.app_orders o WHERE o.id=order_id AND (o.customer_user_id=(SELECT auth.uid()) OR o.producer_user_id=(SELECT auth.uid()))));
-- Prova contém dados pessoais: leitura direta somente pelo comprador titular.
CREATE POLICY delivery_proofs_customer_read ON public.app_delivery_proofs FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.app_orders o WHERE o.id=order_id AND o.customer_user_id=(SELECT auth.uid())));

CREATE FUNCTION hvm_logistics_private.guard_window() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE today date; BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM public.app_producer_stores WHERE id=OLD.store_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'WINDOW_DEACTIVATE_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF NEW.store_id<>OLD.store_id OR NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='23514'; END IF;
 SELECT (clock_timestamp() AT TIME ZONE timezone)::date INTO today FROM public.app_global_config WHERE singleton_guard;
 today:=coalesce(today,(clock_timestamp() AT TIME ZONE 'America/Porto_Velho')::date);
 IF (NEW.day_of_week,NEW.start_time,NEW.end_time) IS DISTINCT FROM (OLD.day_of_week,OLD.start_time,OLD.end_time)
 AND EXISTS(SELECT 1 FROM public.app_delivery_allocations WHERE window_id=OLD.id AND scheduled_date>=today) THEN
  RAISE EXCEPTION 'WINDOW_HAS_ALLOCATIONS' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.app_delivery_allocations WHERE window_id=OLD.id AND scheduled_date>=today
 GROUP BY scheduled_date HAVING count(*)>NEW.max_orders_capacity) THEN
  RAISE EXCEPTION 'CAPACITY_BELOW_ALLOCATIONS' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER t22_window_guard BEFORE UPDATE OR DELETE ON public.app_delivery_windows FOR EACH ROW EXECUTE FUNCTION hvm_logistics_private.guard_window();
CREATE FUNCTION hvm_logistics_private.guard_allocation() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.app_orders; f public.app_order_fulfillment; w public.app_delivery_windows; tz text; local_now timestamp;
BEGIN
 SELECT * INTO o FROM public.app_orders WHERE id=NEW.order_id FOR UPDATE;
 SELECT * INTO f FROM public.app_order_fulfillment WHERE order_id=NEW.order_id FOR UPDATE;
 IF f.status IS DISTINCT FROM 'ready_for_dispatch' OR o.status='refunded' THEN RAISE EXCEPTION 'ORDER_NOT_READY' USING ERRCODE='23514'; END IF;
 -- Lock da linha pai serializa todas as inserções, inclusive datas diferentes.
 SELECT * INTO w FROM public.app_delivery_windows WHERE id=NEW.window_id FOR UPDATE;
 IF NOT FOUND OR NOT w.is_active OR w.store_id IS DISTINCT FROM o.store_id THEN RAISE EXCEPTION 'WINDOW_UNAVAILABLE' USING ERRCODE='23514'; END IF;
 SELECT coalesce(timezone,'America/Porto_Velho') INTO tz FROM public.app_global_config WHERE singleton_guard;
 tz:=coalesce(tz,'America/Porto_Velho'); local_now:=clock_timestamp() AT TIME ZONE tz;
 IF NEW.scheduled_date<local_now::date OR extract(dow FROM NEW.scheduled_date)::integer<>w.day_of_week
 OR (NEW.scheduled_date=local_now::date AND w.end_time<=local_now::time) THEN
  RAISE EXCEPTION 'INVALID_DELIVERY_DATE' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM public.app_delivery_allocations WHERE window_id=w.id AND scheduled_date=NEW.scheduled_date)>=w.max_orders_capacity THEN
  RAISE EXCEPTION 'CAPACITY_EXCEEDED' USING ERRCODE='23514'; END IF;
 NEW.window_snapshot:=jsonb_build_object('startTime',to_char(w.start_time,'HH24:MI'),'endTime',to_char(w.end_time,'HH24:MI'),'timezone',tz);
 RETURN NEW;
END $$;
CREATE TRIGGER t22_allocation_guard BEFORE INSERT ON public.app_delivery_allocations FOR EACH ROW EXECUTE FUNCTION hvm_logistics_private.guard_allocation();
CREATE FUNCTION hvm_logistics_private.guard_proof() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.app_orders; actor uuid; BEGIN
 SELECT * INTO o FROM public.app_orders WHERE id=NEW.order_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.app_order_fulfillment WHERE order_id=NEW.order_id AND status='out_for_delivery') THEN
  RAISE EXCEPTION 'ORDER_NOT_OUT_FOR_DELIVERY' USING ERRCODE='23514'; END IF;
 actor:=nullif(current_setting('hvm.order_actor_user_id',true),'')::uuid;
 IF actor IS NULL OR actor IS DISTINCT FROM o.producer_user_id OR actor IS DISTINCT FROM NEW.recorded_by_user_id
 OR current_setting('hvm.order_actor_role',true) IS DISTINCT FROM 'producer'
 OR NOT EXISTS(SELECT 1 FROM public.app_users u JOIN public.app_user_role_assignments r ON r.user_id=u.id
 WHERE u.id=actor AND r.role_code='producer' AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>clock_timestamp())
 AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active') THEN
  RAISE EXCEPTION 'ORDER_ACTOR_REQUIRED' USING ERRCODE='23514'; END IF;
 NEW.received_by_name:=btrim(NEW.received_by_name); NEW.delivered_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER t22_proof_guard BEFORE INSERT ON public.app_delivery_proofs FOR EACH ROW EXECUTE FUNCTION hvm_logistics_private.guard_proof();
CREATE FUNCTION hvm_logistics_private.immutable_record() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE before_row jsonb:=to_jsonb(OLD); after_row jsonb:=to_jsonb(NEW); fk text;
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.app_orders WHERE id=OLD.order_id) THEN RETURN OLD; END IF;
 fk:=CASE TG_TABLE_NAME WHEN 'app_delivery_allocations' THEN 'window_id' ELSE 'recorded_by_user_id' END;
 IF TG_OP='UPDATE' AND before_row->>fk IS NOT NULL AND after_row->>fk IS NULL AND before_row-fk=after_row-fk
 AND ((fk='window_id' AND NOT EXISTS(SELECT 1 FROM public.app_delivery_windows WHERE id=(before_row->>fk)::uuid))
 OR (fk='recorded_by_user_id' AND NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=(before_row->>fk)::uuid))) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'DELIVERY_RECORD_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER t22_allocation_immutable BEFORE UPDATE OR DELETE ON public.app_delivery_allocations FOR EACH ROW EXECUTE FUNCTION hvm_logistics_private.immutable_record();
CREATE TRIGGER t22_proof_immutable BEFORE UPDATE OR DELETE ON public.app_delivery_proofs FOR EACH ROW EXECUTE FUNCTION hvm_logistics_private.immutable_record();
CREATE FUNCTION hvm_logistics_private.require_delivery_facts() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status='out_for_delivery' AND OLD.status IS DISTINCT FROM NEW.status
 AND NOT EXISTS(SELECT 1 FROM public.app_delivery_allocations WHERE order_id=NEW.order_id) THEN
  RAISE EXCEPTION 'DELIVERY_ALLOCATION_REQUIRED' USING ERRCODE='23514'; END IF;
 IF NEW.status='delivered' AND OLD.status IS DISTINCT FROM NEW.status
 AND NOT EXISTS(SELECT 1 FROM public.app_delivery_proofs WHERE order_id=NEW.order_id) THEN
  RAISE EXCEPTION 'DELIVERY_PROOF_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER t22_require_delivery_facts BEFORE UPDATE ON public.app_order_fulfillment FOR EACH ROW EXECUTE FUNCTION hvm_logistics_private.require_delivery_facts();
CREATE FUNCTION hvm_logistics_private.assert_proof_delivered() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.app_orders WHERE id=NEW.order_id)
 AND NOT EXISTS(SELECT 1 FROM public.app_order_fulfillment WHERE order_id=NEW.order_id AND status='delivered') THEN
  RAISE EXCEPTION 'DELIVERY_PROOF_NOT_ATOMIC' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER t22_proof_atomic AFTER INSERT ON public.app_delivery_proofs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hvm_logistics_private.assert_proof_delivered();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hvm_logistics_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hvm_logistics_private TO service_role;
