-- T14: strictly additive to T13 / logical schema 48. No stock, lots or checkout.
SET lock_timeout = '5s';
CREATE TABLE public.app_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 -- CASCADE intentionally preserves the homologated v46 account hard deletion.
 store_id uuid NOT NULL REFERENCES public.app_producer_stores(id) ON DELETE CASCADE,
 category_id uuid NOT NULL REFERENCES public.app_categories(id) ON DELETE RESTRICT,
 title varchar(255) NOT NULL CHECK (length(trim(title)) >= 3),
 description text NOT NULL CHECK (length(trim(description)) BETWEEN 10 AND 2000),
 packaging_type varchar(64) NOT NULL CHECK (packaging_type IN ('pote_higienizado','bandeja_selada','maco_lavado','porcao_embalada')),
 net_weight_grams integer NOT NULL CHECK (net_weight_grams BETWEEN 1 AND 50000),
 unit_type varchar(16) NOT NULL CHECK (unit_type IN ('un','pote','bandeja','kg','maco')),
 shelf_life_days integer NOT NULL DEFAULT 5 CHECK (shelf_life_days > 0),
 conservation_notes varchar(255) NOT NULL DEFAULT 'Manter refrigerado entre 2°C e 6°C' CHECK (length(trim(conservation_notes)) > 0),
 is_published boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_app_products_store ON public.app_products(store_id,created_at DESC,id);
CREATE INDEX ix_app_products_category ON public.app_products(category_id,is_published);
CREATE INDEX ix_app_products_public ON public.app_products(created_at DESC,id) WHERE is_published;
CREATE TABLE public.app_price_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES public.app_products(id) ON DELETE CASCADE,
 price_cents integer NOT NULL CHECK (price_cents > 0),
 valid_from timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by_user_id uuid NOT NULL REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX ix_app_price_versions_active ON public.app_price_versions(product_id,valid_from DESC);
CREATE INDEX ix_app_price_versions_actor ON public.app_price_versions(created_by_user_id);
CREATE TABLE public.app_product_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES public.app_products(id) ON DELETE CASCADE,
 media_url varchar(512) NOT NULL CHECK (media_url ~ '^https://xipbsazvymkqqfmfegwu\.supabase\.co/storage/v1/object/product-media/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}-[0-9a-f]{64}\.(jpg|png|webp)$'),
 display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
 is_primary boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(product_id,media_url)
);
CREATE UNIQUE INDEX uq_app_product_primary_media ON public.app_product_media(product_id) WHERE is_primary;
CREATE INDEX ix_app_product_media_order ON public.app_product_media(product_id,display_order,id);
COMMENT ON TABLE public.app_products IS 'T14: catálogo sem estoque; preço vem de app_price_versions; exclusão operacional de conta v46 preservada.';
COMMENT ON TABLE public.app_price_versions IS 'T14 append-only: versões não são alteradas; remoção somente na cascata da exclusão operacional do produto/conta.';
COMMENT ON COLUMN public.app_product_media.media_url IS 'URL estável do bucket privado; backend emite URLs assinadas somente após autorização/elegibilidade.';

ALTER TABLE public.app_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_products FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_price_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_price_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_product_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_product_media FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_products,public.app_price_versions,public.app_product_media FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.app_products,public.app_product_media TO anon,authenticated;
-- The public price contract does not expose the author's private user UUID.
GRANT SELECT(id,product_id,price_cents,valid_from) ON public.app_price_versions TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.app_products TO service_role;
GRANT SELECT,INSERT ON public.app_price_versions TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.app_product_media TO service_role;
CREATE POLICY products_public_read ON public.app_products FOR SELECT TO anon,authenticated
 USING (is_published AND hvm_store_private.store_is_visible(store_id)
  AND category_id IN (SELECT id FROM public.app_categories WHERE is_active));
