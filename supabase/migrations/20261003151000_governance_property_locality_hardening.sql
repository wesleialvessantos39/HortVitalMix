-- HortiVitalMix — governança de imóveis, contas e localidades (schema lógico 45)
-- Correção aditiva: preserva evidências de imóveis enviados/aprovados, mas permite
-- eliminação integral de rascunhos e remoção física de contas/localidades ativas.

SET lock_timeout = '5s';

-- 1) Novos setores delegáveis pelo Super administrador.
INSERT INTO public.app_admin_sectors(code,name,description,is_active)
VALUES
  ('account_governance','Governança de contas','Aprovação, bloqueio e exclusão de contas sob delegação do Super administrador.',true),
  ('platform_configuration','Configuração global','Administração dos parâmetros e da central de governança da plataforma.',true)
ON CONFLICT (code) DO UPDATE
SET name=EXCLUDED.name,
    description=EXCLUDED.description,
    is_active=true;

-- 2) Tombstone de conta: acrescenta e-mail para mensagem de login pós-exclusão.
ALTER TABLE public.app_account_deletions
  ADD COLUMN IF NOT EXISTS email_normalized varchar(255);

UPDATE public.app_account_deletions d
   SET email_normalized=p.email_normalized
  FROM public.app_people p
 WHERE p.user_id=d.user_id
   AND d.email_normalized IS NULL;

CREATE INDEX IF NOT EXISTS ix_app_account_deletions_email
  ON public.app_account_deletions(email_normalized,deleted_at DESC)
  WHERE email_normalized IS NOT NULL;

-- Tombstones e trilhas históricas não podem impedir o hard-delete da conta ativa.
ALTER TABLE public.app_account_deletions
  DROP CONSTRAINT IF EXISTS app_account_deletions_user_id_fkey,
  DROP CONSTRAINT IF EXISTS app_account_deletions_deleted_by_fkey;

ALTER TABLE public.app_documents
  DROP CONSTRAINT IF EXISTS app_documents_uploaded_by_fkey;
ALTER TABLE public.app_document_reviews
  DROP CONSTRAINT IF EXISTS app_document_reviews_user_id_fkey;
ALTER TABLE public.app_registration_reviews
  DROP CONSTRAINT IF EXISTS app_registration_reviews_user_id_fkey,
  DROP CONSTRAINT IF EXISTS app_registration_reviews_reviewed_by_fkey;
ALTER TABLE public.app_verification_decisions
  DROP CONSTRAINT IF EXISTS app_verification_decisions_auditor_id_fkey;
ALTER TABLE public.app_admin_invites
  DROP CONSTRAINT IF EXISTS app_admin_invites_invited_by_fkey,
  DROP CONSTRAINT IF EXISTS app_admin_invites_target_person_id_fkey;
ALTER TABLE public.app_admin_invites
  ADD CONSTRAINT app_admin_invites_target_person_id_fkey
  FOREIGN KEY(target_person_id) REFERENCES public.app_people(id) ON DELETE SET NULL;

