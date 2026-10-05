-- Requested storefront extension, additive to T17/schema 53. No next trail.
ALTER TABLE public.app_producer_stores
 ADD COLUMN cover_mode varchar(16) NOT NULL DEFAULT 'mixed' CHECK (cover_mode IN ('images','products','mixed')),
 ADD COLUMN public_producer_name varchar(128) CHECK (public_producer_name IS NULL OR length(trim(public_producer_name)) BETWEEN 2 AND 128);
COMMENT ON COLUMN public.app_producer_stores.public_producer_name IS 'Optional public display name, explicitly chosen by the producer; never reads the legal account identity.';

CREATE TABLE public.app_store_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES public.app_producer_stores(id) ON DELETE CASCADE,
 purpose varchar(16) NOT NULL CHECK (purpose IN ('avatar','cover')),
 media_url varchar(512) NOT NULL CHECK (media_url ~ '^https://xipbsazvymkqqfmfegwu\.supabase\.co/storage/v1/object/store-media/[0-9a-f-]{36}/[0-9a-f-]{36}-[0-9a-f]{64}\.(jpg|png|webp)$'),
 display_order integer NOT NULL CHECK (display_order BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_store_media_store ON public.app_store_media(store_id,purpose,display_order,id);
CREATE UNIQUE INDEX uq_store_avatar ON public.app_store_media(store_id) WHERE purpose='avatar';
ALTER TABLE public.app_store_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_store_media FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_store_media FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.app_store_media TO authenticated;
GRANT SELECT,INSERT,DELETE ON public.app_store_media TO service_role;
CREATE POLICY store_media_owner_read ON public.app_store_media FOR SELECT TO authenticated
 USING (store_id IN (SELECT id FROM public.app_producer_stores WHERE producer_profile_id IN
 (SELECT id FROM public.app_producer_profiles WHERE person_id=(SELECT public.current_person_id()))));

CREATE FUNCTION hvm_store_private.queue_deleted_store_media() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 INSERT INTO public.app_storage_deletion_queue(bucket,object_path,reason)
 VALUES('store-media',split_part(OLD.media_url,'/storage/v1/object/store-media/',2),'store_media_deleted')
 ON CONFLICT DO NOTHING;
 RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION hvm_store_private.queue_deleted_store_media() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_store_private.queue_deleted_store_media() TO service_role;
CREATE TRIGGER trg_store_media_cleanup AFTER DELETE ON public.app_store_media
 FOR EACH ROW EXECUTE FUNCTION hvm_store_private.queue_deleted_store_media();
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('store-media','store-media',false,2097152,ARRAY['image/jpeg','image/png','image/webp'])
 ON CONFLICT(id) DO NOTHING;
