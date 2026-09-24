-- Volume 01 / Trilha 05 — identidade administrativa separada da identidade pública
-- Objetivo: permitir que a mesma pessoa/CPF possua cadastro público (consumer/producer)
-- e credencial administrativa independente, sem duplicar app_people.

CREATE TABLE public.app_admin_principals (
  admin_user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL UNIQUE REFERENCES public.app_people(id) ON DELETE RESTRICT,
  admin_email varchar(255) NOT NULL UNIQUE
    CHECK(admin_email = lower(trim(admin_email)))
    CHECK(admin_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX ix_app_admin_principals_person
  ON public.app_admin_principals(person_id);

ALTER TABLE public.app_admin_invites
  ADD COLUMN target_person_id uuid NULL REFERENCES public.app_people(id) ON DELETE RESTRICT,
  ADD COLUMN identity_mode varchar(16) NOT NULL DEFAULT 'new'
    CHECK(identity_mode IN ('new','existing'));

CREATE INDEX ix_app_admin_invites_target_person
  ON public.app_admin_invites(target_person_id)
  WHERE target_person_id IS NOT NULL;

DROP POLICY IF EXISTS invites_super_admin_read ON public.app_admin_invites;
CREATE POLICY invites_admin_hierarchy_read
  ON public.app_admin_invites
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_platform_super_admin())
    OR invited_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS invite_sectors_super_admin_read ON public.app_admin_invite_sectors;
CREATE POLICY invite_sectors_admin_hierarchy_read
  ON public.app_admin_invite_sectors
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_platform_super_admin())
    OR EXISTS (
      SELECT 1
        FROM public.app_admin_invites i
       WHERE i.id = invite_id
         AND i.invited_by = (SELECT auth.uid())
    )
  );

ALTER TABLE public.app_admin_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_principals FORCE ROW LEVEL SECURITY;

CREATE POLICY admin_principals_self_read
  ON public.app_admin_principals
  FOR SELECT TO authenticated
  USING (admin_user_id = (SELECT auth.uid()));

CREATE POLICY admin_principals_super_admin_read
  ON public.app_admin_principals
  FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_super_admin()));

REVOKE ALL ON public.app_admin_principals FROM anon,authenticated;
GRANT SELECT ON public.app_admin_principals TO authenticated;

CREATE TRIGGER trg_app_admin_principals_updated_at
BEFORE UPDATE ON public.app_admin_principals
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_bump_updated_at();

