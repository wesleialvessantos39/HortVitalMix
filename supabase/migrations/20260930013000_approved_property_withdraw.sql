-- Imóvel aprovado não volta para rascunho. A exclusão do produtor grava withdrawn
-- e preserva os documentos. Não apaga extrações.

ALTER TABLE public.app_properties DROP CONSTRAINT IF EXISTS app_properties_status_check;
ALTER TABLE public.app_properties ADD CONSTRAINT app_properties_status_check
  CHECK (status IN ('draft','completed','submitted','verified','rejected','suspended','withdrawn'));

CREATE OR REPLACE FUNCTION public.trg_fn_t08_property_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.completed_at IS NOT NULL OR OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'COMPLETED_PROPERTY_DELETE_FORBIDDEN' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.completed_at IS NOT NULL THEN
    NEW.completed_at := OLD.completed_at;
  END IF;
  IF NEW.status IN ('completed','submitted','verified','rejected','suspended','withdrawn') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, clock_timestamp());
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('completed','submitted')) OR
    (OLD.status = 'completed' AND NEW.status IN ('draft','submitted')) OR
    (OLD.status = 'submitted' AND NEW.status IN ('draft','verified','rejected','suspended')) OR
    (OLD.status = 'verified' AND NEW.status IN ('withdrawn','suspended')) OR
    (OLD.status = 'rejected' AND NEW.status IN ('draft','suspended')) OR
    (OLD.status = 'suspended' AND NEW.status = 'draft') OR
    (OLD.status = 'withdrawn' AND NEW.status = 'withdrawn')
  ) THEN
    RAISE EXCEPTION 'INVALID_PROPERTY_STATUS_TRANSITION' USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'verified' AND NEW.status = 'verified' AND
    (to_jsonb(NEW) - 'revision' - 'updated_at' - 'completed_at')
      IS DISTINCT FROM
    (to_jsonb(OLD) - 'revision' - 'updated_at' - 'completed_at') THEN
    RAISE EXCEPTION 'VERIFIED_PROPERTY_REHOMOLOGATION_REQUIRED' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_fn_t08_property_status_guard() IS
  'Imóvel aprovado não volta para rascunho. A exclusão do produtor grava withdrawn e preserva os documentos.';