CREATE POLICY products_owner_read ON public.app_products FOR SELECT TO authenticated
 USING (store_id IN (SELECT s.id FROM public.app_producer_stores s JOIN public.app_producer_profiles p ON p.id=s.producer_profile_id
  WHERE p.person_id=(SELECT public.current_person_id())));
CREATE POLICY price_public_read ON public.app_price_versions FOR SELECT TO anon,authenticated
 USING (product_id IN (SELECT id FROM public.app_products WHERE is_published
  AND hvm_store_private.store_is_visible(store_id) AND category_id IN (SELECT id FROM public.app_categories WHERE is_active)));
CREATE POLICY price_owner_read ON public.app_price_versions FOR SELECT TO authenticated
 USING (product_id IN (SELECT p.id FROM public.app_products p JOIN public.app_producer_stores s ON s.id=p.store_id
  JOIN public.app_producer_profiles pp ON pp.id=s.producer_profile_id WHERE pp.person_id=(SELECT public.current_person_id())));
CREATE POLICY media_public_read ON public.app_product_media FOR SELECT TO anon,authenticated
 USING (product_id IN (SELECT id FROM public.app_products WHERE is_published
  AND hvm_store_private.store_is_visible(store_id) AND category_id IN (SELECT id FROM public.app_categories WHERE is_active)));
CREATE POLICY media_owner_read ON public.app_product_media FOR SELECT TO authenticated
 USING (product_id IN (SELECT p.id FROM public.app_products p JOIN public.app_producer_stores s ON s.id=p.store_id
  JOIN public.app_producer_profiles pp ON pp.id=s.producer_profile_id WHERE pp.person_id=(SELECT public.current_person_id())));

CREATE SCHEMA hvm_product_private;
REVOKE ALL ON SCHEMA hvm_product_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA hvm_product_private TO service_role;
CREATE FUNCTION hvm_product_private.guard_price_history() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.app_products WHERE id=OLD.product_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'PRODUCT_PRICE_IMMUTABLE' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER trg_t14_price_history BEFORE UPDATE OR DELETE ON public.app_price_versions
 FOR EACH ROW EXECUTE FUNCTION hvm_product_private.guard_price_history();
CREATE FUNCTION hvm_product_private.guard_published_product() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
 IF TG_TABLE_NAME='app_products' THEN v_id := NEW.id; ELSE v_id := OLD.product_id; END IF;
 IF EXISTS(SELECT 1 FROM public.app_products WHERE id=v_id AND is_published) THEN
  IF NOT EXISTS(SELECT 1 FROM public.app_product_media WHERE product_id=v_id AND is_primary) THEN
   RAISE EXCEPTION 'PRODUCT_PRIMARY_MEDIA_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.app_price_versions WHERE product_id=v_id) THEN
   RAISE EXCEPTION 'PRODUCT_PRICE_REQUIRED' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_t14_publish_integrity AFTER INSERT OR UPDATE ON public.app_products
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hvm_product_private.guard_published_product();
CREATE CONSTRAINT TRIGGER trg_t14_media_integrity AFTER DELETE OR UPDATE ON public.app_product_media
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hvm_product_private.guard_published_product();
CREATE FUNCTION hvm_product_private.queue_deleted_media() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 INSERT INTO public.app_storage_deletion_queue(bucket,object_path,reason)
 VALUES('product-media',split_part(OLD.media_url,'/storage/v1/object/product-media/',2),'product_media_deleted')
 ON CONFLICT DO NOTHING;
 RETURN OLD;
END;
$$;
CREATE TRIGGER trg_t14_media_cleanup AFTER DELETE ON public.app_product_media
 FOR EACH ROW EXECUTE FUNCTION hvm_product_private.queue_deleted_media();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hvm_product_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hvm_product_private TO service_role;
-- Files remain private. Only the privileged backend uploads/signs; no browser
-- INSERT/UPDATE/DELETE Storage policy is introduced.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('product-media','product-media',false,2097152,ARRAY['image/jpeg','image/png','image/webp'])
 ON CONFLICT(id) DO NOTHING;
