BEGIN;

-- Extensão aditiva: o RPC anterior e todas as regras de cobertura/revisão continuam ativos.
CREATE FUNCTION public.complete_public_registration_with_consent(
  p_user_id uuid, p_full_name text, p_cpf_normalized text, p_email_normalized text,
  p_phone_e164 text, p_role text, p_municipality text, p_state text,
  p_policy_version text, p_ip_hash text, p_user_agent text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE v_person_id uuid; v_status text;
BEGIN
  IF p_policy_version IS DISTINCT FROM 'lgpd-cadastro-2026-10-02'
     OR coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$'
     OR length(coalesce(p_user_agent, '')) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='INVALID_REGISTRATION_CONSENT';
  END IF;
  v_person_id := public.complete_public_registration(
    p_user_id, p_full_name, p_cpf_normalized, p_email_normalized, p_phone_e164, p_role,
    NULL, NULL, p_municipality, p_state);
  INSERT INTO public.app_consent_records(person_id,consent_type,is_granted,policy_version,ip_hash,user_agent)
    VALUES(v_person_id,'lgpd_cadastro',true,p_policy_version,p_ip_hash,p_user_agent);
  SELECT status INTO STRICT v_status FROM public.app_users WHERE id=p_user_id;
  RETURN jsonb_build_object('personId',v_person_id,'status',v_status,'role',p_role,'lgpdRecorded',true);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_public_registration_with_consent(uuid,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_public_registration_with_consent(uuid,text,text,text,text,text,text,text,text,text,text) TO service_role;
COMMENT ON FUNCTION public.complete_public_registration_with_consent(uuid,text,text,text,text,text,text,text,text,text,text)
  IS 'Cadastro público e aceite explícito atômicos, somente backend. Preserva RPC legado e confirmação obrigatória.';

COMMIT;
