-- T19: transactional checkout, frozen quotes and immutable command receipts.
-- Pending intent persistence is required by T19; gateway processing stays in T20.
CREATE SCHEMA hvm_checkout_private;
REVOKE ALL ON SCHEMA hvm_checkout_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA hvm_checkout_private TO service_role;
-- Existing coverage helpers are SECURITY INVOKER; checkout reads them as service_role.
GRANT SELECT ON public.app_municipalities,public.app_properties TO service_role;

CREATE TABLE public.app_checkout_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.app_people(id) ON DELETE CASCADE,
  -- Deleting an address/cart must keep its frozen snapshot and the legacy deletion flow.
  delivery_address_id UUID NULL REFERENCES public.app_user_addresses(id) ON DELETE SET NULL,
  cart_id UUID NULL REFERENCES public.app_carts(id) ON DELETE SET NULL,
  cart_fingerprint CHAR(64) NOT NULL CHECK (cart_fingerprint ~ '^[a-f0-9]{64}$'),
  address_snapshot JSONB NOT NULL CHECK (jsonb_typeof(address_snapshot)='object'),
  items_snapshot JSONB NOT NULL CHECK (jsonb_typeof(items_snapshot)='array' AND jsonb_array_length(items_snapshot)>0),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents>0),
  delivery_fee_cents INTEGER NOT NULL CHECK (delivery_fee_cents>=0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents>=0),
  total_cents INTEGER NOT NULL CHECK (total_cents>0),
  expires_at TIMESTAMPTZ NOT NULL,
  is_consumed BOOLEAN NOT NULL DEFAULT false,
  reservation_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_checkout_total CHECK (total_cents::bigint=subtotal_cents::bigint+delivery_fee_cents-discount_cents),
  CONSTRAINT ck_checkout_expiry CHECK (expires_at>created_at AND expires_at<=created_at+interval '15 minutes'),
  CONSTRAINT ck_checkout_reservations CHECK (is_consumed=(cardinality(reservation_ids)>0))
);
CREATE INDEX ix_checkout_quotes_user_history ON public.app_checkout_quotes(user_id,created_at DESC);
CREATE INDEX ix_checkout_quotes_person ON public.app_checkout_quotes(person_id);
CREATE INDEX ix_checkout_quotes_address ON public.app_checkout_quotes(delivery_address_id);
CREATE INDEX ix_checkout_quotes_cart ON public.app_checkout_quotes(cart_id);

CREATE TABLE public.app_command_receipts (
  command_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  endpoint VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  status_code INTEGER NOT NULL CHECK (status_code BETWEEN 200 AND 599),
  response_body JSONB NOT NULL CHECK (jsonb_typeof(response_body)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_command_receipts_user_history ON public.app_command_receipts(user_id,created_at DESC);

-- Compatible with the intent columns planned in T20; no gateway/QR/webhook here.
CREATE TABLE public.app_payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL UNIQUE REFERENCES public.app_command_receipts(command_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  quote_id UUID NOT NULL UNIQUE REFERENCES public.app_checkout_quotes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  method VARCHAR(32) NOT NULL CHECK (method IN ('pix','credit_card')),
  status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','failed','refunded')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents>0),
  pix_qr_code_base64 TEXT NULL,
  pix_copy_paste TEXT NULL,
  gateway_reference VARCHAR(128) NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_payment_intents_user_pending ON public.app_payment_intents(user_id,expires_at) WHERE status='pending';
CREATE INDEX ix_payment_intents_user_history ON public.app_payment_intents(user_id,created_at DESC);

ALTER TABLE public.app_checkout_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_checkout_quotes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_command_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_payment_intents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_checkout_quotes,public.app_command_receipts,public.app_payment_intents FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.app_checkout_quotes,public.app_payment_intents TO service_role;
-- FOR UPDATE requires UPDATE privilege; the immutable trigger rejects every update.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.app_command_receipts TO service_role;
GRANT SELECT ON public.app_checkout_quotes,public.app_payment_intents TO authenticated;
CREATE POLICY quote_owner_read ON public.app_checkout_quotes FOR SELECT TO authenticated
  USING (user_id=(SELECT auth.uid()));
CREATE POLICY payment_intent_owner_read ON public.app_payment_intents FOR SELECT TO authenticated
  USING (user_id=(SELECT auth.uid()));

CREATE FUNCTION hvm_checkout_private.guard_quote() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE held RECORD;
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM public.app_users WHERE id=OLD.user_id)
       AND EXISTS(SELECT 1 FROM public.app_people WHERE id=OLD.person_id) THEN
      RAISE EXCEPTION 'CHECKOUT_QUOTE_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    -- Account erasure releases its unconsumed holds inside the same legacy transaction.
    -- Lock lots before reservations, matching T15's balance/locking rules.
    PERFORM 1 FROM public.app_inventory_lots l
      WHERE EXISTS(SELECT 1 FROM public.app_inventory_reservations r WHERE r.id=ANY(OLD.reservation_ids) AND r.lot_id=l.id)
      ORDER BY l.product_id,l.expiration_date,l.harvest_date,l.created_at,l.id FOR UPDATE OF l;
    FOR held IN UPDATE public.app_inventory_reservations
      SET is_released=true WHERE id=ANY(OLD.reservation_ids) AND NOT is_consumed AND NOT is_released
      RETURNING lot_id,quantity
    LOOP
      UPDATE public.app_inventory_lots SET current_quantity=current_quantity+held.quantity WHERE id=held.lot_id;
    END LOOP;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['is_consumed','reservation_ids','cart_id','delivery_address_id'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_consumed','reservation_ids','cart_id','delivery_address_id'])
     OR (NEW.cart_id IS DISTINCT FROM OLD.cart_id AND (NEW.cart_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.app_carts WHERE id=OLD.cart_id)))
     OR (NEW.delivery_address_id IS DISTINCT FROM OLD.delivery_address_id AND
         (NEW.delivery_address_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.app_user_addresses WHERE id=OLD.delivery_address_id)))
     OR (OLD.is_consumed AND (NEW.is_consumed IS DISTINCT FROM OLD.is_consumed OR NEW.reservation_ids IS DISTINCT FROM OLD.reservation_ids))
     OR (NOT NEW.is_consumed AND NEW.reservation_ids IS DISTINCT FROM OLD.reservation_ids) THEN
    RAISE EXCEPTION 'CHECKOUT_QUOTE_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hvm_checkout_private.guard_quote() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_checkout_private.guard_quote() TO service_role;
CREATE TRIGGER checkout_quote_immutable BEFORE UPDATE OR DELETE ON public.app_checkout_quotes
  FOR EACH ROW EXECUTE FUNCTION hvm_checkout_private.guard_quote();

CREATE FUNCTION hvm_checkout_private.guard_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'COMMAND_RECEIPT_IMMUTABLE' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION hvm_checkout_private.guard_receipt() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_checkout_private.guard_receipt() TO service_role;
CREATE TRIGGER command_receipt_immutable BEFORE UPDATE OR DELETE ON public.app_command_receipts
  FOR EACH ROW EXECUTE FUNCTION hvm_checkout_private.guard_receipt();

COMMENT ON TABLE public.app_checkout_quotes IS 'T19: immutable 15-minute checkout snapshots; inventory holds are consumed only after financial confirmation.';
COMMENT ON TABLE public.app_command_receipts IS 'T19: immutable exact-response replay, scoped by owner, endpoint and SHA-256 payload.';
COMMENT ON TABLE public.app_payment_intents IS 'T19 prerequisite for T20: one pending intent per consumed quote, no gateway integration yet.';
