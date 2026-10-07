-- T21 aditiva sobre schema 58. app_orders.status/received_at e seus contratos
-- financeiros T20 permanecem intactos. A esteira online tem estado próprio.
SET lock_timeout = '5s';
CREATE SCHEMA hvm_orders_private;
REVOKE ALL ON SCHEMA hvm_orders_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA hvm_orders_private TO service_role;

CREATE TABLE public.app_order_fulfillment (
 order_id uuid PRIMARY KEY REFERENCES public.app_orders(id) ON DELETE CASCADE,
 status varchar(32) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','in_preparation','ready_for_dispatch','out_for_delivery','delivered','cancelled')),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 cancellation_reason text CHECK (length(cancellation_reason) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((status='cancelled')=(cancellation_reason IS NOT NULL))
);
CREATE INDEX ix_order_fulfillment_queue ON public.app_order_fulfillment(status,created_at DESC,order_id);
CREATE TABLE public.app_order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.app_orders(id) ON DELETE CASCADE,
 -- SET NULL preserves product/store/account erasure already implemented in T14/T20.
 product_id uuid REFERENCES public.app_products(id) ON DELETE SET NULL,
 product_title_snapshot varchar(255) NOT NULL,
 packaging_snapshot varchar(64) NOT NULL,
 net_weight_grams integer NOT NULL CHECK (net_weight_grams>0),
 unit_type varchar(16) NOT NULL,
 cut_type varchar(64),
 quantity integer NOT NULL CHECK (quantity>0),
 unit_price_cents integer NOT NULL CHECK (unit_price_cents>0),
 total_price_cents integer NOT NULL CHECK (total_price_cents::bigint=quantity::bigint*unit_price_cents AND total_price_cents>0),
 item_position integer NOT NULL CHECK (item_position>=0),
 UNIQUE(order_id,item_position)
);
CREATE INDEX ix_order_items_product ON public.app_order_items(product_id) WHERE product_id IS NOT NULL;
CREATE TABLE public.app_order_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.app_orders(id) ON DELETE CASCADE,
 actor_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 actor_role varchar(64) NOT NULL CHECK (actor_role IN ('payment_gateway','producer')),
 -- NULL is the actual origin of the creation event, never an invented prior state.
 from_status varchar(32) CHECK (from_status IN ('confirmed','in_preparation','ready_for_dispatch','out_for_delivery','delivered','cancelled')),
 to_status varchar(32) NOT NULL CHECK (to_status IN ('confirmed','in_preparation','ready_for_dispatch','out_for_delivery','delivered','cancelled')),
 notes text CHECK (length(notes)<=500),
 revision integer NOT NULL CHECK (revision>0),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(order_id,revision)
);
CREATE INDEX ix_order_events_actor ON public.app_order_events(actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE TABLE public.app_order_stock_returns (
 reservation_id uuid PRIMARY KEY REFERENCES public.app_inventory_reservations(id) ON DELETE CASCADE,
 order_id uuid NOT NULL REFERENCES public.app_orders(id) ON DELETE CASCADE,
 lot_id uuid NOT NULL REFERENCES public.app_inventory_lots(id) ON DELETE CASCADE,
 movement_id uuid NOT NULL UNIQUE REFERENCES public.app_inventory_movements(id) ON DELETE CASCADE,
 quantity integer NOT NULL CHECK (quantity>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_order_stock_returns_order ON public.app_order_stock_returns(order_id);
CREATE INDEX ix_order_stock_returns_lot ON public.app_order_stock_returns(lot_id);
CREATE INDEX ix_reservations_consumed_order ON public.app_inventory_reservations(consumed_order_id,lot_id,id) WHERE consumed_order_id IS NOT NULL;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['app_order_fulfillment','app_order_items','app_order_events','app_order_stock_returns'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO service_role',t);
 END LOOP;
 GRANT UPDATE,DELETE ON public.app_order_fulfillment TO service_role;
 FOREACH t IN ARRAY ARRAY['app_order_fulfillment','app_order_items','app_order_events'] LOOP
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY order_customer_read ON public.%I FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.app_orders o WHERE o.id=order_id AND o.customer_user_id=(SELECT auth.uid())))',t);
  EXECUTE format('CREATE POLICY order_producer_read ON public.%I FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.app_orders o WHERE o.id=order_id AND o.producer_user_id=(SELECT auth.uid())))',t);
 END LOOP;
END $$;

-- Capture immutable item facts inside the same T20 settlement transaction.
CREATE FUNCTION hvm_orders_private.capture_order(order_uuid uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.app_orders; pi public.app_payment_intents; frozen jsonb; item jsonb; p public.app_products; position integer:=0;
BEGIN
 SELECT * INTO o FROM public.app_orders WHERE id=order_uuid;
 IF NOT FOUND OR o.source<>'online' THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.app_order_fulfillment WHERE order_id=o.id) THEN RETURN; END IF;
 SELECT * INTO pi FROM public.app_payment_intents WHERE id=o.payment_intent_id AND user_id=o.customer_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_PAYMENT_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT s->'items' INTO frozen FROM public.app_checkout_quotes q,
  LATERAL jsonb_array_elements(q.items_snapshot) s
  WHERE q.id=pi.quote_id AND q.user_id=o.customer_user_id AND s->>'storeId'=o.store_id::text;
 IF frozen IS NULL OR jsonb_array_length(frozen)=0 THEN RAISE EXCEPTION 'ORDER_QUOTE_INVALID' USING ERRCODE='23514'; END IF;
 INSERT INTO public.app_order_fulfillment(order_id,created_at,updated_at) VALUES(o.id,o.created_at,o.created_at);
 FOR item IN SELECT value FROM jsonb_array_elements(frozen) LOOP
  SELECT * INTO p FROM public.app_products WHERE id=(item->>'productId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_PRODUCT_UNAVAILABLE' USING ERRCODE='23514'; END IF;
  INSERT INTO public.app_order_items(order_id,product_id,product_title_snapshot,packaging_snapshot,net_weight_grams,unit_type,cut_type,quantity,unit_price_cents,total_price_cents,item_position)
  VALUES(o.id,p.id,item->>'title',p.packaging_type,(item->>'netWeightGrams')::integer,item->>'unitType',item->>'cutType',(item->>'quantity')::integer,(item->>'unitPriceCents')::integer,(item->>'totalPriceCents')::integer,position);
  position:=position+1;
 END LOOP;
 IF (SELECT sum(total_price_cents) FROM public.app_order_items WHERE order_id=o.id) IS DISTINCT FROM o.subtotal_cents::bigint THEN
  RAISE EXCEPTION 'ORDER_SNAPSHOT_MISMATCH' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.app_order_events(order_id,actor_user_id,actor_role,from_status,to_status,revision,occurred_at)
 VALUES(o.id,o.customer_user_id,'payment_gateway',NULL,'confirmed',1,o.created_at);
END $$;
CREATE FUNCTION hvm_orders_private.capture_new_order() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN PERFORM hvm_orders_private.capture_order(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER t21_capture_order AFTER INSERT ON public.app_orders
FOR EACH ROW EXECUTE FUNCTION hvm_orders_private.capture_new_order();

-- T20 inserts orders before setting the intent to approved; check the FINAL state.
CREATE FUNCTION hvm_orders_private.assert_approved_order() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_orders WHERE id=NEW.id) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_payment_intents WHERE id=NEW.payment_intent_id
   AND user_id=NEW.customer_user_id AND status='approved') THEN
  RAISE EXCEPTION 'ORDER_PAYMENT_NOT_APPROVED' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER t21_order_payment_approved AFTER INSERT ON public.app_orders
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hvm_orders_private.assert_approved_order();

CREATE FUNCTION hvm_orders_private.guard_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE actor uuid; note text; o public.app_orders; legal boolean;
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM public.app_orders WHERE id=OLD.order_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'ORDER_STATE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'confirmed' OR NEW.revision<>1 THEN RAISE EXCEPTION 'ILLEGAL_TRANSITION' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 legal:=CASE OLD.status
  WHEN 'confirmed' THEN NEW.status IN ('in_preparation','cancelled')
  WHEN 'in_preparation' THEN NEW.status IN ('ready_for_dispatch','cancelled')
  WHEN 'ready_for_dispatch' THEN NEW.status='out_for_delivery'
  WHEN 'out_for_delivery' THEN NEW.status='delivered' ELSE false END;
 IF NOT legal THEN RAISE EXCEPTION 'ILLEGAL_TRANSITION' USING ERRCODE='23514'; END IF;
 IF NEW.order_id<>OLD.order_id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='23514'; END IF;
 actor:=nullif(current_setting('hvm.order_actor_user_id',true),'')::uuid;
 note:=nullif(btrim(current_setting('hvm.order_notes',true)),'');
 SELECT * INTO o FROM public.app_orders WHERE id=OLD.order_id;
 IF actor IS NULL OR current_setting('hvm.order_actor_role',true) IS DISTINCT FROM 'producer'
 OR NOT EXISTS(SELECT 1 FROM public.app_users u JOIN public.app_user_role_assignments r ON r.user_id=u.id
   WHERE u.id=actor AND u.id=o.producer_user_id AND r.role_code='producer' AND r.revoked_at IS NULL
   AND (r.expires_at IS NULL OR r.expires_at>clock_timestamp())
   AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active') THEN
  RAISE EXCEPTION 'ORDER_ACTOR_REQUIRED' USING ERRCODE='23514'; END IF;
 IF o.status='refunded' THEN RAISE EXCEPTION 'ORDER_REFUNDED' USING ERRCODE='23514'; END IF;
 IF NEW.status='cancelled' AND o.received_at IS NOT NULL THEN RAISE EXCEPTION 'ORDER_ALREADY_RECEIVED' USING ERRCODE='23514'; END IF;
 IF NEW.status='cancelled' AND (note IS NULL OR length(note)<10 OR length(note)>500) THEN
  RAISE EXCEPTION 'CANCELLATION_REASON_REQUIRED' USING ERRCODE='23514'; END IF;
 NEW.cancellation_reason:=CASE WHEN NEW.status='cancelled' THEN note ELSE NULL END;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER t21_state_guard BEFORE INSERT OR UPDATE OR DELETE ON public.app_order_fulfillment
FOR EACH ROW EXECUTE FUNCTION hvm_orders_private.guard_transition();
CREATE FUNCTION hvm_orders_private.record_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 INSERT INTO public.app_order_events(order_id,actor_user_id,actor_role,from_status,to_status,notes,revision)
 VALUES(NEW.order_id,nullif(current_setting('hvm.order_actor_user_id',true),'')::uuid,'producer',OLD.status,NEW.status,
 nullif(btrim(current_setting('hvm.order_notes',true)),''),NEW.revision);
 RETURN NEW;
END $$;
CREATE TRIGGER t21_record_transition AFTER UPDATE ON public.app_order_fulfillment
FOR EACH ROW EXECUTE FUNCTION hvm_orders_private.record_transition();

CREATE FUNCTION hvm_orders_private.immutable_record() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE before_row jsonb:=to_jsonb(OLD); after_row jsonb:=to_jsonb(NEW);
BEGIN
 IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM public.app_orders WHERE id=OLD.order_id)
  OR (TG_TABLE_NAME='app_order_stock_returns' AND NOT EXISTS(SELECT 1 FROM public.app_inventory_lots WHERE id=(to_jsonb(OLD)->>'lot_id')::uuid))) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='app_order_events' AND after_row->>'actor_user_id' IS NULL AND before_row->>'actor_user_id' IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=(before_row->>'actor_user_id')::uuid)
  AND after_row-'actor_user_id'=before_row-'actor_user_id' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='app_order_items' AND after_row->>'product_id' IS NULL AND before_row->>'product_id' IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.app_products WHERE id=(before_row->>'product_id')::uuid)
  AND after_row-'product_id'=before_row-'product_id' THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'ORDER_RECORD_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER t21_items_immutable BEFORE UPDATE OR DELETE ON public.app_order_items FOR EACH ROW EXECUTE FUNCTION hvm_orders_private.immutable_record();
