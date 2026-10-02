-- Deleting an editable draft removes its operational evidence and queues
-- private-storage objects for compensating cleanup.

CREATE TABLE public.app_property_document_storage_cleanup (
  storage_path text PRIMARY KEY
    CHECK (storage_path LIKE 'properties/%'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at timestamptz,
  first_removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.app_property_document_storage_cleanup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_property_document_storage_cleanup FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_property_document_storage_cleanup FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.app_property_document_storage_cleanup TO service_role;

ALTER TABLE public.app_documents
  DROP CONSTRAINT IF EXISTS fk_document_property_producer,
  ADD CONSTRAINT fk_document_property_producer
    FOREIGN KEY (property_id, producer_id)
    REFERENCES public.app_properties(id, producer_id) ON DELETE CASCADE;

ALTER TABLE public.app_document_extractions
  DROP CONSTRAINT IF EXISTS app_document_extractions_document_id_fkey,
  ADD CONSTRAINT app_document_extractions_document_id_fkey
    FOREIGN KEY (document_id) REFERENCES public.app_documents(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS app_document_extractions_property_id_fkey,
  ADD CONSTRAINT app_document_extractions_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES public.app_properties(id) ON DELETE CASCADE;

ALTER TABLE public.app_car_validations
  DROP CONSTRAINT IF EXISTS app_car_validations_extraction_id_fkey,
  ADD CONSTRAINT app_car_validations_extraction_id_fkey
    FOREIGN KEY (extraction_id) REFERENCES public.app_document_extractions(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS app_car_validations_property_id_fkey,
  ADD CONSTRAINT app_car_validations_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES public.app_properties(id) ON DELETE CASCADE;

ALTER TABLE public.app_document_jobs
  DROP CONSTRAINT IF EXISTS app_document_jobs_document_id_fkey,
  ADD CONSTRAINT app_document_jobs_document_id_fkey
    FOREIGN KEY (document_id) REFERENCES public.app_documents(id) ON DELETE CASCADE;

ALTER TABLE public.app_document_reviews
  DROP CONSTRAINT IF EXISTS app_document_reviews_extraction_id_fkey,
  ADD CONSTRAINT app_document_reviews_extraction_id_fkey
    FOREIGN KEY (extraction_id) REFERENCES public.app_document_extractions(id) ON DELETE CASCADE;

CREATE FUNCTION public.mark_draft_property_document_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.status = 'draft' AND OLD.completed_at IS NULL THEN
    PERFORM set_config('app.draft_property_document_cleanup', OLD.id::text, true);
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_a_app_properties_document_cleanup
BEFORE DELETE ON public.app_properties
FOR EACH ROW EXECUTE FUNCTION public.mark_draft_property_document_cleanup();
REVOKE ALL ON FUNCTION public.mark_draft_property_document_cleanup() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_document_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_trigger_depth() > 1
     AND current_setting('app.draft_property_document_cleanup', true) IS NOT NULL THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'DOCUMENT_EVIDENCE_IMMUTABLE';
END;
$$;

COMMENT ON FUNCTION public.protect_document_evidence() IS
  'Impede alterações diretas à custódia; permite somente a remoção em cascata de evidência operacional de um rascunho apagado.';
