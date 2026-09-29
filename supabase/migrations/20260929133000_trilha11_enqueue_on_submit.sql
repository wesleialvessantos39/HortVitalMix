-- T11 — enfileira auditoria humana ao mudar o imóvel para submitted.

CREATE OR REPLACE FUNCTION public.enqueue_verification_on_submit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NEW.status = 'submitted' AND (OLD.status IS DISTINCT FROM 'submitted') THEN
    INSERT INTO public.app_verification_requests(property_id, producer_id, status, priority)
    SELECT NEW.id, NEW.producer_id, 'pending', 0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.app_verification_requests
      WHERE property_id = NEW.id AND status IN ('pending', 'claimed', 'in_review')
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_verification_on_submit ON public.app_properties;
CREATE TRIGGER trg_enqueue_verification_on_submit
AFTER UPDATE OF status ON public.app_properties
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_verification_on_submit();