CREATE TRIGGER t21_events_immutable BEFORE UPDATE OR DELETE ON public.app_order_events FOR EACH ROW EXECUTE FUNCTION hvm_orders_private.immutable_record();
CREATE TRIGGER t21_returns_immutable BEFORE UPDATE OR DELETE ON public.app_order_stock_returns FOR EACH ROW EXECUTE FUNCTION hvm_orders_private.immutable_record();
-- A privileged INSERT cannot forge an extra stage or silently add purchased items.
CREATE FUNCTION hvm_orders_private.assert_history() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE state public.app_order_fulfillment;
BEGIN
 SELECT * INTO state FROM public.app_order_fulfillment WHERE order_id=NEW.order_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM public.app_order_events WHERE order_id=NEW.order_id)<>state.revision
 OR NOT EXISTS(SELECT 1 FROM public.app_order_events WHERE order_id=NEW.order_id AND revision=state.revision AND to_status=state.status)
 OR EXISTS(SELECT 1 FROM public.app_order_events e LEFT JOIN public.app_order_events previous ON previous.order_id=e.order_id AND previous.revision=e.revision-1
   WHERE e.order_id=NEW.order_id AND ((e.revision=1 AND (e.from_status IS NOT NULL OR e.to_status<>'confirmed' OR e.actor_role<>'payment_gateway'))
     OR (e.revision>1 AND (previous.id IS NULL OR e.from_status IS DISTINCT FROM previous.to_status OR e.actor_role<>'producer'
       OR NOT CASE e.from_status WHEN 'confirmed' THEN e.to_status IN ('in_preparation','cancelled')
        WHEN 'in_preparation' THEN e.to_status IN ('ready_for_dispatch','cancelled')
        WHEN 'ready_for_dispatch' THEN e.to_status='out_for_delivery'
        WHEN 'out_for_delivery' THEN e.to_status='delivered' ELSE false END)))) THEN
  RAISE EXCEPTION 'ORDER_HISTORY_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER t21_history_consistent AFTER INSERT ON public.app_order_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hvm_orders_private.assert_history();
