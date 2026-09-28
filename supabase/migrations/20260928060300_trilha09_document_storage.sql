-- HortiVitalMix — T09: custódia privada de documentos fundiários/sanitários.
CREATE TABLE public.app_documents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 property_id UUID NOT NULL REFERENCES public.app_properties(id) ON DELETE CASCADE,
 producer_id UUID NOT NULL REFERENCES public.app_producer_profiles(id) ON DELETE CASCADE,
 document_type VARCHAR(32) NOT NULL CHECK (document_type IN ('car_sicar','ccir_incra','dap_caf','laudo_agua','certidao_posse','outro')),
 file_name VARCHAR(255) NOT NULL,
 file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes BETWEEN 1024 AND 15728640),
 mime_type VARCHAR(64) NOT NULL CHECK (mime_type IN ('application/pdf','image/png','image/jpeg')),
 storage_bucket VARCHAR(64) NOT NULL DEFAULT 'documents_private' CHECK (storage_bucket='documents_private'),
 storage_path VARCHAR(512) NOT NULL UNIQUE,
 file_hash_sha256 CHAR(64) NOT NULL CHECK (file_hash_sha256 ~ '^[0-9a-f]{64}$'),
 status VARCHAR(32) NOT NULL DEFAULT 'quarantine' CHECK (status IN ('quarantine','clean','rejected','archived')),
 uploaded_by UUID NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT ck_app_documents_path CHECK (storage_path LIKE 'properties/' || property_id::text || '/%')
);
CREATE TABLE public.app_document_scans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id UUID NOT NULL REFERENCES public.app_documents(id) ON DELETE CASCADE,
 scan_engine VARCHAR(64) NOT NULL DEFAULT 'magic_bytes_validator',
 is_clean BOOLEAN NOT NULL,
 detected_mime VARCHAR(64) NOT NULL,
 scan_details JSONB NOT NULL,
 scanned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_app_documents_property ON public.app_documents(property_id);
CREATE INDEX ix_app_documents_producer ON public.app_documents(producer_id);
CREATE INDEX ix_app_documents_hash ON public.app_documents(file_hash_sha256);
CREATE INDEX ix_app_document_scans_document ON public.app_document_scans(document_id);
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('documents_private','documents_private',false,15728640,ARRAY['application/pdf','image/png','image/jpeg'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=15728640,allowed_mime_types=EXCLUDED.allowed_mime_types;
ALTER TABLE public.app_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_document_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_document_scans FORCE ROW LEVEL SECURITY;
CREATE POLICY app_documents_self_read ON public.app_documents FOR SELECT TO authenticated USING (producer_id IN (SELECT pp.id FROM public.app_producer_profiles pp WHERE pp.person_id=public.current_person_id()));
CREATE POLICY app_documents_admin_read ON public.app_documents FOR SELECT TO authenticated USING(public.is_any_platform_admin());
CREATE POLICY app_document_scans_self_read ON public.app_document_scans FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.app_documents d JOIN public.app_producer_profiles pp ON pp.id=d.producer_id WHERE d.id=document_id AND pp.person_id=public.current_person_id()));
CREATE POLICY app_document_scans_admin_read ON public.app_document_scans FOR SELECT TO authenticated USING(public.is_any_platform_admin());
REVOKE ALL ON public.app_documents,public.app_document_scans FROM anon;
REVOKE INSERT,UPDATE,DELETE ON public.app_documents,public.app_document_scans FROM authenticated;
GRANT SELECT ON public.app_documents,public.app_document_scans TO authenticated;
CREATE POLICY t09_documents_private_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id='documents_private' AND EXISTS(SELECT 1 FROM public.app_documents d JOIN public.app_producer_profiles pp ON pp.id=d.producer_id WHERE d.storage_path=name AND d.status='clean' AND (pp.person_id=public.current_person_id() OR public.is_any_platform_admin())));