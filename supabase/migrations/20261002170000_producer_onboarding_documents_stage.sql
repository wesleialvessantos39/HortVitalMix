-- Producer onboarding no longer asks for the first property's name/activity.
-- Legacy profile values remain readable but are nullable for newly-created roles.
ALTER TABLE public.app_producer_profiles
  ALTER COLUMN property_name DROP NOT NULL,
  ALTER COLUMN rural_activity_type DROP NOT NULL,
  ALTER COLUMN rural_activity_type DROP DEFAULT;

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
  IF p_role NOT IN ('consumer', 'producer') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PUBLIC_ROLE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.app_users
     WHERE id = p_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'APP_USER_NOT_READY';
  END IF;

  IF nullif(trim(coalesce(p_municipality, '')), '') IS NOT NULL THEN
    v_municipality_id := public.fn_assert_locality_covered(
      coalesce(nullif(trim(coalesce(p_state, '')), ''), 'RO'),
      p_municipality
    );
  END IF;

  INSERT INTO public.app_people(
    user_id, full_name, cpf_normalized, email_normalized, phone_e164,
    municipality_id
  )
  VALUES (
    p_user_id, trim(p_full_name), p_cpf_normalized,
    lower(trim(p_email_normalized)), p_phone_e164, v_municipality_id
  )
  RETURNING id INTO v_person_id;

  INSERT INTO public.app_user_role_assignments(user_id, role_code)
  VALUES(p_user_id, p_role);

  IF p_role = 'producer' THEN
    INSERT INTO public.app_producer_profiles(
      person_id, property_name, rural_activity_type, verification_status,
      trust_level
    )
    VALUES(v_person_id, NULL, NULL, 'declared', 0);
  END IF;

  RETURN v_person_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_public_registration(
  uuid,text,text,text,text,text,text,text,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_public_registration(
  uuid,text,text,text,text,text,text,text,text,text
) TO service_role;

CREATE OR REPLACE FUNCTION public.add_public_role_to_existing_identity(
  p_user_id uuid,
  p_cpf_normalized text,
  p_email_normalized text,
  p_role text,
  p_property_name text DEFAULT NULL,
  p_activity_type text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_id uuid;
BEGIN
  IF p_role NOT IN ('consumer', 'producer') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PUBLIC_ROLE';
  END IF;

  SELECT p.id INTO v_person_id
    FROM public.app_people p
   WHERE p.user_id = p_user_id
     AND p.cpf_normalized = p_cpf_normalized
     AND p.email_normalized = lower(trim(p_email_normalized))
   FOR UPDATE;

  IF v_person_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IDENTITY_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.app_user_role_assignments r
     WHERE r.user_id = p_user_id AND r.role_code = p_role
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'ROLE_ALREADY_ASSIGNED';
  END IF;

  INSERT INTO public.app_user_role_assignments(user_id, role_code)
  VALUES(p_user_id, p_role);

  IF p_role = 'producer' THEN
    INSERT INTO public.app_producer_profiles(
      person_id, property_name, rural_activity_type, verification_status,
      trust_level
    )
    VALUES(v_person_id, NULL, NULL, 'declared', 0);
  END IF;

  RETURN v_person_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_public_role_to_existing_identity(
  uuid,text,text,text,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_public_role_to_existing_identity(
  uuid,text,text,text,text,text
) TO service_role;

-- Step 1 is now the property's document. Existing wizard values shift forward,
-- preserving their relative progress, while submitted/completed records remain at 6.
ALTER TABLE public.app_properties
  DROP CONSTRAINT app_properties_wizard_current_step_check,
  ADD CONSTRAINT app_properties_wizard_current_step_check
    CHECK (wizard_current_step BETWEEN 1 AND 6);

UPDATE public.app_properties
   SET wizard_current_step = LEAST(wizard_current_step + 1, 6);

UPDATE public.app_properties
   SET draft_data = jsonb_set(
     draft_data,
     '{step}',
     to_jsonb(LEAST((draft_data->>'step')::integer + 1, 6)),
     false
   )
 WHERE draft_data IS NOT NULL
   AND draft_data ? 'step'
   AND (draft_data->>'step') ~ '^[1-5]$';

ALTER TABLE public.app_properties
  DROP CONSTRAINT ck_app_properties_submission_complete,
  ADD CONSTRAINT ck_app_properties_submission_complete CHECK (
    status = 'draft' OR (
      property_name IS NOT NULL AND rural_zone_sector IS NOT NULL
      AND line_vicinal IS NOT NULL AND latitude_sede IS NOT NULL
      AND longitude_sede IS NOT NULL AND total_area_hectares IS NOT NULL
      AND cultivated_area_hectares IS NOT NULL AND water_source IS NOT NULL
      AND irrigation_system IS NOT NULL AND wizard_current_step = 6
    )
  );

COMMENT ON COLUMN public.app_producer_profiles.property_name IS
  'Legacy registration field; new producer registration leaves it NULL. Property names belong to app_properties.';
COMMENT ON COLUMN public.app_producer_profiles.rural_activity_type IS
  'Legacy registration field; new defaults are derived from the producer''s first configured rural property.';
