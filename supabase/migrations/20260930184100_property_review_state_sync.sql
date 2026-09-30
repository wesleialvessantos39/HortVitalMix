-- Sincronização canônica entre o estado do imóvel e a auditoria.
-- Nunca reabre uma decisão terminal: um novo envio cria nova solicitação.
-- O produtor e a auditoria passam a ler o mesmo estado atual do banco.

CREATE OR REPLACE FUNCTION public.enqueue_verification_on_submit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_open_id uuid;
  v_new_id uuid;
BEGIN
  IF NEW.status = 'submitted' AND (OLD.status IS DISTINCT FROM 'submitted') THEN
    SELECT id
      INTO v_open_id
      FROM public.app_verification_requests
     WHERE property_id = NEW.id
       AND superseded_at IS NULL
       AND status IN ('pending','claimed','in_review')
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_open_id IS NULL THEN
      INSERT INTO public.app_verification_requests(property_id, producer_id, status, priority)
      VALUES (NEW.id, NEW.producer_id, 'pending', 0)
      RETURNING id INTO v_new_id;

      UPDATE public.app_verification_requests
         SET superseded_at = COALESCE(superseded_at, clock_timestamp()),
             superseded_by_request_id = v_new_id,
             updated_at = clock_timestamp()
       WHERE property_id = NEW.id
         AND id <> v_new_id
         AND superseded_at IS NULL
         AND status IN ('approved','rejected','adjustments_required','escalated');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_verification_on_submit()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_verification_on_submit()
  TO service_role;

CREATE OR REPLACE FUNCTION public.trg_fn_property_verification_visibility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('withdrawn','suspended')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.app_verification_requests
       SET superseded_at = COALESCE(superseded_at, clock_timestamp()),
           superseded_by_request_id = NULL,
           updated_at = clock_timestamp()
     WHERE property_id = NEW.id
       AND status = 'approved'
       AND superseded_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_property_verification_visibility ON public.app_properties;
CREATE TRIGGER trg_property_verification_visibility
AFTER UPDATE OF status ON public.app_properties
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_property_verification_visibility();

UPDATE public.app_verification_requests r
   SET superseded_at = COALESCE(r.superseded_at, clock_timestamp()),
       superseded_by_request_id = NULL,
       updated_at = clock_timestamp()
  FROM public.app_properties p
 WHERE p.id = r.property_id
   AND p.status IN ('withdrawn','suspended')
   AND r.status = 'approved'
   AND r.superseded_at IS NULL;

WITH open_request AS (
  SELECT DISTINCT ON (property_id)
         property_id, id
    FROM public.app_verification_requests
   WHERE superseded_at IS NULL
     AND status IN ('pending','claimed','in_review')
   ORDER BY property_id, created_at DESC, id DESC
)
UPDATE public.app_verification_requests r
   SET superseded_at = COALESCE(r.superseded_at, clock_timestamp()),
       superseded_by_request_id = o.id,
       updated_at = clock_timestamp()
  FROM open_request o
 WHERE r.property_id = o.property_id
   AND r.id <> o.id
   AND r.superseded_at IS NULL
   AND r.status IN ('approved','rejected','adjustments_required','escalated');

CREATE OR REPLACE VIEW public.app_property_current_verification AS
SELECT
  p.id AS property_id,
  cur.id AS request_id,
  cur.status AS queue_status,
  cur.archived_at,
  cur.created_at AS request_created_at,
  cur.updated_at AS request_updated_at,
  dec.decision AS review_decision,
  dec.technical_opinion AS review_opinion,
  dec.decided_at,
  prev_dec.decision AS previous_review_decision,
  prev_dec.technical_opinion AS previous_review_opinion,
  prev_dec.decided_at AS previous_decided_at
FROM public.app_properties p
LEFT JOIN LATERAL (
  SELECT r.*
    FROM public.app_verification_requests r
   WHERE r.property_id = p.id
     AND r.superseded_at IS NULL
     AND (
       (p.status = 'verified' AND r.status = 'approved')
       OR
       (p.status IN ('draft','completed','submitted')
        AND r.status IN ('pending','claimed','in_review'))
       OR
       (p.status IN ('draft','completed','rejected')
        AND r.status IN ('rejected','adjustments_required','escalated'))
     )
   ORDER BY
     CASE
       WHEN p.status = 'verified' AND r.status = 'approved' THEN 0
       WHEN r.status IN ('pending','claimed','in_review') THEN 1
       ELSE 2
     END,
     COALESCE(r.archived_at, r.updated_at, r.created_at) DESC,
     r.id DESC
   LIMIT 1
) cur ON true
LEFT JOIN LATERAL (
  SELECT d.decision, d.technical_opinion, d.decided_at
    FROM public.app_verification_decisions d
   WHERE d.request_id = cur.id
   ORDER BY d.decided_at DESC
   LIMIT 1
) dec ON true
LEFT JOIN LATERAL (
  SELECT d.decision, d.technical_opinion, d.decided_at
    FROM public.app_verification_requests r
    JOIN public.app_verification_decisions d ON d.request_id = r.id
   WHERE r.property_id = p.id
     AND r.id IS DISTINCT FROM cur.id
     AND r.status IN ('approved','rejected','adjustments_required','escalated')
   ORDER BY COALESCE(r.superseded_at, r.updated_at, r.created_at) DESC,
            d.decided_at DESC
   LIMIT 1
) prev_dec ON true;

REVOKE ALL ON public.app_property_current_verification
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_property_current_verification TO service_role;

COMMENT ON VIEW public.app_property_current_verification IS
  'Estado canônico atual da auditoria por imóvel. O status do imóvel define qual solicitação não superseded é atual; decisões antigas permanecem somente como histórico.';
