-- T13, additive to schema 47: global catalogue, independent of stores/products.
CREATE TABLE public.app_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 parent_id uuid REFERENCES public.app_categories(id) ON DELETE RESTRICT,
 slug varchar(64) NOT NULL CONSTRAINT uq_app_categories_slug UNIQUE
   CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$'),
 name varchar(128) NOT NULL CHECK (length(trim(name)) >= 2),
 description text CHECK (description IS NULL OR length(description) <= 500),
 icon_name varchar(64) NOT NULL CHECK (icon_name IN ('leaf','knife','bowl','sparkles','sun','carrot','basket')),
 display_order integer NOT NULL DEFAULT 0,
 is_active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT chk_category_not_self_parent CHECK (id <> parent_id)
);
CREATE INDEX ix_app_categories_display ON public.app_categories(display_order,name,id) WHERE is_active=true;
CREATE INDEX ix_app_categories_parent ON public.app_categories(parent_id) WHERE parent_id IS NOT NULL;
COMMENT ON TABLE public.app_categories IS 'T13: taxonomia global; seed canônico regional; alterações auditadas pelo Super Admin; desativação sem DELETE.';

INSERT INTO public.app_categories(slug,name,icon_name,display_order,description) VALUES
 ('hortalicas-folhosas','Hortaliças folhosas','leaf',1,'Alfaces, couves, rúculas e espinafres colhidos frescos da horta local.'),
 ('legumes-picados','Legumes picados','knife',2,'Cenouras, abóboras e tubérculos já higienizados, cortados e embalados em porções práticas.'),
 ('mix-prontos','Mix prontos','bowl',3,'Combinações balanceadas de legumes e verduras prontas para cozimento, salada ou sopa.'),
 ('temperos-e-ervas','Temperos e ervas','sparkles',4,'Cheiro-verde, cebolinha, coentro, manjericão e ervas aromáticas frescas.'),
 ('frutas','Frutas','sun',5,'Frutas frescas da estação produzidas por agricultores familiares da região.');

ALTER TABLE public.app_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_categories FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_categories FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.app_categories TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.app_categories TO service_role;
CREATE POLICY categories_public_read ON public.app_categories FOR SELECT TO anon,authenticated USING (is_active=true);
