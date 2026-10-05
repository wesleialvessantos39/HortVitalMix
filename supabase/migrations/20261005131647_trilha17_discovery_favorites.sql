-- T17 adds discovery indexes and private favorites to the homologated T16.
-- pg_trgm is already installed in extensions by T01; never move it.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX ix_app_products_title_trgm ON public.app_products USING gin (title extensions.gin_trgm_ops);
CREATE INDEX ix_app_stores_name_trgm ON public.app_producer_stores USING gin (store_name extensions.gin_trgm_ops) WHERE status='active';

CREATE TABLE public.app_favorites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 person_id uuid NOT NULL REFERENCES public.app_people(id) ON DELETE CASCADE,
 target_type varchar(16) NOT NULL CHECK (target_type IN ('store','product')),
 target_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT uq_person_favorite UNIQUE (person_id,target_type,target_id)
);
CREATE INDEX ix_app_favorites_person_time ON public.app_favorites(person_id,created_at DESC,id);
COMMENT ON TABLE public.app_favorites IS 'T17: favoritos privados; alvo público validado pelo backend; comandos repetidos são recuperados da auditoria histórica.';
ALTER TABLE public.app_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_favorites FORCE ROW LEVEL SECURITY;
-- Revoke service_role too: Supabase may grant ALL through default privileges.
REVOKE ALL ON public.app_favorites FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.app_favorites TO authenticated;
GRANT SELECT,INSERT,DELETE ON public.app_favorites TO service_role;
CREATE POLICY favorites_owner_read ON public.app_favorites FOR SELECT TO authenticated
 USING (person_id=(SELECT public.current_person_id()));
