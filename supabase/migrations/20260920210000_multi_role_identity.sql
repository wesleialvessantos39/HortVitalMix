-- HortiVitalMix — multi-role public identity.
-- Preserva CPF único/canônico em app_people e permite que a mesma pessoa
-- tenha consumer + producer por app_user_role_assignments.

CREATE OR REPLACE FUNCTION public.add_public_role_to_existing_identity(
  p_user_id UUID,
  p_cpf_normalized TEXT,
  p_email_normalized TEXT,
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

  SELECT p.id
    INTO v_person_id
    FROM public.app_people p
   WHERE p.user_id = p_user_id
     AND p.cpf_normalized = p_cpf_normalized
     AND p.email_normalized = lower(trim(p_email_normalized))
   FOR UPDATE;

  IF v_person_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IDENTITY_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.app_user_role_assignments r
     WHERE r.user_id = p_user_id
       AND r.role_code = p_role
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'ROLE_ALREADY_ASSIGNED';
  END IF;

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

REVOKE ALL ON FUNCTION public.add_public_role_to_existing_identity(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_public_role_to_existing_identity(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.add_public_role_to_existing_identity(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) IS 'Adiciona consumer/producer à identidade canônica existente sem duplicar CPF ou app_people.';