CREATE FUNCTION hvm_orders_private.assert_items() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.app_orders o WHERE o.id=NEW.order_id AND o.subtotal_cents::bigint IS DISTINCT FROM
   (SELECT sum(total_price_cents) FROM public.app_order_items WHERE order_id=NEW.order_id)) THEN
  RAISE EXCEPTION 'ORDER_SNAPSHOT_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER t21_items_consistent AFTER INSERT ON public.app_order_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hvm_orders_private.assert_items();
CREATE FUNCTION hvm_orders_private.assert_cancellation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status='cancelled' AND EXISTS(SELECT 1 FROM public.app_orders WHERE id=NEW.order_id) THEN
  IF EXISTS(SELECT 1 FROM public.app_inventory_reservations r WHERE r.consumed_order_id=NEW.order_id AND r.is_consumed
    AND NOT EXISTS(SELECT 1 FROM public.app_order_stock_returns sr JOIN public.app_inventory_movements m ON m.id=sr.movement_id
      WHERE sr.reservation_id=r.id AND sr.order_id=NEW.order_id AND sr.lot_id=r.lot_id AND sr.quantity=r.quantity
      AND m.lot_id=r.lot_id AND m.quantity_delta=r.quantity AND m.movement_type='manual_adjustment')) THEN
   RAISE EXCEPTION 'ORDER_STOCK_RETURN_REQUIRED' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.app_financial_holds h WHERE h.order_id=NEW.order_id AND h.refunded_cents<h.amount_cents
    AND (h.state NOT IN ('disputed','refund_pending') OR NOT EXISTS(SELECT 1 FROM public.app_refund_requests rr
      WHERE rr.order_id=NEW.order_id AND rr.status NOT IN ('rejected','refunded')))) THEN
   RAISE EXCEPTION 'ORDER_REFUND_REQUEST_REQUIRED' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER t21_cancel_is_atomic AFTER UPDATE ON public.app_order_fulfillment
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hvm_orders_private.assert_cancellation();
CREATE FUNCTION hvm_orders_private.guard_cancelled_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF OLD.received_at IS NULL AND NEW.received_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.app_order_fulfillment WHERE order_id=NEW.id AND status='cancelled') THEN
  RAISE EXCEPTION 'ORDER_CANCELLED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER t21_cancelled_receipt BEFORE UPDATE ON public.app_orders FOR EACH ROW EXECUTE FUNCTION hvm_orders_private.guard_cancelled_receipt();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hvm_orders_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hvm_orders_private TO service_role;
-- Existing order facts/financial status are never rewritten by the migration.
DO $$ DECLARE order_uuid uuid; BEGIN
 FOR order_uuid IN SELECT id FROM public.app_orders WHERE source='online' LOOP
  PERFORM hvm_orders_private.capture_order(order_uuid);
 END LOOP;
END $$;
COMMENT ON TABLE public.app_order_fulfillment IS 'T21: máquina estrita de preparo online; status comercial/recebimento/reembolso T20 preservados em app_orders.';
COMMENT ON TABLE public.app_order_stock_returns IS 'Devolução única por reserva consumida: crédito no lote T15, sem apagar a baixa de venda e sem declarar estorno bancário.';
