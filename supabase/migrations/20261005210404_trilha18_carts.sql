-- T18: intent only. No stock reservation, delivery quote, order or payment.
SET lock_timeout = '5s';
CREATE TABLE public.app_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(128) NOT NULL UNIQUE CHECK (session_id ~ '^[0-9a-f-]{36}$'),
  user_id UUID NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- One saved basket across devices. Guest baskets remain session scoped.
CREATE UNIQUE INDEX ix_app_carts_user ON public.app_carts(user_id) WHERE user_id IS NOT NULL;
CREATE TABLE public.app_cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES public.app_carts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.app_products(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.app_producer_stores(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  cut_type VARCHAR(64) NULL CHECK (cut_type IN ('rodelas','cubos','tiras','picado_fino','folhas_inteiras')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- PostgreSQL's ordinary UNIQUE treats two NULLs as different. Plain portions
  -- must merge too; NULLS NOT DISTINCT closes that duplicate-item loophole.
  CONSTRAINT uq_cart_product_customization UNIQUE NULLS NOT DISTINCT (cart_id,product_id,cut_type)
);
CREATE INDEX ix_app_cart_items_product ON public.app_cart_items(product_id);
CREATE INDEX ix_app_cart_items_store ON public.app_cart_items(store_id);
ALTER TABLE public.app_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_carts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_cart_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_carts,public.app_cart_items FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.app_carts,public.app_cart_items TO service_role;
COMMENT ON TABLE public.app_carts IS 'T18: private multilojas basket; backend resolves an opaque HttpOnly cookie or a verified active account. No client policies/grants.';
COMMENT ON TABLE public.app_cart_items IS 'T18: current T14 price is read, never frozen. Quantity denotes existing product portions, cut is a preparation preference, not arbitrary weight or reserved stock.';
