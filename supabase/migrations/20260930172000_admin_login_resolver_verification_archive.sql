-- Login administrativo canônico pelo Supabase + arquivo de imóveis aprovados.
-- O banco passa a resolver os e-mails válidos do principal administrativo e
-- a guardar, de forma explícita, quais decisões ficaram arquivadas/superseded.

CREATE OR REPLACE VIEW public.app_admin_login_resolver AS
SELECT
  ap.admin_email AS login_email,
  ap.admin_user_id,
  ap.email_verified_at,
  ap.portal_role,
  ap.auth_email,
  'admin_email'::text AS alias_kind
FROM public.app_admin_principals ap
UNION ALL
SELECT
  lower(trim(p.email_normalized)) AS login_email,
  ap.admin_user_id,
  ap.email_verified_at,
  ap.portal_role,
  ap.auth_email,
  'linked_person_email'::text AS alias_kind
FROM public.app_admin_principals ap
JOIN public.app_people p ON p.id = ap.person_id
WHERE p.email_normalized IS NOT NULL
  AND length(trim(p.email_normalized)) > 3
  AND lower(trim(p.email_normalized)) <> ap.admin_email;

REVOKE ALL ON public.app_admin_login_resolver FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_admin_login_resolver TO service_role;

COMMENT ON VIEW public.app_admin_login_resolver IS
  'Fonte canônica server-side dos identificadores de login administrativo. Une o e-mail administrativo e o e-mail da pessoa canônica vinculada, sem duplicar credenciais Auth.';

ALTER TABLE public.app_verification_requests
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS superseded_by_request_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.app_verification_requests'::regclass
      AND conname = 'app_verification_requests_superseded_by_fkey'
  ) THEN
    ALTER TABLE public.app_verification_requests
      ADD CONSTRAINT app_verification_requests_superseded_by_fkey
      FOREIGN KEY (superseded_by_request_id)
      REFERENCES public.app_verification_requests(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ix_verification_requests_archive
  ON public.app_verification_requests (archived_at DESC, updated_at DESC)
  WHERE archived_at IS NOT NULL AND superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_verification_requests_superseded
  ON public.app_verification_requests (property_id, superseded_at)
  WHERE superseded_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.trg_fn_verification_archive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.archived_at := COALESCE(NEW.archived_at, clock_timestamp());
    NEW.superseded_at := NULL;
    NEW.superseded_by_request_id := NULL;

    UPDATE public.app_verification_requests
       SET superseded_at = COALESCE(superseded_at, clock_timestamp()),
           superseded_by_request_id = NEW.id,
           updated_at = clock_timestamp()
     WHERE property_id = NEW.property_id
       AND id <> NEW.id
       AND superseded_at IS NULL
       AND status IN ('approved','rejected','adjustments_required','escalated');
  ELSIF OLD.status = 'approved' AND NEW.status IS DISTINCT FROM 'approved' THEN
    NEW.archived_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_verification_archive ON public.app_verification_requests;
CREATE TRIGGER trg_verification_archive
BEFORE UPDATE OF status ON public.app_verification_requests
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_verification_archive();

UPDATE public.app_verification_requests
   SET archived_at = COALESCE(archived_at, updated_at, created_at, clock_timestamp())
 WHERE status = 'approved'
   AND archived_at IS NULL;

WITH winners AS (
  SELECT DISTINCT ON (property_id)
         property_id,
         id
    FROM public.app_verification_requests
   WHERE status = 'approved'
   ORDER BY property_id, COALESCE(archived_at, updated_at, created_at) DESC, id DESC
)
UPDATE public.app_verification_requests r
   SET superseded_at = COALESCE(r.superseded_at, clock_timestamp()),
       superseded_by_request_id = w.id,
       updated_at = clock_timestamp()
  FROM winners w
 WHERE r.property_id = w.property_id
   AND r.id <> w.id
   AND r.superseded_at IS NULL
   AND r.status IN ('approved','rejected','adjustments_required','escalated');

CREATE OR REPLACE FUNCTION public.trg_fn_t08_property_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_has_current_approval boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.completed_at IS NOT NULL OR OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'COMPLETED_PROPERTY_DELETE_FORBIDDEN' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status = 'verified' AND OLD.status IN ('completed','rejected') THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.app_verification_requests r
       WHERE r.property_id = OLD.id
         AND r.status = 'approved'
         AND r.superseded_at IS NULL
    ) INTO v_has_current_approval;
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
    (OLD.status = 'withdrawn' AND NEW.status = 'withdrawn') OR
    (NEW.status = 'verified' AND OLD.status IN ('completed','rejected') AND v_has_current_approval)
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

UPDATE public.app_properties p
   SET status = 'verified',
       updated_at = clock_timestamp()
 WHERE p.status IN ('completed','submitted','rejected')
   AND EXISTS (
     SELECT 1
       FROM public.app_verification_requests r
      WHERE r.property_id = p.id
        AND r.status = 'approved'
        AND r.superseded_at IS NULL
   );

UPDATE public.app_producer_profiles pp
   SET verification_status = 'verified',
       updated_at = clock_timestamp()
 WHERE EXISTS (
   SELECT 1
     FROM public.app_properties p
     JOIN public.app_verification_requests r ON r.property_id = p.id
    WHERE p.producer_id = pp.id
      AND r.status = 'approved'
      AND r.superseded_at IS NULL
 );

COMMENT ON COLUMN public.app_verification_requests.archived_at IS
  'Momento em que uma aprovação passou ao arquivo somente leitura da auditoria.';
COMMENT ON COLUMN public.app_verification_requests.superseded_at IS
  'Momento em que uma decisão anterior do mesmo imóvel deixou de ser um item independente e passou a existir somente no histórico.';
COMMENT ON COLUMN public.app_verification_requests.superseded_by_request_id IS
  'Solicitação aprovada atual que substitui a decisão antiga do mesmo imóvel.';
