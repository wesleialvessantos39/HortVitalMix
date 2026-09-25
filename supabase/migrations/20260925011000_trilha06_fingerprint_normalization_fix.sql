-- HortiVitalMix — T06 homologação: correção canônica do fingerprint
-- PostgreSQL usa classe POSIX para colapsar qualquer whitespace de forma
-- determinística antes do SHA-256.

CREATE OR REPLACE FUNCTION public.trg_fn_t06_touch_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,extensions
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
    IF NOT EXISTS (
      SELECT 1
      FROM public.app_user_addresses
      WHERE person_id=NEW.person_id
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

COMMENT ON FUNCTION public.trg_fn_t06_touch_address() IS
'T06 v11: fingerprint normalizado por trim + whitespace POSIX + lowercase, SHA-256, primeiro endereço padrão e bump de revisão.';
