-- HortiVitalMix — T08: onboarding rural e cadastro de imóveis produtivos.
-- Evolução aditiva do schema lógico 29 -> 30.
-- O imóvel rural é entidade produtiva própria e NÃO referencia app_user_addresses.
-- Campos de etapas futuras permanecem NULL enquanto status='draft', evitando dados fictícios.

CREATE TABLE public.app_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id UUID NOT NULL
    REFERENCES public.app_producer_profiles(id) ON DELETE CASCADE,
  property_name VARCHAR(128) NOT NULL
    CHECK (length(trim(property_name)) >= 2),
  registration_number VARCHAR(64) NULL,

  total_area_hectares NUMERIC(10,4) NULL
    CHECK (total_area_hectares IS NULL OR total_area_hectares > 0),
  cultivated_area_hectares NUMERIC(10,4) NULL
    CHECK (
      cultivated_area_hectares IS NULL OR
      (
        cultivated_area_hectares >= 0 AND
        total_area_hectares IS NOT NULL AND
        cultivated_area_hectares <= total_area_hectares
      )
    ),

  rural_zone_sector VARCHAR(64) NOT NULL
    CHECK (length(trim(rural_zone_sector)) >= 2),
  line_vicinal VARCHAR(64) NOT NULL
    CHECK (length(trim(line_vicinal)) >= 2),
  municipality VARCHAR(100) NOT NULL DEFAULT 'Ariquemes'
    CHECK (length(trim(municipality)) >= 2),
  state CHAR(2) NOT NULL DEFAULT 'RO'
    CHECK (state = 'RO'),

  latitude_sede NUMERIC(10,7) NOT NULL
    CHECK (latitude_sede BETWEEN -14 AND -7),
  longitude_sede NUMERIC(10,7) NOT NULL
    CHECK (longitude_sede BETWEEN -67 AND -59),
  access_directions VARCHAR(500) NULL,

  water_source VARCHAR(64) NULL
    CHECK (
      water_source IS NULL OR
      water_source IN (
        'poco_artesiano',
        'nascente_propria',
        'rio_corrego',
        'rede_tratada'
      )
    ),
  irrigation_system VARCHAR(64) NULL
    CHECK (
      irrigation_system IS NULL OR
      irrigation_system IN (
        'gotejamento',
        'microaspersao',
        'aspersao_convencional',
        'nenhum'
      )
    ),

  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (
      status IN ('draft','submitted','verified','rejected','suspended')
    ),
  wizard_current_step INTEGER NOT NULL DEFAULT 1
    CHECK (wizard_current_step BETWEEN 1 AND 5),
  revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision > 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT ck_app_properties_submission_complete CHECK (
    status = 'draft' OR (
      total_area_hectares IS NOT NULL AND
      cultivated_area_hectares IS NOT NULL AND
      water_source IS NOT NULL AND
      irrigation_system IS NOT NULL AND
      wizard_current_step = 5
    )
  )
);

CREATE TABLE public.app_property_boundaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL
    REFERENCES public.app_properties(id) ON DELETE CASCADE,
  boundary_type VARCHAR(32) NOT NULL
    CHECK (
      boundary_type IN (
        'perimeter',
        'cultivated_plot',
        'legal_reserve',
        'app_preservation'
      )
    ),
  polygon_geojson JSONB NOT NULL,
  calculated_area_ha NUMERIC(10,4) NULL
    CHECK (calculated_area_ha IS NULL OR calculated_area_ha >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_app_property_boundaries_geojson_polygon CHECK (
    jsonb_typeof(polygon_geojson) = 'object' AND
    polygon_geojson->>'type' = 'Polygon' AND
    jsonb_typeof(polygon_geojson->'coordinates') = 'array'
  )
);

CREATE TABLE public.app_rural_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL
    REFERENCES public.app_properties(id) ON DELETE CASCADE,
  activity_category VARCHAR(64) NOT NULL
    CHECK (
      activity_category IN (
        'hortalicas_folhosas',
        'legumes_picados',
        'frutas_tropicais',
        'ervas_temperos',
        'misto'
      )
    ),
  production_system VARCHAR(64) NOT NULL
    CHECK (
      production_system IN (
        'organico_certificado',
        'agroecologico_declarado',
        'hidroponia',
        'convencional_transicao'
      )
    ),
  has_washing_facility BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_app_rural_activities_property UNIQUE (property_id),
  CONSTRAINT ck_app_rural_activities_washing CHECK (
    activity_category <> 'legumes_picados' OR has_washing_facility = true
  )
);

CREATE INDEX ix_app_properties_producer
  ON public.app_properties(producer_id);

CREATE INDEX ix_app_properties_location
  ON public.app_properties(municipality, line_vicinal);

CREATE INDEX ix_app_property_boundaries_property
  ON public.app_property_boundaries(property_id);

CREATE INDEX ix_app_rural_activities_property
  ON public.app_rural_activities(property_id);