-- Pessoa arquivada pode permanecer apenas como vínculo histórico sem representar
-- uma conta ativa. A exclusão de app_users limpa o user_id automaticamente.
ALTER TABLE public.app_people ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.app_people DROP CONSTRAINT IF EXISTS app_people_user_id_fkey;
ALTER TABLE public.app_people
  ADD CONSTRAINT app_people_user_id_fkey
  FOREIGN KEY(user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;

-- Exclusão operacional integral da conta. O tombstone mínimo é gravado
-- antes; dados de perfil, imóveis e arquivos entram em remoção física.
CREATE OR REPLACE FUNCTION public.purge_account_domain(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_property record;
  v_person_ids uuid[];
BEGIN
  PERFORM set_config('hvm.account_purge','on',true);

  SELECT array_agg(id) INTO v_person_ids
    FROM public.app_people
   WHERE user_id=p_user_id;

  FOR v_property IN
    SELECT p.id,p.producer_id
      FROM public.app_properties p
      JOIN public.app_producer_profiles pp ON pp.id=p.producer_id
      JOIN public.app_people pe ON pe.id=pp.person_id
     WHERE pe.user_id=p_user_id
  LOOP
    INSERT INTO public.app_storage_deletion_queue(bucket,object_path,reason)
    SELECT storage_bucket,storage_path,'account_deleted'
      FROM public.app_documents
     WHERE property_id=v_property.id
    ON CONFLICT(bucket,object_path)
    DO UPDATE SET completed_at=NULL,last_error=NULL,requested_at=clock_timestamp();

    DELETE FROM public.app_document_reviews r
     WHERE EXISTS (
       SELECT 1 FROM public.app_document_extractions e
        WHERE e.id=r.extraction_id AND e.property_id=v_property.id
     );
    DELETE FROM public.app_car_validations WHERE property_id=v_property.id;
    DELETE FROM public.app_document_jobs
     WHERE document_id IN (
       SELECT id FROM public.app_documents WHERE property_id=v_property.id
     );
    DELETE FROM public.app_document_scans
     WHERE document_id IN (
       SELECT id FROM public.app_documents WHERE property_id=v_property.id
     );
    DELETE FROM public.app_document_extractions WHERE property_id=v_property.id;
    DELETE FROM public.app_documents WHERE property_id=v_property.id;
    DELETE FROM public.app_verification_requests WHERE property_id=v_property.id;
    DELETE FROM public.app_properties WHERE id=v_property.id;
  END LOOP;

  DELETE FROM public.app_producer_profiles
   WHERE person_id=ANY(COALESCE(v_person_ids,ARRAY[]::uuid[]));

  DELETE FROM public.app_admin_invites
   WHERE auth_user_id=p_user_id
      OR target_person_id=ANY(COALESCE(v_person_ids,ARRAY[]::uuid[]));

  DELETE FROM public.app_admin_principals WHERE admin_user_id=p_user_id;
  DELETE FROM public.app_registration_reviews WHERE user_id=p_user_id;

  DELETE FROM public.app_people
   WHERE id=ANY(COALESCE(v_person_ids,ARRAY[]::uuid[]));
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_account_domain(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_account_domain(uuid) TO service_role;

-- Auth e domínio devem sumir juntos. A tabela app_account_deletions é o
-- único tombstone de segurança usado para reconhecer reincidência de CPF/nome.
CREATE OR REPLACE FUNCTION public.trg_fn_auth_user_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cpf char(11);
  v_name text;
  v_email varchar(255);
BEGIN
  SELECT p.cpf_normalized,p.full_name,p.email_normalized
    INTO v_cpf,v_name,v_email
    FROM public.app_people p
   WHERE p.user_id=OLD.id
   ORDER BY p.created_at
   LIMIT 1;

  IF v_cpf IS NOT NULL AND v_name IS NOT NULL THEN
    INSERT INTO public.app_account_deletions(
      user_id,cpf_normalized,name_key,email_normalized,deleted_by,deleted_at
    )
    VALUES(
      OLD.id,v_cpf,public.governance_name_key(v_name),
      COALESCE(v_email,lower(OLD.email)),OLD.id,clock_timestamp()
    )
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM public.purge_account_domain(OLD.id);
  DELETE FROM public.app_users WHERE id=OLD.id;
  RETURN OLD;
END;
$function$;

-- 3) Memória de impacto quando uma localidade é efetivamente removida.
CREATE TABLE IF NOT EXISTS public.app_locality_user_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  locality_name varchar(100) NOT NULL,
  locality_name_normalized varchar(120) NOT NULL,
  state char(2) NOT NULL DEFAULT 'RO',
  impact_type varchar(32) NOT NULL DEFAULT 'coverage_removed'
    CHECK (impact_type IN ('coverage_removed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_locality_user_impacts_open
  ON public.app_locality_user_impacts(user_id,locality_name_normalized,state)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_app_locality_user_impacts_lookup
  ON public.app_locality_user_impacts(user_id,resolved_at);

ALTER TABLE public.app_locality_user_impacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_locality_user_impacts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_locality_user_impacts FROM anon,authenticated;
GRANT ALL ON public.app_locality_user_impacts TO service_role;

-- 4) Fila canônica de limpeza física no Storage API. Nunca apagamos storage.objects via SQL.
CREATE TABLE IF NOT EXISTS public.app_storage_deletion_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket varchar(80) NOT NULL,
  object_path text NOT NULL,
  reason varchar(64) NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz NULL,
  last_error text NULL,
  UNIQUE(bucket,object_path)
);
CREATE INDEX IF NOT EXISTS ix_app_storage_deletion_queue_pending
  ON public.app_storage_deletion_queue(requested_at)
  WHERE completed_at IS NULL;
ALTER TABLE public.app_storage_deletion_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_storage_deletion_queue FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_storage_deletion_queue FROM anon,authenticated;
GRANT ALL ON public.app_storage_deletion_queue TO service_role;

-- Evidência documental continua imutável depois que um imóvel deixa de ser rascunho.
-- DELETE só é liberado quando toda a evidência ainda pertence a um imóvel draft.
CREATE OR REPLACE FUNCTION public.protect_document_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_draft boolean := false;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('hvm.account_purge',true)='on' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'app_document_extractions' THEN
      SELECT EXISTS(
        SELECT 1 FROM public.app_properties p
         WHERE p.id=OLD.property_id AND p.status='draft'
      ) INTO v_draft;
    ELSIF TG_TABLE_NAME = 'app_car_validations' THEN
      SELECT EXISTS(
        SELECT 1 FROM public.app_properties p
         WHERE p.id=OLD.property_id AND p.status='draft'
      ) INTO v_draft;
    ELSIF TG_TABLE_NAME = 'app_document_scans' THEN
      SELECT EXISTS(
        SELECT 1
          FROM public.app_documents d
          JOIN public.app_properties p ON p.id=d.property_id
         WHERE d.id=OLD.document_id AND p.status='draft'
      ) INTO v_draft;
    ELSIF TG_TABLE_NAME = 'app_document_reviews' THEN
      SELECT EXISTS(
        SELECT 1
          FROM public.app_document_extractions e
          JOIN public.app_properties p ON p.id=e.property_id
         WHERE e.id=OLD.extraction_id AND p.status='draft'
      ) INTO v_draft;
    END IF;
  END IF;

  IF v_draft THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'DOCUMENT_EVIDENCE_IMMUTABLE';
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_draft_property(
  p_property_id uuid,
  p_producer_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_count integer := 0;
BEGIN
  SELECT status INTO v_status
    FROM public.app_properties
   WHERE id=p_property_id AND producer_id=p_producer_id
   FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN 0;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'DRAFT_PROPERTY_REQUIRED' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.app_storage_deletion_queue(bucket,object_path,reason)
  SELECT storage_bucket,storage_path,'draft_property_deleted'
    FROM public.app_documents
   WHERE property_id=p_property_id
  ON CONFLICT(bucket,object_path)
  DO UPDATE SET completed_at=NULL,last_error=NULL,requested_at=clock_timestamp();

  DELETE FROM public.app_document_reviews r
   WHERE EXISTS (
     SELECT 1 FROM public.app_document_extractions e
      WHERE e.id=r.extraction_id AND e.property_id=p_property_id
   );
  DELETE FROM public.app_car_validations WHERE property_id=p_property_id;
  DELETE FROM public.app_document_jobs
   WHERE document_id IN (
     SELECT id FROM public.app_documents WHERE property_id=p_property_id
   );
  DELETE FROM public.app_document_scans
   WHERE document_id IN (
     SELECT id FROM public.app_documents WHERE property_id=p_property_id
   );
  DELETE FROM public.app_document_extractions WHERE property_id=p_property_id;
  DELETE FROM public.app_documents WHERE property_id=p_property_id;

  DELETE FROM public.app_properties
   WHERE id=p_property_id AND producer_id=p_producer_id AND status='draft';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_draft_property(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_draft_property(uuid,uuid) TO service_role;

-- Limpeza solicitada: todo rascunho existente deixa de ser um imóvel administrativo.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id,producer_id FROM public.app_properties WHERE status='draft'
  LOOP
    PERFORM public.purge_draft_property(r.id,r.producer_id);
  END LOOP;
END $$;

-- 5) Cadastro reincidente: exclusão e bloqueio convergem para aprovação prévia.
CREATE OR REPLACE FUNCTION public.trg_registration_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  matches uuid[];
  why text[];
BEGIN
  WITH candidates AS (
    SELECT d.user_id,
           CASE
             WHEN d.cpf_normalized=NEW.cpf_normalized THEN 'cpf'
             ELSE 'name'
           END AS reason
      FROM public.app_account_deletions d
     WHERE d.cpf_normalized=NEW.cpf_normalized
        OR d.name_key=public.governance_name_key(NEW.full_name)
    UNION ALL
    SELECT p.user_id,
           CASE
             WHEN p.cpf_normalized=NEW.cpf_normalized THEN 'cpf'
             ELSE 'name'
           END AS reason
      FROM public.app_people p
      JOIN public.app_users u ON u.id=p.user_id
     WHERE u.status='blocked'
       AND p.user_id IS DISTINCT FROM NEW.user_id
       AND (
         p.cpf_normalized=NEW.cpf_normalized
         OR public.governance_name_key(p.full_name)=public.governance_name_key(NEW.full_name)
       )
  )
  SELECT array_agg(DISTINCT user_id),array_agg(DISTINCT reason)
    INTO matches,why
    FROM candidates;

  IF matches IS NOT NULL THEN
    UPDATE public.app_users
       SET status='pending',authorization_revision=authorization_revision+1
     WHERE id=NEW.user_id;
    INSERT INTO public.app_registration_reviews(user_id,matched_user_ids,reasons)
    VALUES(NEW.user_id,matches,why);
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.complete_public_registration(
  p_user_id uuid,
  p_full_name text,
  p_cpf_normalized text,
  p_email_normalized text,
  p_phone_e164 text,
  p_role text,
  p_property_name text DEFAULT NULL::text,
  p_activity_type text DEFAULT NULL::text,
  p_municipality text DEFAULT NULL::text,
  p_state text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_person_id uuid;
  v_municipality_id uuid;
BEGIN
  IF p_role NOT IN ('consumer','producer') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PUBLIC_ROLE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.app_users WHERE id=p_user_id AND status='active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='APP_USER_NOT_READY';
  END IF;

  IF nullif(trim(coalesce(p_municipality,'')),'') IS NOT NULL THEN
    v_municipality_id := public.fn_assert_locality_covered(
      coalesce(nullif(trim(coalesce(p_state,'')),''),'RO'),
      p_municipality
    );
  END IF;

  -- Se a tentativa é uma nova identidade com o mesmo CPF de conta bloqueada,
  -- arquiva somente o cadastro pessoal antigo para liberar a revisão da nova
  -- identidade. O bloqueio e o histórico anteriores permanecem auditáveis.
  UPDATE public.app_people p
     SET archived_at=COALESCE(p.archived_at,clock_timestamp())
    FROM public.app_users u
   WHERE u.id=p.user_id
     AND u.status='blocked'
     AND p.user_id IS DISTINCT FROM p_user_id
     AND p.archived_at IS NULL
     AND (
       p.cpf_normalized=p_cpf_normalized
       OR p.email_normalized=lower(trim(p_email_normalized))
     );

  INSERT INTO public.app_people(
    user_id,full_name,cpf_normalized,email_normalized,phone_e164,municipality_id
  )
  VALUES(
    p_user_id,trim(p_full_name),p_cpf_normalized,
    lower(trim(p_email_normalized)),p_phone_e164,v_municipality_id
  )
  RETURNING id INTO v_person_id;

  INSERT INTO public.app_user_role_assignments(user_id,role_code)
  VALUES(p_user_id,p_role);

  IF p_role='producer' THEN
    INSERT INTO public.app_producer_profiles(
      person_id,property_name,rural_activity_type,verification_status,trust_level
    )
    VALUES(v_person_id,NULL,NULL,'declared',0);
  END IF;

  RETURN v_person_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_account_reactivation(
  p_user_id uuid,
  p_role text,
  p_property_name text DEFAULT NULL::text,
  p_activity_type text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE result uuid;
BEGIN
  IF p_role NOT IN ('consumer','producer')
     OR NOT EXISTS(
       SELECT 1 FROM public.app_users
        WHERE id=p_user_id AND status IN ('deleted','blocked')
     )
     OR EXISTS(
       SELECT 1 FROM public.app_admin_principals WHERE admin_user_id=p_user_id
     )
  THEN
    RAISE EXCEPTION 'REACTIVATION_NOT_ALLOWED' USING ERRCODE='22023';
  END IF;

  PERFORM 1 FROM public.app_users WHERE id=p_user_id FOR UPDATE;

  INSERT INTO public.app_registration_reviews(
    user_id,matched_user_ids,reasons,requested_role,property_name,activity_type
  )
  VALUES(
    p_user_id,ARRAY[p_user_id],ARRAY['cpf','name'],p_role,p_property_name,p_activity_type
  )
  ON CONFLICT(user_id) WHERE status='pending'
  DO UPDATE SET requested_role=EXCLUDED.requested_role
  RETURNING id INTO result;

  UPDATE public.app_users
     SET status='pending',authorization_revision=authorization_revision+1,updated_at=clock_timestamp()
   WHERE id=p_user_id;

  RETURN result;
END
$function$;

-- 6) Limpa tombstones espelho antigos que já não existem no Supabase Auth.
-- Mantemos app_account_deletions e pessoas arquivadas apenas como trilha de segurança.
INSERT INTO public.app_account_deletions(
  user_id,cpf_normalized,name_key,email_normalized,deleted_by,deleted_at
)
SELECT u.id,p.cpf_normalized,public.governance_name_key(p.full_name),
       p.email_normalized,
       COALESCE(u.blocked_by,(
         SELECT ap.admin_user_id
           FROM public.app_admin_principals ap
          ORDER BY ap.created_at
          LIMIT 1
       )),
       COALESCE(u.updated_at,clock_timestamp())
  FROM public.app_users u
  JOIN public.app_people p ON p.user_id=u.id
 WHERE u.block_reason='auth_user_deleted'
   AND NOT EXISTS(SELECT 1 FROM auth.users au WHERE au.id=u.id)
   AND NOT EXISTS(SELECT 1 FROM public.app_account_deletions d WHERE d.user_id=u.id)
   AND COALESCE(u.blocked_by,(
         SELECT ap.admin_user_id FROM public.app_admin_principals ap ORDER BY ap.created_at LIMIT 1
       )) IS NOT NULL;

UPDATE public.app_people p
   SET archived_at=COALESCE(p.archived_at,clock_timestamp())
  FROM public.app_users u
 WHERE p.user_id=u.id
   AND u.block_reason='auth_user_deleted'
   AND NOT EXISTS(SELECT 1 FROM auth.users au WHERE au.id=u.id);

DELETE FROM public.app_users u
 WHERE u.block_reason='auth_user_deleted'
   AND NOT EXISTS(SELECT 1 FROM auth.users au WHERE au.id=u.id);

COMMENT ON TABLE public.app_locality_user_impacts IS
  'Registra pessoas afetadas pela remoção física de uma localidade para aviso e reconexão automática se a cobertura retornar.';
COMMENT ON TABLE public.app_storage_deletion_queue IS
  'Fila de objetos que devem ser removidos exclusivamente pela Supabase Storage API.';
