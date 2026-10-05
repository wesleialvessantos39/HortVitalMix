-- T16 is additive: no changes to T01–T15 tables, triggers, policies or grants.
-- Stable haversine preserves zero and short distances; no PostGIS or external API.
CREATE FUNCTION public.fn_haversine_km(lat1 NUMERIC, lon1 NUMERIC, lat2 NUMERIC, lon2 NUMERIC)
RETURNS NUMERIC LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog AS $$
  SELECT (12742 * asin(sqrt(least(1.0, greatest(0.0,
    power(sin(radians((lat2-lat1)::double precision)/2),2)
    + cos(radians(lat1::double precision))*cos(radians(lat2::double precision))
    * power(sin(radians((lon2-lon1)::double precision)/2),2)
  )))))::numeric
$$;
REVOKE ALL ON FUNCTION public.fn_haversine_km(NUMERIC,NUMERIC,NUMERIC,NUMERIC) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_haversine_km(NUMERIC,NUMERIC,NUMERIC,NUMERIC) TO service_role;

CREATE TABLE public.app_service_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL UNIQUE REFERENCES public.app_producer_stores(id) ON DELETE CASCADE,
  origin_property_id UUID NOT NULL REFERENCES public.app_properties(id) ON DELETE CASCADE,
  radius_km NUMERIC(6,2) NOT NULL CHECK (radius_km >= 1 AND radius_km <= 150),
  center_latitude NUMERIC(10,8) NOT NULL CHECK (center_latitude BETWEEN -90 AND 90),
  center_longitude NUMERIC(11,8) NOT NULL CHECK (center_longitude BETWEEN -180 AND 180),
  is_active BOOLEAN NOT NULL DEFAULT true,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_service_area_origin ON public.app_service_areas(origin_property_id);

CREATE TABLE public.app_delivery_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL UNIQUE REFERENCES public.app_producer_stores(id) ON DELETE CASCADE,
  base_fee_cents INTEGER NOT NULL DEFAULT 500 CHECK (base_fee_cents >= 0),
  fee_per_km_cents INTEGER NOT NULL DEFAULT 100 CHECK (fee_per_km_cents >= 0),
  min_order_cents INTEGER NOT NULL DEFAULT 2000 CHECK (min_order_cents >= 0),
  free_delivery_threshold_cents INTEGER NULL CHECK (free_delivery_threshold_cents > 0),
  estimated_prep_hours INTEGER NOT NULL DEFAULT 4 CHECK (estimated_prep_hours > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.app_delivery_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.app_producer_stores(id) ON DELETE CASCADE,
  destination_address_id UUID NOT NULL REFERENCES public.app_user_addresses(id) ON DELETE CASCADE,
  origin_property_id UUID NOT NULL REFERENCES public.app_properties(id) ON DELETE CASCADE,
  configuration_fingerprint CHAR(64) NOT NULL CHECK (configuration_fingerprint ~ '^[0-9a-f]{64}$'),
  destination_latitude NUMERIC(10,8) NOT NULL CHECK (destination_latitude BETWEEN -90 AND 90),
  destination_longitude NUMERIC(11,8) NOT NULL CHECK (destination_longitude BETWEEN -180 AND 180),
  destination_revision INTEGER NOT NULL CHECK (destination_revision > 0),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  distance_km NUMERIC(8,2) NOT NULL CHECK (distance_km >= 0 AND distance_km <= 20016),
  fee_cents INTEGER NOT NULL CHECK (fee_cents >= 0),
  min_order_cents INTEGER NOT NULL CHECK (min_order_cents >= 0),
  is_eligible BOOLEAN NOT NULL,
  ineligibility_reason VARCHAR(128) NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes'),
  CHECK ((is_eligible AND ineligibility_reason IS NULL) OR
    (NOT is_eligible AND ineligibility_reason IS NOT NULL AND ineligibility_reason = 'fora_da_area_de_entrega'))
);
CREATE INDEX ix_delivery_quotes_store ON public.app_delivery_quotes(store_id);
CREATE INDEX ix_delivery_quotes_owner_address ON public.app_delivery_quotes(destination_address_id);
CREATE INDEX ix_delivery_quotes_origin ON public.app_delivery_quotes(origin_property_id);
CREATE INDEX ix_delivery_quotes_expiry ON public.app_delivery_quotes(expires_at);

ALTER TABLE public.app_service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_service_areas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_delivery_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_delivery_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_delivery_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_delivery_quotes FORCE ROW LEVEL SECURITY;
-- Supabase default grants may include TRUNCATE/REFERENCES/TRIGGER; clear them too.
REVOKE ALL ON public.app_service_areas,public.app_delivery_rules,public.app_delivery_quotes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.app_service_areas,public.app_delivery_rules TO service_role;
GRANT SELECT,INSERT ON public.app_delivery_quotes TO service_role;
GRANT SELECT ON public.app_delivery_quotes TO authenticated;
CREATE POLICY quote_owner_read ON public.app_delivery_quotes FOR SELECT TO authenticated USING (
  destination_address_id IN (SELECT id FROM public.app_user_addresses WHERE person_id=(SELECT public.current_person_id()))
);
COMMENT ON TABLE public.app_service_areas IS 'T16: círculo geodésico privado por loja, centrado somente na sede GPS T08; não substitui cobertura municipal T12.';
COMMENT ON TABLE public.app_delivery_rules IS 'T16: tarifas em centavos e prazo de preparo; mutações exclusivamente pelo backend.';
COMMENT ON TABLE public.app_delivery_quotes IS 'T16: cotação privada com TTL 15 min; distância integral decide elegibilidade, valor exibido com 2 casas. CASCADE preserva exclusões T06/T07/T08/T12.';
