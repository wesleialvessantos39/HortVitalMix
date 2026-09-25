-- HortiVitalMix — T06 homologação/hardening sem recurso pago
-- Mantém as 3 tabelas e 3 triggers do Manual v11, reforçando fingerprint,
-- primeiro endereço padrão e mutações exclusivamente pelo backend auditado.

CREATE OR REPLACE FUNCTION public.trg_fn_t06_touch_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,extensions
AS $$
DECLARE
  normalized text;
BEGIN
  normalized :=
    lower(regexp_replace(trim(NEW.cep), '\\s+', ' ', 'g')) || '|' ||
    lower(regexp_replace(trim(NEW.street), '\\s+', ' ', 'g')) || '|' ||
    lower(regexp_replace(trim(NEW.number), '\\s+', ' ', 'g')) || '|' ||
    lower(regexp_replace(trim(coalesce(NEW.complement,'')), '\\s+', ' ', 'g')) || '|' ||
    lower(regexp_replace(trim(NEW.neighborhood), '\\s+', ' ', 'g')) || '|' ||
    lower(regexp_replace(trim(NEW.city), '\\s+', ' ', 'g')) || '|' ||
    lower(trim(NEW.state));

  NEW.fingerprint_sha256 := encode(extensions.digest(normalized, 'sha256'), 'hex');

  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.app_user_addresses
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

DROP TRIGGER IF EXISTS trg_app_user_addresses_touch ON public.app_user_addresses;
CREATE TRIGGER trg_app_user_addresses_touch
BEFORE INSERT OR UPDATE ON public.app_user_addresses
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_t06_touch_address();

-- O frontend usa as rotas canônicas do backend. Escritas Data API diretas
-- bypassariam commandId/auditoria; por isso permanecem bloqueadas por GRANT.
REVOKE INSERT, UPDATE, DELETE ON public.app_user_addresses FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.app_user_preferences FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.app_consent_records FROM authenticated;

GRANT SELECT ON public.app_user_addresses TO authenticated;
GRANT SELECT ON public.app_user_preferences TO authenticated;
GRANT SELECT ON public.app_consent_records TO authenticated;

COMMENT ON FUNCTION public.trg_fn_t06_touch_address() IS
'T06 v11: fingerprint SHA-256 canônico no banco, primeiro endereço padrão e bump de revisão.';
