-- T11 — reabre o mesmo imóvel na fila e registra pedido de ajustes.

ALTER TABLE public.app_verification_requests
  DROP CONSTRAINT IF EXISTS app_verification_requests_status_check;

ALTER TABLE public.app_verification_requests
  ADD CONSTRAINT app_verification_requests_status_check
  CHECK (status IN (
    'pending',
    'claimed',
    'in_review',
    'approved',
    'rejected',
    'adjustments_required',
    'escalated'
  ));

CREATE OR REPLACE FUNCTION public.enqueue_verification_on_submit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  latest_id uuid;
  latest_status varchar(32);
BEGIN
  IF NEW.status = 'submitted' AND (OLD.status IS DISTINCT FROM 'submitted') THEN
    SELECT id, status
      INTO latest_id, latest_status
      FROM public.app_verification_requests
     WHERE property_id = NEW.id
     ORDER BY created_at DESC
     LIMIT 1;

    IF latest_id IS NOT NULL AND latest_status IN ('approved', 'rejected', 'adjustments_required', 'escalated') THEN
      UPDATE public.app_verification_requests
         SET status = 'pending',
             claimed_by = NULL,
             claimed_at = NULL,
             updated_at = clock_timestamp()
       WHERE id = latest_id;
    ELSIF latest_id IS NULL OR latest_status NOT IN ('pending', 'claimed', 'in_review') THEN
      INSERT INTO public.app_verification_requests(property_id, producer_id, status, priority)
      VALUES (NEW.id, NEW.producer_id, 'pending', 0);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
