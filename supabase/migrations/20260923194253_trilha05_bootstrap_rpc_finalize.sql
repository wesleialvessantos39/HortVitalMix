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
      FROM public.app_people p
     WHERE p.user_id <> p_user_id
       AND (
         p.email_normalized = lower(trim(p_email_normalized))
         OR p.cpf_normalized = p_cpf_normalized
       )
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
  ON CONFLICT (user_id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    cpf_normalized = EXCLUDED.cpf_normalized,
    email_normalized = EXCLUDED.email_normalized,
    phone_e164 = EXCLUDED.phone_e164,
    email_verified_at = clock_timestamp(),
    revision = public.app_people.revision + 1,
    updated_at = clock_timestamp();

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
    'app_users',
    p_user_id,
    jsonb_build_object('role','platform_super_admin'),
    p_client_ip_hash,
    p_command_id
  );

  RETURN jsonb_build_object('status','completed','userId',p_user_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_finalize_first_super_admin(
  uuid,text,text,text,text,uuid,uuid,text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_finalize_first_super_admin(
  uuid,text,text,text,text,uuid,uuid,text
) TO service_role;

COMMENT ON FUNCTION public.fn_finalize_first_super_admin(
  uuid,text,text,text,text,uuid,uuid,text
) IS
'Finaliza de forma transacional o primeiro Super administrador após a criação da identidade no Supabase Auth. Executável somente por service_role.';
