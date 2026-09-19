-- HortiVitalMix v10 / Trilha 01. Errata autorizada em 2026-09-19.
CREATE FUNCTION public.has_role(required_role TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_user_role_assignments r JOIN public.app_users u ON u.id=r.user_id WHERE r.user_id=auth.uid() AND u.status='active' AND r.role_code=required_role AND r.revoked_at IS NULL AND(r.expires_at IS NULL OR r.expires_at>now()));$$;
CREATE FUNCTION public.is_platform_super_admin() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT public.has_role('platform_super_admin');$$;
CREATE FUNCTION public.is_any_platform_admin() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT public.has_role('platform_super_admin') OR public.has_role('platform_admin');$$;
CREATE FUNCTION public.current_person_id() RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT p.id FROM public.app_people p JOIN public.app_users u ON u.id=p.user_id WHERE p.user_id=auth.uid() AND u.status='active' LIMIT 1;$$;
CREATE FUNCTION public.hash_ip(ip_text TEXT) RETURNS CHAR(64) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE pepper TEXT:=current_setting('app.ip_pepper',true);BEGIN IF pepper IS NULL OR length(pepper)<16 THEN RAISE EXCEPTION 'AUDIT_PEPPER_NOT_CONFIGURED';END IF;RETURN encode(extensions.digest(coalesce(ip_text,'')||pepper,'sha256'),'hex')::CHAR(64);END;$$;
REVOKE ALL ON FUNCTION public.has_role(TEXT),public.is_platform_super_admin(),public.is_any_platform_admin(),public.current_person_id(),public.hash_ip(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(TEXT),public.is_platform_super_admin(),public.is_any_platform_admin(),public.current_person_id() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.hash_ip(TEXT) TO service_role;
COMMENT ON FUNCTION public.has_role(TEXT) IS 'Papel ativo de conta ativa autenticada; jamais usa user_metadata.';
COMMENT ON FUNCTION public.is_platform_super_admin() IS 'Verifica papel canônico de superadministrador.';
COMMENT ON FUNCTION public.is_any_platform_admin() IS 'Verifica papel administrativo ativo.';
COMMENT ON FUNCTION public.current_person_id() IS 'Resolve pessoa da conta autenticada ativa, sem parâmetro de usuário.';
COMMENT ON FUNCTION public.hash_ip(TEXT) IS 'SHA-256 de IP e pepper transacional, executável somente no backend.';