CREATE OR REPLACE FUNCTION public.trg_fn_t08_property_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_t08_property_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'verified' AND NEW.status = 'verified' AND (
    NEW.property_name IS DISTINCT FROM OLD.property_name OR
    NEW.registration_number IS DISTINCT FROM OLD.registration_number OR
    NEW.total_area_hectares IS DISTINCT FROM OLD.total_area_hectares OR
    NEW.cultivated_area_hectares IS DISTINCT FROM OLD.cultivated_area_hectares OR
    NEW.rural_zone_sector IS DISTINCT FROM OLD.rural_zone_sector OR
    NEW.line_vicinal IS DISTINCT FROM OLD.line_vicinal OR
    NEW.municipality IS DISTINCT FROM OLD.municipality OR
    NEW.state IS DISTINCT FROM OLD.state OR
    NEW.latitude_sede IS DISTINCT FROM OLD.latitude_sede OR
    NEW.longitude_sede IS DISTINCT FROM OLD.longitude_sede OR
    NEW.access_directions IS DISTINCT FROM OLD.access_directions OR
    NEW.water_source IS DISTINCT FROM OLD.water_source OR
    NEW.irrigation_system IS DISTINCT FROM OLD.irrigation_system
  ) THEN
    RAISE EXCEPTION 'VERIFIED_PROPERTY_REHOMOLOGATION_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft','submitted') THEN
    RAISE EXCEPTION 'INVALID_PROPERTY_STATUS_TRANSITION'
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'submitted' AND NEW.status NOT IN ('submitted','verified','rejected','suspended') THEN
    RAISE EXCEPTION 'INVALID_PROPERTY_STATUS_TRANSITION'
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'verified' AND NEW.status NOT IN ('verified','suspended') THEN
    RAISE EXCEPTION 'INVALID_PROPERTY_STATUS_TRANSITION'
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'rejected' AND NEW.status NOT IN ('rejected','draft') THEN
    RAISE EXCEPTION 'INVALID_PROPERTY_STATUS_TRANSITION'
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'suspended' AND NEW.status NOT IN ('suspended','draft') THEN
    RAISE EXCEPTION 'INVALID_PROPERTY_STATUS_TRANSITION'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_app_properties_status_guard
BEFORE UPDATE ON public.app_properties
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_t08_property_status_guard();

CREATE TRIGGER trg_app_properties_revision
BEFORE UPDATE ON public.app_properties
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_t08_property_revision();

ALTER TABLE public.app_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_properties FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_property_boundaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_property_boundaries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_rural_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_rural_activities FORCE ROW LEVEL SECURITY;

CREATE POLICY properties_self_read
ON public.app_properties
FOR SELECT TO authenticated
USING (
  producer_id IN (
    SELECT pp.id
    FROM public.app_producer_profiles pp
    WHERE pp.person_id = public.current_person_id()
  )
);

CREATE POLICY properties_admin_read
ON public.app_properties
FOR SELECT TO authenticated
USING (public.is_any_platform_admin());

CREATE POLICY properties_backend_insert
ON public.app_properties
FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY properties_backend_update
ON public.app_properties
FOR UPDATE TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY properties_backend_delete
ON public.app_properties
FOR DELETE TO authenticated
USING (false);

CREATE POLICY property_boundaries_self_read
ON public.app_property_boundaries
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.app_properties p
    JOIN public.app_producer_profiles pp ON pp.id = p.producer_id
    WHERE p.id = property_id
      AND pp.person_id = public.current_person_id()
  )
);

CREATE POLICY property_boundaries_admin_read
ON public.app_property_boundaries
FOR SELECT TO authenticated
USING (public.is_any_platform_admin());

CREATE POLICY property_boundaries_backend_insert
ON public.app_property_boundaries
FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY property_boundaries_backend_update
ON public.app_property_boundaries
FOR UPDATE TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY property_boundaries_backend_delete
ON public.app_property_boundaries
FOR DELETE TO authenticated
USING (false);

CREATE POLICY rural_activities_self_read
ON public.app_rural_activities
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.app_properties p
    JOIN public.app_producer_profiles pp ON pp.id = p.producer_id
    WHERE p.id = property_id
      AND pp.person_id = public.current_person_id()
  )
);

CREATE POLICY rural_activities_admin_read
ON public.app_rural_activities
FOR SELECT TO authenticated
USING (public.is_any_platform_admin());

CREATE POLICY rural_activities_backend_insert
ON public.app_rural_activities
FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY rural_activities_backend_update
ON public.app_rural_activities
FOR UPDATE TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY rural_activities_backend_delete
ON public.app_rural_activities
FOR DELETE TO authenticated
USING (false);

REVOKE ALL ON public.app_properties FROM anon;
REVOKE ALL ON public.app_property_boundaries FROM anon;
REVOKE ALL ON public.app_rural_activities FROM anon;

REVOKE INSERT, UPDATE, DELETE
  ON public.app_properties,
     public.app_property_boundaries,
     public.app_rural_activities
  FROM authenticated;

GRANT SELECT
  ON public.app_properties,
     public.app_property_boundaries,
     public.app_rural_activities
  TO authenticated;

COMMENT ON TABLE public.app_properties IS
'Imóveis rurais produtivos do produtor. Entidade independente de app_user_addresses.';
COMMENT ON COLUMN public.app_producer_profiles.property_name IS
'Nome de seu imóvel informado no cadastro inicial do produtor. Não substitui app_properties.property_name.';
COMMENT ON COLUMN public.app_properties.property_name IS
'Nome específico da propriedade/chácara cadastrada no onboarding rural T08.';
COMMENT ON COLUMN public.app_properties.access_directions IS
'Orientações de acesso rural, como linha vicinal, porteira e referências.';
COMMENT ON TABLE public.app_property_boundaries IS
'Polígonos GeoJSON do imóvel rural, sem dependência de PostGIS.';
COMMENT ON TABLE public.app_rural_activities IS
'Atividade produtiva principal e condições de processamento do imóvel rural.';
COMMENT ON FUNCTION public.trg_fn_t08_property_revision() IS
'Incrementa revision e updated_at em alterações do imóvel rural.';
COMMENT ON FUNCTION public.trg_fn_t08_property_status_guard() IS
'Aplica a FSM de status e impede sobrescrita direta de imóvel verificado.';
