-- Trilha 11 — fila de auditoria humana e parecer fundiário/sanitário.
-- Decisão 100% humana: extração não aprova imóvel.

CREATE TABLE public.app_verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.app_properties(id) ON DELETE CASCADE,
  producer_id uuid NOT NULL REFERENCES public.app_producer_profiles(id) ON DELETE CASCADE,
  status varchar(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'in_review', 'approved', 'rejected', 'escalated')),
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 10),
  claimed_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  claimed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX ix_verification_requests_queue
  ON public.app_verification_requests (status, priority DESC, created_at ASC);
CREATE INDEX ix_verification_requests_producer
  ON public.app_verification_requests (producer_id);
CREATE UNIQUE INDEX uq_verification_open_property
  ON public.app_verification_requests (property_id)
  WHERE status IN ('pending', 'claimed', 'in_review');

CREATE TABLE public.app_verification_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.app_verification_requests(id) ON DELETE CASCADE,
  auditor_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  decision varchar(32) NOT NULL CHECK (decision IN ('approved', 'rejected', 'adjustments_required')),
  technical_opinion text NOT NULL CHECK (length(trim(technical_opinion)) >= 10),
  assigned_trust_level integer NOT NULL CHECK (assigned_trust_level BETWEEN 1 AND 5),
  checklist_environmental_ok boolean NOT NULL DEFAULT false,
  checklist_land_tenure_ok boolean NOT NULL DEFAULT false,
  checklist_water_quality_ok boolean NOT NULL DEFAULT false,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_approval_requires_full_checklist CHECK (
    decision <> 'approved'
    OR (
      checklist_environmental_ok
      AND checklist_land_tenure_ok
      AND checklist_water_quality_ok
    )
  )
);

CREATE INDEX ix_verification_decisions_request
  ON public.app_verification_decisions (request_id, decided_at DESC);

ALTER TABLE public.app_verification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_verification_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_verification_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_verification_decisions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.app_verification_requests FROM anon, authenticated;
REVOKE ALL ON public.app_verification_decisions FROM anon, authenticated;
GRANT SELECT ON public.app_verification_requests, public.app_verification_decisions TO authenticated;
GRANT ALL ON public.app_verification_requests, public.app_verification_decisions TO service_role;

CREATE POLICY verification_requests_admin_read
  ON public.app_verification_requests
  FOR SELECT TO authenticated
  USING (
    public.is_platform_super_admin()
    OR (
      public.has_role('platform_admin')
      AND EXISTS (
        SELECT 1 FROM public.app_admin_sector_members m
        WHERE m.user_id = auth.uid()
          AND m.sector_code = 'document_verification'
          AND m.revoked_at IS NULL
          AND (m.expires_at IS NULL OR m.expires_at > now())
      )
    )
  );

CREATE POLICY verification_requests_producer_read
  ON public.app_verification_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_producer_profiles pp
      WHERE pp.id = producer_id
        AND pp.person_id = public.current_person_id()
    )
  );

CREATE POLICY verification_decisions_admin_read
  ON public.app_verification_decisions
  FOR SELECT TO authenticated
  USING (
    public.is_platform_super_admin()
    OR (
      public.has_role('platform_admin')
      AND EXISTS (
        SELECT 1 FROM public.app_admin_sector_members m
        WHERE m.user_id = auth.uid()
          AND m.sector_code = 'document_verification'
          AND m.revoked_at IS NULL
          AND (m.expires_at IS NULL OR m.expires_at > now())
      )
    )
  );

CREATE POLICY verification_decisions_producer_final_read
  ON public.app_verification_decisions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_verification_requests r
      JOIN public.app_producer_profiles pp ON pp.id = r.producer_id
      WHERE r.id = request_id
        AND pp.person_id = public.current_person_id()
        AND r.status IN ('approved', 'rejected')
    )
  );
