-- Prova transacional de isolamento. Não cria Auth nem envia e-mail; ROLLBACK integral.
BEGIN;
DO $$
DECLARE u uuid:=gen_random_uuid(); person uuid; producer uuid; prop uuid; doc uuid:=gen_random_uuid(); ext uuid;
BEGIN
 INSERT INTO public.app_users(id,status) VALUES(u,'active');
 INSERT INTO public.app_people(user_id,full_name,cpf_normalized,email_normalized,phone_e164)
 VALUES(u,'Teste rollback '||u,lpad((floor(random()*99999999999))::bigint::text,11,'0'),u||'@example.invalid','+5500000000000') RETURNING id INTO person;
 INSERT INTO public.app_user_role_assignments(user_id,role_code) VALUES(u,'producer');
 INSERT INTO public.app_producer_profiles(person_id,property_name) VALUES(person,'Teste rollback') RETURNING id INTO producer;
 INSERT INTO public.app_properties(producer_id) VALUES(producer) RETURNING id INTO prop;
 INSERT INTO public.app_documents(id,property_id,producer_id,document_type,file_name,file_size_bytes,mime_type,storage_path,file_hash_sha256,uploaded_by,status)
 VALUES(doc,prop,producer,'car_sicar','teste.pdf',1024,'application/pdf','properties/'||prop||'/'||doc||'.pdf',repeat('a',64),u,'clean');
 INSERT INTO public.app_document_extractions(document_id,property_id,producer_id,extraction_engine,payload_jsonb,confidence_score,raw_text,status,file_hash_sha256)
 VALUES(doc,prop,producer,'test-only','{}',0.9,'test only','completed',repeat('a',64)) RETURNING id INTO ext;
 BEGIN UPDATE public.app_document_extractions SET raw_text='changed' WHERE id=ext; RAISE EXCEPTION 'IMMUTABILITY_FAILED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DOCUMENT_EVIDENCE_IMMUTABLE' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('test.document_id',doc::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.app_documents WHERE id=current_setting('test.document_id')::uuid)<>1 THEN RAISE EXCEPTION 'OWNER_CANNOT_READ'; END IF;
 IF (SELECT count(*) FROM public.app_document_extractions WHERE document_id=current_setting('test.document_id')::uuid)<>1 THEN RAISE EXCEPTION 'OWNER_EXTRACTION_CANNOT_READ'; END IF;
 IF has_table_privilege('authenticated','public.app_documents','UPDATE') OR has_table_privilege('authenticated','public.app_documents','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_GRANT'; END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='documents_private') THEN RAISE EXCEPTION 'DIRECT_STORAGE_LEAK'; END IF;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 IF EXISTS(SELECT 1 FROM public.app_documents WHERE id=current_setting('test.document_id')::uuid) THEN RAISE EXCEPTION 'CROSS_OWNER_LEAK'; END IF;
 IF EXISTS(SELECT 1 FROM public.app_document_extractions WHERE document_id=current_setting('test.document_id')::uuid) THEN RAISE EXCEPTION 'CROSS_OWNER_EXTRACTION_LEAK'; END IF;
END $$;
RESET ROLE;
SELECT 'owner read, cross-owner denial, extraction immutability, restricted grants: passed' AS verification;
ROLLBACK;
