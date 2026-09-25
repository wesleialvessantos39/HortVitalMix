-- HortiVitalMix — Múltiplos endereços urbanos, geocodificação assistiva e lifecycle seguro.
-- Evolução estritamente aditiva sobre app_user_addresses. Não cria app_orders,
-- app_properties, buckets, PostGIS ou qualquer dependência paga.

ALTER TABLE public.app_user_addresses
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7) NULL,
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7) NULL,
  ADD COLUMN IF NOT EXISTS geocoding_accuracy VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS delivery_notes VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_app_user_addresses_latitude'
      AND conrelid = 'public.app_user_addresses'::regclass
  ) THEN
    ALTER TABLE public.app_user_addresses
      ADD CONSTRAINT ck_app_user_addresses_latitude
      CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_app_user_addresses_longitude'
      AND conrelid = 'public.app_user_addresses'::regclass
  ) THEN
    ALTER TABLE public.app_user_addresses
      ADD CONSTRAINT ck_app_user_addresses_longitude
      CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_app_user_addresses_geocoding_accuracy'
      AND conrelid = 'public.app_user_addresses'::regclass
  ) THEN
    ALTER TABLE public.app_user_addresses
      ADD CONSTRAINT ck_app_user_addresses_geocoding_accuracy
      CHECK (
        geocoding_accuracy IS NULL OR
        geocoding_accuracy IN ('rooftop','street','neighborhood','manual','none')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_app_user_addresses_default_active'
      AND conrelid = 'public.app_user_addresses'::regclass
  ) THEN
    ALTER TABLE public.app_user_addresses
      ADD CONSTRAINT ck_app_user_addresses_default_active
      CHECK (NOT is_default OR is_active);
  END IF;
END $$;

DROP INDEX IF EXISTS public.uq_app_user_addresses_default;
CREATE UNIQUE INDEX uq_app_user_addresses_default
  ON public.app_user_addresses(person_id)
  WHERE is_default = true AND is_active = true;

CREATE INDEX IF NOT EXISTS ix_app_user_addresses_checkout
  ON public.app_user_addresses(
    person_id,
    is_active,
    last_used_at DESC NULLS LAST,
    created_at ASC
  );

CREATE OR REPLACE FUNCTION public.trg_fn_enforce_user_address_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  active_count integer;
BEGIN
  IF NEW.is_active = true THEN
    SELECT count(*) INTO active_count
    FROM public.app_user_addresses
    WHERE person_id = NEW.person_id
      AND is_active = true
      AND id <> COALESCE(
        NEW.id,
        '00000000-0000-0000-0000-000000000000'::uuid
      );

    IF active_count >= 10 THEN
      RAISE EXCEPTION
        'LIMIT_EXCEEDED: Limite máximo de 10 endereços ativos atingido.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_user_addresses_limit
  ON public.app_user_addresses;
CREATE TRIGGER trg_app_user_addresses_limit
BEFORE INSERT OR UPDATE OF is_active ON public.app_user_addresses
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_enforce_user_address_limit();

-- Preserva fingerprint/touch da T06 e ajusta apenas a eleição do primeiro
-- endereço para considerar o conjunto ATIVO.
CREATE OR REPLACE FUNCTION public.trg_fn_t06_touch_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  normalized text;
BEGIN
  normalized :=
    lower(regexp_replace(trim(NEW.cep), '[[:space:]]+', ' ', 'g')) || '|' ||
    lower(regexp_replace(trim(NEW.street), '[[:space:]]+', ' ', 'g')) || '|' ||
    lower(regexp_replace(trim(NEW.number), '[[:space:]]+', ' ', 'g')) || '|' ||
    lower(regexp_replace(trim(coalesce(NEW.complement,'')), '[[:space:]]+', ' ', 'g')) || '|' ||
    lower(regexp_replace(trim(NEW.neighborhood), '[[:space:]]+', ' ', 'g')) || '|' ||
    lower(regexp_replace(trim(NEW.city), '[[:space:]]+', ' ', 'g')) || '|' ||
    lower(trim(NEW.state));

  NEW.fingerprint_sha256 :=
    encode(extensions.digest(normalized, 'sha256'), 'hex');

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_active = true
       AND NOT EXISTS (
         SELECT 1
         FROM public.app_user_addresses
         WHERE person_id = NEW.person_id
           AND is_active = true
       ) THEN
      NEW.is_default := true;
    END IF;
  ELSE
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := clock_timestamp();
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.app_user_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_user_addresses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS addresses_self_read ON public.app_user_addresses;
DROP POLICY IF EXISTS addresses_self_insert ON public.app_user_addresses;
DROP POLICY IF EXISTS addresses_self_update ON public.app_user_addresses;
DROP POLICY IF EXISTS addresses_self_delete ON public.app_user_addresses;
DROP POLICY IF EXISTS addresses_backend_insert ON public.app_user_addresses;
DROP POLICY IF EXISTS addresses_backend_update ON public.app_user_addresses;
DROP POLICY IF EXISTS addresses_backend_delete ON public.app_user_addresses;

CREATE POLICY addresses_self_read
ON public.app_user_addresses
FOR SELECT TO authenticated
USING (person_id = public.current_person_id());

CREATE POLICY addresses_backend_insert
ON public.app_user_addresses
FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY addresses_backend_update
ON public.app_user_addresses
FOR UPDATE TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY addresses_backend_delete
ON public.app_user_addresses
FOR DELETE TO authenticated
USING (false);

REVOKE ALL ON public.app_user_addresses FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.app_user_addresses FROM authenticated;
GRANT SELECT ON public.app_user_addresses TO authenticated;

COMMENT ON COLUMN public.app_user_addresses.delivery_notes IS
'Instruções privadas de entrega do titular, protegidas por RLS.';
COMMENT ON COLUMN public.app_user_addresses.last_used_at IS
'Recência logística para ordenação futura de checkout.';
COMMENT ON FUNCTION public.trg_fn_enforce_user_address_limit() IS
'Limita cada pessoa a no máximo 10 endereços urbanos ativos.';
