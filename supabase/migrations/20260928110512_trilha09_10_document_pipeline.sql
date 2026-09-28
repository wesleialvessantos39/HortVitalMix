-- Evolução aditiva da T09 parcial; T10 sem aprovação automática de imóveis.
ALTER TABLE public.app_documents ADD COLUMN upload_command_id uuid UNIQUE;
CREATE TABLE public.app_document_extractions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL UNIQUE REFERENCES public.app_documents(id) ON DELETE RESTRICT,
 property_id uuid NOT NULL REFERENCES public.app_properties(id) ON DELETE RESTRICT,producer_id uuid NOT NULL REFERENCES public.app_producer_profiles(id) ON DELETE RESTRICT,
 extraction_engine varchar(64) NOT NULL,payload_jsonb jsonb NOT NULL,confidence_score numeric(3,2) NOT NULL CHECK(confidence_score BETWEEN 0 AND 1),
 raw_text text NOT NULL,status text NOT NULL CHECK(status IN ('completed','flagged_discrepancy')),file_hash_sha256 char(64) NOT NULL,
 discrepancies jsonb NOT NULL DEFAULT '[]',area_difference_percent numeric,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_extraction_owner_hash ON public.app_document_extractions(producer_id,file_hash_sha256);
CREATE INDEX ix_extraction_property ON public.app_document_extractions(property_id);
CREATE TABLE public.app_car_validations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),extraction_id uuid NOT NULL UNIQUE REFERENCES public.app_document_extractions(id),property_id uuid NOT NULL REFERENCES public.app_properties(id),
 car_number varchar(64),ccir_number varchar(64),sicar_protocol varchar(255),total_area_ha numeric,legal_reserve_ha numeric,app_area_ha numeric,fiscal_modules numeric,
 overlapping_indigenous_units boolean,overlapping_conservation_units boolean,
 validation_status text NOT NULL DEFAULT 'manual_check_required' CHECK(validation_status IN ('invalid','manual_check_required')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_car_validation_property ON public.app_car_validations(property_id);
CREATE TABLE public.app_document_jobs (
 document_id uuid PRIMARY KEY REFERENCES public.app_documents(id),status text NOT NULL CHECK(status IN ('processing','completed','failed')),
 lease_id uuid NOT NULL,lease_until timestamptz NOT NULL,error_code text,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.app_document_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),extraction_id uuid NOT NULL REFERENCES public.app_document_extractions(id),user_id uuid NOT NULL REFERENCES public.app_users(id),
 decision text NOT NULL CHECK(decision IN ('confirmed','disputed')),note text NOT NULL DEFAULT '',command_id uuid NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(decision<>'disputed' OR length(note)>=5)
);
CREATE INDEX ix_document_reviews_extraction ON public.app_document_reviews(extraction_id);
-- Apenas setor documental e superadministrador. Identidade/papel utilizam helpers vigentes, com bloqueios respeitados.
DROP POLICY app_documents_admin_read ON public.app_documents;
CREATE POLICY app_documents_admin_read ON public.app_documents FOR SELECT TO authenticated USING (
 public.is_platform_super_admin() OR (public.has_role('platform_admin') AND EXISTS(SELECT 1 FROM public.app_admin_sector_members m WHERE m.user_id=auth.uid() AND m.sector_code='document_verification' AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>now()))));
DROP POLICY app_document_scans_admin_read ON public.app_document_scans;
CREATE POLICY app_document_scans_admin_read ON public.app_document_scans FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.app_documents d WHERE d.id=document_id));
-- Downloads exclusivamente pelo backend com autorização, auditoria e TTL 900; evita cliente escolher TTL maior.
DROP POLICY t09_documents_private_read ON storage.objects;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['app_document_extractions','app_car_validations','app_document_jobs','app_document_reviews'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
 END LOOP;
END $$;
REVOKE ALL ON public.app_documents,public.app_document_scans FROM anon,authenticated;
GRANT SELECT ON public.app_documents,public.app_document_scans,public.app_document_extractions,public.app_car_validations,public.app_document_reviews TO authenticated;
CREATE POLICY extractions_read ON public.app_document_extractions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.app_documents d WHERE d.id=document_id AND d.status='clean'));
CREATE POLICY validations_read ON public.app_car_validations FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.app_document_extractions e WHERE e.id=extraction_id));
CREATE POLICY reviews_read ON public.app_document_reviews FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.app_document_extractions e WHERE e.id=extraction_id));
CREATE FUNCTION public.protect_document_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'DOCUMENT_EVIDENCE_IMMUTABLE'; END;$$;
CREATE TRIGGER extraction_immutable BEFORE UPDATE OR DELETE ON public.app_document_extractions FOR EACH ROW EXECUTE FUNCTION public.protect_document_evidence();
CREATE TRIGGER scans_immutable BEFORE UPDATE OR DELETE ON public.app_document_scans FOR EACH ROW EXECUTE FUNCTION public.protect_document_evidence();
CREATE TRIGGER reviews_immutable BEFORE UPDATE OR DELETE ON public.app_document_reviews FOR EACH ROW EXECUTE FUNCTION public.protect_document_evidence();
REVOKE ALL ON FUNCTION public.protect_document_evidence() FROM PUBLIC,anon,authenticated;

GRANT ALL ON public.app_document_extractions,public.app_car_validations,public.app_document_jobs,public.app_document_reviews TO service_role;
ALTER TABLE public.app_properties ADD CONSTRAINT uq_property_producer UNIQUE(id,producer_id);
ALTER TABLE public.app_documents ADD CONSTRAINT fk_document_property_producer FOREIGN KEY(property_id,producer_id) REFERENCES public.app_properties(id,producer_id);
CREATE TRIGGER validations_immutable BEFORE UPDATE OR DELETE ON public.app_car_validations FOR EACH ROW EXECUTE FUNCTION public.protect_document_evidence();