CREATE OR REPLACE FUNCTION public.fn_finalize_first_super_admin(
  p_user_id uuid,
  p_full_name text,
  p_cpf_normalized text,
  p_email_normalized text,
  p_phone_e164 text,
  p_request_id uuid,
  p_command_id uuid,
  p_client_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_support_email text;
  v_person_id uuid;
  v_public_user_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('hortivitalmix_admin_bootstrap'));

  SELECT lower(trim(support_email))
    INTO v_support_email
    FROM public.app_global_config
   WHERE singleton_guard = true
   LIMIT 1;

  IF v_support_email IS NULL THEN
    RETURN jsonb_build_object('status','disabled');
  END IF;

  IF lower(trim(p_email_normalized)) <> v_support_email THEN
    RETURN jsonb_build_object('status','email_not_authorized');
  END IF;

  IF p_cpf_normalized !~ '^[0-9]{11}$'
     OR p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     OR length(trim(p_full_name)) < 3
     OR p_client_ip_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status','validation_failed');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.app_user_role_assignments r
      JOIN public.app_users u ON u.id = r.user_id
     WHERE r.role_code = 'platform_super_admin'
       AND r.revoked_at IS NULL
       AND (r.expires_at IS NULL OR r.expires_at > now())
       AND u.status = 'active'
  ) THEN
    RETURN jsonb_build_object('status','already_closed');
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM auth.users au
     WHERE au.id = p_user_id
       AND lower(trim(au.email)) = lower(trim(p_email_normalized))
  ) THEN
    RETURN jsonb_build_object('status','auth_identity_missing');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.app_admin_principals ap
     WHERE ap.admin_email = lower(trim(p_email_normalized))
        OR ap.admin_user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('status','identity_conflict');
  END IF;

  SELECT p.id,p.user_id
    INTO v_person_id,v_public_user_id
    FROM public.app_people p
   WHERE p.cpf_normalized = p_cpf_normalized
   LIMIT 1
   FOR UPDATE;

  IF v_person_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.app_admin_principals ap WHERE ap.person_id=v_person_id
  ) THEN
    RETURN jsonb_build_object('status','identity_conflict');
  END IF;

  INSERT INTO public.app_users(
    id,status,blocked_at,blocked_by,block_reason,updated_at
  )
  VALUES (
    p_user_id,'active',NULL,NULL,NULL,clock_timestamp()
  )
  ON CONFLICT (id) DO UPDATE SET
    status = 'active',
    blocked_at = NULL,
    blocked_by = NULL,
    block_reason = NULL,
    authorization_revision = public.app_users.authorization_revision + 1,
    revision = public.app_users.revision + 1,
    updated_at = clock_timestamp();

  IF v_person_id IS NULL THEN
    INSERT INTO public.app_people(
      user_id,
      full_name,
      cpf_normalized,
      email_normalized,
      phone_e164,
      email_verified_at
    )
    VALUES (
      p_user_id,
      trim(p_full_name),
      p_cpf_normalized,
      lower(trim(p_email_normalized)),
      p_phone_e164,
      clock_timestamp()
    )
    RETURNING id INTO v_person_id;
  END IF;

  INSERT INTO public.app_admin_principals(
    admin_user_id,person_id,admin_email,created_by
  )
  VALUES (
    p_user_id,v_person_id,lower(trim(p_email_normalized)),p_user_id
  )
  ON CONFLICT (admin_user_id) DO UPDATE SET
    person_id=EXCLUDED.person_id,
    admin_email=EXCLUDED.admin_email,
    updated_at=clock_timestamp();

  INSERT INTO public.app_user_role_assignments(
    user_id,role_code,granted_by,expires_at,revoked_at,revoked_by,revoke_reason
  )
  VALUES (
    p_user_id,'platform_super_admin',p_user_id,NULL,NULL,NULL,NULL
  )
  ON CONFLICT (user_id, role_code) DO UPDATE SET
    granted_by = EXCLUDED.granted_by,
    granted_at = clock_timestamp(),
    expires_at = NULL,
    revoked_at = NULL,
    revoked_by = NULL,
    revoke_reason = NULL;

  INSERT INTO public.app_audit_events(
    request_id,
    actor_id,
    actor_role,
    action,
    target_entity,
    target_id,
    payload_after,
    client_ip_hash,
    command_id
  )
  VALUES (
    p_request_id,
    p_user_id,
    'platform_super_admin',
    'admin.bootstrap.completed',
    'app_admin_principals',
    p_user_id,
    jsonb_build_object(
      'role','platform_super_admin',
      'personId',v_person_id,
      'linkedExistingPerson',v_public_user_id IS NOT NULL
    ),
    p_client_ip_hash,
    p_command_id
  );

  RETURN jsonb_build_object(
    'status','completed',
    'userId',p_user_id,
    'personId',v_person_id,
    'linkedExistingPerson',v_public_user_id IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_finalize_first_super_admin(
  uuid,text,text,text,text,uuid,uuid,text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_finalize_first_super_admin(
  uuid,text,text,text,text,uuid,uuid,text
) TO service_role;

COMMENT ON TABLE public.app_admin_principals IS
'Credencial administrativa separada vinculada a uma pessoa canônica. Permite CPF único em app_people com cadastro administrativo independente.';

COMMENT ON COLUMN public.app_admin_invites.target_person_id IS
'Pessoa canônica já existente que receberá credencial administrativa independente; NULL para novo cadastro administrativo.';

COMMENT ON COLUMN public.app_admin_invites.identity_mode IS
'new cria pessoa/credencial administrativa nova; existing vincula a credencial administrativa a app_people existente.';

COMMENT ON FUNCTION public.fn_finalize_first_super_admin(
  uuid,text,text,text,text,uuid,uuid,text
) IS
'Finaliza o primeiro Super administrador. Se o CPF já existir em app_people, cria credencial administrativa separada e vincula à pessoa sem duplicar CPF.';
