-- T15: additive operational inventory. Existing domains and prices remain intact.
CREATE SCHEMA hvm_inventory_private;
REVOKE ALL ON SCHEMA hvm_inventory_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA hvm_inventory_private TO service_role;

CREATE TABLE public.app_inventory_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE preserves the operational account deletion homologated in v46/T14.
  product_id UUID NOT NULL REFERENCES public.app_products(id) ON DELETE CASCADE,
  lot_code VARCHAR(64) NOT NULL CHECK (length(btrim(lot_code)) > 0),
  harvest_date DATE NOT NULL,
  expiration_date DATE NOT NULL CHECK (expiration_date >= harvest_date),
  initial_quantity INTEGER NOT NULL CHECK (initial_quantity > 0),
  current_quantity INTEGER NOT NULL CHECK (current_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_product_lot_code UNIQUE (product_id, lot_code),
  CONSTRAINT uq_inventory_lot_product UNIQUE (id, product_id)
);
CREATE INDEX ix_inventory_lots_available ON public.app_inventory_lots
  (product_id, expiration_date, harvest_date, created_at, id) WHERE current_quantity > 0;

CREATE TABLE public.app_inventory_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.app_products(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  cart_session_id VARCHAR(128) NOT NULL CHECK (length(cart_session_id) BETWEEN 8 AND 128),
  expires_at TIMESTAMPTZ NOT NULL,
  is_consumed BOOLEAN NOT NULL DEFAULT false,
  is_released BOOLEAN NOT NULL DEFAULT false,
  consumed_order_id UUID NULL, -- Future order reference; no orders table is created in T15.
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_inventory_reservation_lot_product FOREIGN KEY (lot_id,product_id)
    REFERENCES public.app_inventory_lots(id,product_id) ON DELETE CASCADE,
  CONSTRAINT ck_inventory_reservation_state CHECK (
    NOT (is_consumed AND is_released) AND (is_consumed = (consumed_order_id IS NOT NULL))
  )
);
CREATE INDEX ix_app_inventory_reservations_expiry ON public.app_inventory_reservations(expires_at)
  WHERE is_consumed = false AND is_released = false;
CREATE INDEX ix_inventory_reservations_lot_product ON public.app_inventory_reservations(lot_id,product_id);
CREATE INDEX ix_inventory_reservations_product ON public.app_inventory_reservations(product_id);

CREATE TABLE public.app_inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES public.app_inventory_lots(id) ON DELETE CASCADE,
  movement_type VARCHAR(32) NOT NULL CHECK (movement_type IN ('harvest_entry','order_sale','loss_waste','manual_adjustment')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  reason_description VARCHAR(255) NOT NULL CHECK (length(btrim(reason_description)) > 0),
  -- Attribution is retained until an operational account deletion erases the identity.
  actor_user_id UUID NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  reservation_id UUID NULL UNIQUE REFERENCES public.app_inventory_reservations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_inventory_movement_sale CHECK (
    (movement_type = 'order_sale' AND reservation_id IS NOT NULL AND quantity_delta < 0)
    OR (movement_type <> 'order_sale' AND reservation_id IS NULL)
  ),
  CONSTRAINT ck_inventory_movement_harvest CHECK (movement_type <> 'harvest_entry' OR quantity_delta > 0)
);
CREATE INDEX ix_inventory_movements_lot_history ON public.app_inventory_movements(lot_id,created_at DESC,id);
CREATE INDEX ix_inventory_movements_actor ON public.app_inventory_movements(actor_user_id);
CREATE UNIQUE INDEX uq_inventory_harvest_entry ON public.app_inventory_movements(lot_id) WHERE movement_type='harvest_entry';

ALTER TABLE public.app_inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_inventory_lots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_inventory_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_inventory_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_inventory_lots, public.app_inventory_movements, public.app_inventory_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_inventory_lots, public.app_inventory_reservations TO service_role;
GRANT SELECT, INSERT ON public.app_inventory_movements TO service_role;
-- No direct read/write policies: all three tables are private operational data.

CREATE FUNCTION hvm_inventory_private.immutable_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.app_inventory_lots WHERE id=OLD.lot_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=OLD.actor_user_id)
     AND (to_jsonb(NEW)-'actor_user_id')=(to_jsonb(OLD)-'actor_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'INVENTORY_MOVEMENT_IMMUTABLE' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION hvm_inventory_private.immutable_movement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hvm_inventory_private.immutable_movement() TO service_role;
CREATE TRIGGER inventory_movement_immutable BEFORE UPDATE OR DELETE ON public.app_inventory_movements
FOR EACH ROW EXECUTE FUNCTION hvm_inventory_private.immutable_movement();

-- Deferred ledger checks run on the final transaction state. A reservation deducts
-- stock once; consuming it swaps the hold for a sale entry without a second debit.
CREATE FUNCTION hvm_inventory_private.assert_lot_balance() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE lot_uuid UUID; available BIGINT; initial BIGINT; ledger BIGINT; held BIGINT; harvest BIGINT;
BEGIN
  IF TG_TABLE_NAME='app_inventory_lots' THEN
    lot_uuid := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    lot_uuid := CASE WHEN TG_OP='DELETE' THEN OLD.lot_id ELSE NEW.lot_id END;
  END IF;
  SELECT current_quantity,initial_quantity INTO available,initial FROM public.app_inventory_lots WHERE id=lot_uuid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(sum(quantity_delta),0),coalesce(sum(quantity_delta) FILTER(WHERE movement_type='harvest_entry'),0)
    INTO ledger,harvest FROM public.app_inventory_movements WHERE lot_id=lot_uuid;
  SELECT coalesce(sum(quantity),0) INTO held FROM public.app_inventory_reservations
    WHERE lot_id=lot_uuid AND NOT is_consumed AND NOT is_released;
  IF available <> ledger-held OR harvest <> initial THEN
    RAISE EXCEPTION 'INVENTORY_BALANCE_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.app_inventory_reservations r
    LEFT JOIN public.app_inventory_movements m ON m.reservation_id=r.id
    WHERE r.lot_id=lot_uuid AND (
      (r.is_consumed AND (m.id IS NULL OR m.quantity_delta <> -r.quantity OR m.lot_id <> r.lot_id))
      OR (NOT r.is_consumed AND m.id IS NOT NULL)
    )
  ) THEN RAISE EXCEPTION 'INVENTORY_SALE_MISMATCH' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION hvm_inventory_private.assert_lot_balance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hvm_inventory_private.assert_lot_balance() TO service_role;
CREATE CONSTRAINT TRIGGER inventory_lot_balance AFTER INSERT OR UPDATE OR DELETE ON public.app_inventory_lots
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hvm_inventory_private.assert_lot_balance();
CREATE CONSTRAINT TRIGGER inventory_reservation_balance AFTER INSERT OR UPDATE OR DELETE ON public.app_inventory_reservations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hvm_inventory_private.assert_lot_balance();
CREATE CONSTRAINT TRIGGER inventory_movement_balance AFTER INSERT OR UPDATE OR DELETE ON public.app_inventory_movements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hvm_inventory_private.assert_lot_balance();
