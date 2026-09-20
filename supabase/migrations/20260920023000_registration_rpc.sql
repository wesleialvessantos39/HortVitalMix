-- HortiVitalMix — cadastro público transacional via Supabase RPC.
-- Remove o Postgres Pooler do caminho crítico de cadastro em runtime serverless.

CREATE OR REPLACE FUNCTION public.complete_public_registration(
  p_user_id UUID,
  p_full_name TEXT,
  p_cpf_normalized TEXT,
  p_email_normalized TEXT,
  p_phone_e164 TEXT,
  p_role TEXT,
  p_property_name TEXT DEFAULT NULL,
  p_activity_type TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_id UUID;
BEGIN
  IF p_role NOT IN ('consumer', 'producer') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PUBLIC_ROLE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.app_users
     WHERE id = p_user_id
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'APP_USER_NOT_READY';
  END IF;

  INSERT INTO public.app_people(
    user_id,
    full_name,
    cpf_normalized,
    email_normalized,
    phone_e164
  )
  VALUES(
    p_user_id,
    trim(p_full_name),
    p_cpf_normalized,
    lower(trim(p_email_normalized)),
    p_phone_e164
  )
  RETURNING id INTO v_person_id;

  INSERT INTO public.app_user_role_assignments(user_id, role_code)
  VALUES(p_user_id, p_role);

  IF p_role = 'producer' THEN
    IF nullif(trim(coalesce(p_property_name, '')), '') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROPERTY_NAME_REQUIRED';
    END IF;

    INSERT INTO public.app_producer_profiles(
      person_id,
      property_name,
      rural_activity_type,
      verification_status,
      trust_level
    )
    VALUES(
      v_person_id,
      trim(p_property_name),
      coalesce(nullif(trim(p_activity_type), ''), 'misto'),
      'declared',
      0
    );
  END IF;

  RETURN v_person_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_public_registration(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_public_registration(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.complete_public_registration(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) IS 'Conclui cadastro público de consumer/producer em uma única transação; executável apenas por service_role.';
