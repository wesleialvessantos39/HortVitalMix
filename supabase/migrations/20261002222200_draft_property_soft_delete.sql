-- Excluded producer drafts keep immutable document evidence without remaining active.
ALTER TABLE public.app_properties
  ADD COLUMN deleted_at timestamptz;

CREATE INDEX ix_app_properties_active_producer_updated
  ON public.app_properties(producer_id, updated_at DESC)
  WHERE deleted_at IS NULL;

DROP POLICY properties_self_read ON public.app_properties;
CREATE POLICY properties_self_read
  ON public.app_properties FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND producer_id IN (
      SELECT pp.id FROM public.app_producer_profiles pp
      WHERE pp.person_id = public.current_person_id()
    )
  );

DROP POLICY properties_admin_read ON public.app_properties;
CREATE POLICY properties_admin_read
  ON public.app_properties FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.is_any_platform_admin());

DROP POLICY property_boundaries_self_read ON public.app_property_boundaries;
CREATE POLICY property_boundaries_self_read
  ON public.app_property_boundaries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_properties p
      JOIN public.app_producer_profiles pp ON pp.id = p.producer_id
      WHERE p.id = property_id AND p.deleted_at IS NULL
        AND pp.person_id = public.current_person_id()
    )
  );

DROP POLICY property_boundaries_admin_read ON public.app_property_boundaries;
CREATE POLICY property_boundaries_admin_read
  ON public.app_property_boundaries FOR SELECT TO authenticated
  USING (
    public.is_any_platform_admin()
    AND EXISTS (
      SELECT 1 FROM public.app_properties p
      WHERE p.id = property_id AND p.deleted_at IS NULL
    )
  );

DROP POLICY rural_activities_self_read ON public.app_rural_activities;
CREATE POLICY rural_activities_self_read
  ON public.app_rural_activities FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_properties p
      JOIN public.app_producer_profiles pp ON pp.id = p.producer_id
      WHERE p.id = property_id AND p.deleted_at IS NULL
        AND pp.person_id = public.current_person_id()
    )
  );

DROP POLICY rural_activities_admin_read ON public.app_rural_activities;
CREATE POLICY rural_activities_admin_read
  ON public.app_rural_activities FOR SELECT TO authenticated
  USING (
    public.is_any_platform_admin()
    AND EXISTS (
      SELECT 1 FROM public.app_properties p
      WHERE p.id = property_id AND p.deleted_at IS NULL
    )
  );

DROP POLICY app_documents_self_read ON public.app_documents;
CREATE POLICY app_documents_self_read
  ON public.app_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_properties p
      JOIN public.app_producer_profiles pp ON pp.id = p.producer_id
      WHERE p.id = property_id AND p.deleted_at IS NULL
        AND pp.person_id = public.current_person_id()
    )
  );

DROP POLICY app_documents_admin_read ON public.app_documents;
CREATE POLICY app_documents_admin_read
  ON public.app_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_properties p
      WHERE p.id = property_id AND p.deleted_at IS NULL
    )
    AND (
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
    )
  );

DROP POLICY app_document_scans_self_read ON public.app_document_scans;
CREATE POLICY app_document_scans_self_read
  ON public.app_document_scans FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_documents d
      JOIN public.app_properties p ON p.id = d.property_id
      JOIN public.app_producer_profiles pp ON pp.id = d.producer_id
      WHERE d.id = document_id AND p.deleted_at IS NULL
        AND pp.person_id = public.current_person_id()
    )
  );

DROP POLICY app_document_scans_admin_read ON public.app_document_scans;
CREATE POLICY app_document_scans_admin_read
  ON public.app_document_scans FOR SELECT TO authenticated
  USING (
    public.is_any_platform_admin()
    AND EXISTS (
      SELECT 1 FROM public.app_documents d
      JOIN public.app_properties p ON p.id = d.property_id
      WHERE d.id = document_id AND p.deleted_at IS NULL
    )
  );

DROP POLICY validations_read ON public.app_car_validations;
CREATE POLICY validations_read
  ON public.app_car_validations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_document_extractions e
      JOIN public.app_properties p ON p.id = e.property_id
      WHERE e.id = extraction_id AND p.deleted_at IS NULL
    )
  );

DROP POLICY reviews_read ON public.app_document_reviews;
CREATE POLICY reviews_read
  ON public.app_document_reviews FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_document_extractions e
      JOIN public.app_properties p ON p.id = e.property_id
      WHERE e.id = extraction_id AND p.deleted_at IS NULL
    )
  );

DROP POLICY verification_requests_admin_read ON public.app_verification_requests;
CREATE POLICY verification_requests_admin_read
  ON public.app_verification_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_properties p
      WHERE p.id = property_id AND p.deleted_at IS NULL
    )
    AND (
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
    )
  );

DROP POLICY verification_requests_producer_read ON public.app_verification_requests;
CREATE POLICY verification_requests_producer_read
  ON public.app_verification_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_properties p
      JOIN public.app_producer_profiles pp ON pp.id = p.producer_id
      WHERE p.id = property_id AND p.deleted_at IS NULL
        AND pp.person_id = public.current_person_id()
    )
  );

DROP POLICY verification_decisions_admin_read ON public.app_verification_decisions;
CREATE POLICY verification_decisions_admin_read
  ON public.app_verification_decisions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_verification_requests r
      JOIN public.app_properties p ON p.id = r.property_id
      WHERE r.id = request_id AND p.deleted_at IS NULL
    )
    AND (
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
    )
  );

DROP POLICY verification_decisions_producer_final_read ON public.app_verification_decisions;
CREATE POLICY verification_decisions_producer_final_read
  ON public.app_verification_decisions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_verification_requests r
      JOIN public.app_producer_profiles pp ON pp.id = r.producer_id
      JOIN public.app_properties p ON p.id = r.property_id
      WHERE r.id = request_id AND p.deleted_at IS NULL
        AND pp.person_id = public.current_person_id()
        AND r.status IN ('approved', 'rejected')
    )
  );
