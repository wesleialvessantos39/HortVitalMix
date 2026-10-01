-- HortiVitalMix — Trava de cobertura por localidade no cadastro público (item 2) — 2026-10-01.
-- Estritamente aditivo. Depende de 20261001120000_locality_coverage_foundation.sql.
--
-- Objetivo: nenhum cadastro público (consumidor ou produtor) é concluído fora de um
-- município cadastrado e ATIVO. A regra é aplicada na função de domínio para valer
-- para os dois caminhos de escrita já homologados (Express e Supabase Edge), não
-- apenas na borda HTTP.

-- Município declarado no cadastro. Fica em app_people porque é o mesmo dado para
-- consumidor e produtor; o imóvel rural continua com o município próprio em app_properties.
ALTER TABLE public.app_people
  ADD COLUMN IF NOT EXISTS municipality_id uuid NULL
  REFERENCES public.app_municipalities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_app_people_municipality
  ON public.app_people(municipality_id) WHERE municipality_id IS NOT NULL;

COMMENT ON COLUMN public.app_people.municipality_id IS
  'Município de cobertura declarado no cadastro público; nulo para cadastros anteriores à trava.';

-- Assertiva de cobertura reutilizável, com SQLSTATE próprio para o mapeamento público
-- distinguir "sem cobertura" de "dados inválidos".
CREATE OR REPLACE FUNCTION public.fn_assert_locality_covered(p_state text, p_name text)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path=public,pg_catalog AS $$
DECLARE
  v_id uuid;
  v_coverage text;
BEGIN
  v_coverage := public.fn_locality_coverage(p_state, p_name);
  IF v_coverage <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = 'HVMLC',
      MESSAGE = CASE WHEN v_coverage = 'inactive'
                     THEN 'REGISTRATION_LOCALITY_DISABLED'
                     ELSE 'REGISTRATION_LOCALITY_NOT_COVERED' END;
  END IF;
  SELECT m.id INTO v_id
    FROM public.app_municipalities m
   WHERE m.state = upper(coalesce(p_state,''))
     AND m.name_normalized = public.fn_locality_normalize(p_name);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_assert_locality_covered(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_assert_locality_covered(text,text) TO service_role;

COMMENT ON FUNCTION public.fn_assert_locality_covered(text,text) IS
  'Falha com SQLSTATE HVMLC quando o município informado não está cadastrado ou está desativado.';

-- Substituição da função de domínio do cadastro público.
-- A assinatura passa a aceitar o município declarado. Os parâmetros novos têm valor
-- padrão para que uma invocação antiga (sem localidade) continue resolvendo, sem
-- criar sobrecarga ambígua no PostgREST. A versão anterior de 8 parâmetros é removida.
DROP FUNCTION IF EXISTS public.complete_public_registration(
  uuid,text,text,text,text,text,text,text);

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
  v_person_id UUID;
  v_municipality_id UUID;
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

  -- Trava de cobertura: consumidor e produtor só entram em município ativo.
  IF nullif(trim(coalesce(p_municipality, '')), '') IS NOT NULL THEN
    v_municipality_id := public.fn_assert_locality_covered(
      coalesce(nullif(trim(coalesce(p_state, '')), ''), 'RO'),
      p_municipality);
  END IF;

  INSERT INTO public.app_people(
    user_id,
    full_name,
    cpf_normalized,
    email_normalized,
    phone_e164,
    municipality_id
  )
  VALUES(
    p_user_id,
    trim(p_full_name),
    p_cpf_normalized,
    lower(trim(p_email_normalized)),
    p_phone_e164,
    v_municipality_id
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
$function$;

REVOKE ALL ON FUNCTION public.complete_public_registration(
  uuid,text,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_public_registration(
  uuid,text,text,text,text,text,text,text,text,text) TO service_role;
