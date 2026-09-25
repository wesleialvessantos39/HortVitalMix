-- HortiVitalMix — Manual Mestre Técnico v11 — Trilha 06
-- Perfil canônico, endereços residenciais e privacidade LGPD.
-- Migration aditiva: preserva integralmente identidade, autenticação e governança T01–T05.

CREATE TABLE IF NOT EXISTS public.app_user_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.app_people(id) ON DELETE CASCADE,
  label varchar(64) NOT NULL DEFAULT 'Casa' CHECK (length(trim(label)) >= 1),
  cep char(8) NOT NULL CHECK (cep ~ '^[0-9]{8}$'),
  street varchar(255) NOT NULL CHECK (length(trim(street)) >= 2),
  number varchar(32) NOT NULL DEFAULT 'S/N' CHECK (length(trim(number)) >= 1),
  complement varchar(128) NULL,
  neighborhood varchar(128) NOT NULL CHECK (length(trim(neighborhood)) >= 2),
  city varchar(100) NOT NULL CHECK (length(trim(city)) >= 2),
  state char(2) NOT NULL CHECK (state IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  country char(2) NOT NULL DEFAULT 'BR' CHECK (country='BR'),
  is_default boolean NOT NULL DEFAULT false,
  fingerprint_sha256 char(64) NOT NULL CHECK (fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_addresses_default
  ON public.app_user_addresses(person_id) WHERE is_default=true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_addresses_fingerprint
  ON public.app_user_addresses(person_id,fingerprint_sha256);
CREATE INDEX IF NOT EXISTS ix_app_user_addresses_person_created
  ON public.app_user_addresses(person_id,created_at);

CREATE TABLE IF NOT EXISTS public.app_user_preferences (
  person_id uuid PRIMARY KEY REFERENCES public.app_people(id) ON DELETE CASCADE,
  marketing_consent boolean NOT NULL DEFAULT false,
  order_updates_channel varchar(16) NOT NULL DEFAULT 'both'
    CHECK (order_updates_channel IN ('email','sms','both')),
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start time NULL,
  quiet_hours_end time NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_quiet_hours CHECK (
    quiet_hours_enabled=false OR
    (quiet_hours_enabled=true AND quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.app_consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.app_people(id) ON DELETE CASCADE,
  consent_type varchar(64) NOT NULL CHECK (consent_type ~ '^[a-z][a-z0-9\-_]{2,63}$'),
  is_granted boolean NOT NULL,
  policy_version varchar(32) NOT NULL CHECK (length(trim(policy_version)) >= 3),
  ip_hash char(64) NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent varchar(255) NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_app_consent_records_person_time
  ON public.app_consent_records(person_id,registered_at DESC);

CREATE OR REPLACE FUNCTION public.trg_fn_t06_touch_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_user_addresses_touch ON public.app_user_addresses;
CREATE TRIGGER trg_app_user_addresses_touch
BEFORE UPDATE ON public.app_user_addresses
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_t06_touch_revision();

DROP TRIGGER IF EXISTS trg_app_user_preferences_touch ON public.app_user_preferences;
CREATE TRIGGER trg_app_user_preferences_touch
BEFORE UPDATE ON public.app_user_preferences
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_t06_touch_revision();

DROP TRIGGER IF EXISTS trg_app_consent_records_immutable ON public.app_consent_records;
CREATE TRIGGER trg_app_consent_records_immutable
BEFORE UPDATE OR DELETE ON public.app_consent_records
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_prevent_audit_tampering();

ALTER TABLE public.app_user_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_user_addresses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_user_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_consent_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS addresses_self_read ON public.app_user_addresses;
CREATE POLICY addresses_self_read ON public.app_user_addresses
FOR SELECT TO authenticated USING (person_id=public.current_person_id());

DROP POLICY IF EXISTS addresses_self_write ON public.app_user_addresses;
CREATE POLICY addresses_self_write ON public.app_user_addresses
FOR ALL TO authenticated
USING (person_id=public.current_person_id())
WITH CHECK (person_id=public.current_person_id());

DROP POLICY IF EXISTS preferences_self_read ON public.app_user_preferences;
CREATE POLICY preferences_self_read ON public.app_user_preferences
FOR SELECT TO authenticated USING (person_id=public.current_person_id());

DROP POLICY IF EXISTS preferences_self_write ON public.app_user_preferences;
CREATE POLICY preferences_self_write ON public.app_user_preferences
FOR ALL TO authenticated
USING (person_id=public.current_person_id())
WITH CHECK (person_id=public.current_person_id());

DROP POLICY IF EXISTS consents_self_read ON public.app_consent_records;
CREATE POLICY consents_self_read ON public.app_consent_records
FOR SELECT TO authenticated USING (person_id=public.current_person_id());

DROP POLICY IF EXISTS consents_self_insert ON public.app_consent_records;
CREATE POLICY consents_self_insert ON public.app_consent_records
FOR INSERT TO authenticated WITH CHECK (person_id=public.current_person_id());

GRANT SELECT,INSERT,UPDATE,DELETE ON public.app_user_addresses TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.app_user_preferences TO authenticated;
GRANT SELECT,INSERT ON public.app_consent_records TO authenticated;
GRANT ALL ON public.app_user_addresses,public.app_user_preferences,public.app_consent_records TO service_role;

COMMENT ON TABLE public.app_user_addresses IS 'Endereços residenciais/urbanos de entrega. Estritamente separados de imóveis rurais app_properties.';
COMMENT ON TABLE public.app_user_preferences IS 'Preferências operacionais, marketing e horário de silêncio do titular.';
COMMENT ON TABLE public.app_consent_records IS 'Histórico LGPD append-only, versionado e imutável por trigger.';
