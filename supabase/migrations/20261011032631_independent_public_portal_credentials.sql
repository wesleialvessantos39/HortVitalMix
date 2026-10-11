-- Separate public passwords and sessions while preserving domain IDs and data.
CREATE SCHEMA IF NOT EXISTS hvm_identity_private;
REVOKE ALL ON SCHEMA hvm_identity_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA hvm_identity_private TO service_role;

CREATE TABLE public.app_public_portal_credentials (
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 role_code text NOT NULL CHECK(role_code IN ('consumer','producer')),
 password_hash text NOT NULL,
 password_format text NOT NULL CHECK(password_format IN ('legacy_bcrypt','sha256_bcrypt')),
 email_verified_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,role_code)
);
CREATE TABLE public.app_public_portal_sessions (
 session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 role_code text NOT NULL CHECK(role_code IN ('consumer','producer')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX public_portal_sessions_user_role ON public.app_public_portal_sessions(user_id,role_code);
CREATE TABLE public.app_public_portal_email_flows (
 token_digest text PRIMARY KEY CHECK(token_digest ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 role_code text NOT NULL CHECK(role_code IN ('consumer','producer')),
 purpose text NOT NULL CHECK(purpose IN ('confirmation','login')),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX public_portal_flows_identity ON public.app_public_portal_email_flows(user_id,role_code,purpose);
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['app_public_portal_credentials','app_public_portal_sessions','app_public_portal_email_flows'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',relation);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',relation);
 END LOOP;
END $$;

-- Copy existing one-way hashes, never plaintext, and never modify Auth passwords.
-- Accounts with no password cannot use password login until scoped recovery.
INSERT INTO public.app_public_portal_credentials(user_id,role_code,password_hash,password_format,email_verified_at)
SELECT r.user_id,r.role_code,coalesce(nullif(a.encrypted_password,''),'!no-password'),'legacy_bcrypt',a.email_confirmed_at
FROM public.app_user_role_assignments r JOIN auth.users a ON a.id=r.user_id
WHERE r.role_code IN ('consumer','producer') AND r.revoked_at IS NULL;
-- Preserve existing sessions of a single public portal. An ambiguous legacy
-- session must authenticate once again; no account or session is deleted here.
INSERT INTO public.app_public_portal_sessions(session_id,user_id,role_code)
SELECT s.id,s.user_id,min(r.role_code) FROM auth.sessions s
JOIN public.app_user_role_assignments r ON r.user_id=s.user_id AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>now())
WHERE r.role_code IN ('consumer','producer') GROUP BY s.id,s.user_id HAVING count(*)=1;

CREATE FUNCTION hvm_identity_private.seed_credential() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.role_code IN ('consumer','producer') THEN
 INSERT INTO public.app_public_portal_credentials(user_id,role_code,password_hash,password_format,email_verified_at)
 SELECT NEW.user_id,NEW.role_code,coalesce(nullif(a.encrypted_password,''),'!no-password'),'legacy_bcrypt',
   CASE WHEN NOT EXISTS(SELECT 1 FROM public.app_public_portal_credentials c WHERE c.user_id=NEW.user_id) THEN a.email_confirmed_at END
 FROM auth.users a WHERE a.id=NEW.user_id ON CONFLICT(user_id,role_code) DO NOTHING;
 END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hvm_identity_private.seed_credential() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER seed_public_portal_credential AFTER INSERT ON public.app_user_role_assignments FOR EACH ROW EXECUTE FUNCTION hvm_identity_private.seed_credential();

CREATE FUNCTION hvm_identity_private.fn_public_portal_login(p_email text,p_role text,p_password text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.app_public_portal_credentials; uid uuid; mail text; confirmed boolean;
BEGIN
 SELECT x.* INTO c
 FROM public.app_public_portal_credentials x JOIN public.app_people p ON p.user_id=x.user_id AND p.archived_at IS NULL
 JOIN auth.users a ON a.id=x.user_id JOIN public.app_user_role_assignments r ON r.user_id=x.user_id AND r.role_code=x.role_code
 WHERE p.email_normalized=lower(btrim(p_email)) AND x.role_code=p_role AND r.revoked_at IS NULL AND(r.expires_at IS NULL OR r.expires_at>now()) LIMIT 1;
 SELECT email,email_confirmed_at IS NOT NULL INTO mail,confirmed FROM auth.users WHERE id=c.user_id;
 IF c.user_id IS NULL OR c.password_hash='!no-password' OR
 c.password_hash<>extensions.crypt(CASE WHEN c.password_format='sha256_bcrypt' THEN encode(extensions.digest(p_password,'sha256'),'hex') ELSE p_password END,c.password_hash) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('userId',c.user_id,'authEmail',mail,'confirmed',confirmed AND c.email_verified_at IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION hvm_identity_private.fn_public_portal_login(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_identity_private.fn_public_portal_login(text,text,text) TO service_role;
CREATE FUNCTION public.fn_public_portal_login(p_email text,p_role text,p_password text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT hvm_identity_private.fn_public_portal_login(p_email,p_role,p_password); $$;
REVOKE ALL ON FUNCTION public.fn_public_portal_login(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_portal_login(text,text,text) TO service_role;

CREATE FUNCTION hvm_identity_private.fn_bind_public_portal_session(p_user uuid,p_session uuid,p_role text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s JOIN public.app_public_portal_credentials c ON c.user_id=s.user_id
 WHERE s.id=p_session AND s.user_id=p_user AND c.role_code=p_role AND c.email_verified_at IS NOT NULL AND(s.not_after IS NULL OR s.not_after>now())) THEN RETURN false; END IF;
 INSERT INTO public.app_public_portal_sessions(session_id,user_id,role_code) VALUES(p_session,p_user,p_role) ON CONFLICT(session_id) DO NOTHING;
 RETURN EXISTS(SELECT 1 FROM public.app_public_portal_sessions WHERE session_id=p_session AND user_id=p_user AND role_code=p_role);
END;
$$;
REVOKE ALL ON FUNCTION hvm_identity_private.fn_bind_public_portal_session(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_identity_private.fn_bind_public_portal_session(uuid,uuid,text) TO service_role;
CREATE FUNCTION public.fn_bind_public_portal_session(p_user uuid,p_session uuid,p_role text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT hvm_identity_private.fn_bind_public_portal_session(p_user,p_session,p_role); $$;
REVOKE ALL ON FUNCTION public.fn_bind_public_portal_session(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bind_public_portal_session(uuid,uuid,text) TO service_role;

CREATE FUNCTION hvm_identity_private.fn_public_portal_session_role(p_user uuid,p_session uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 RETURN (SELECT b.role_code FROM public.app_public_portal_sessions b JOIN auth.sessions s ON s.id=b.session_id AND s.user_id=b.user_id
 WHERE b.user_id=p_user AND b.session_id=p_session AND(s.not_after IS NULL OR s.not_after>now()));
END;
$$;
REVOKE ALL ON FUNCTION hvm_identity_private.fn_public_portal_session_role(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_identity_private.fn_public_portal_session_role(uuid,uuid) TO service_role;
CREATE FUNCTION public.fn_public_portal_session_role(p_user uuid,p_session uuid) RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT hvm_identity_private.fn_public_portal_session_role(p_user,p_session); $$;
REVOKE ALL ON FUNCTION public.fn_public_portal_session_role(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_portal_session_role(uuid,uuid) TO service_role;

CREATE FUNCTION hvm_identity_private.fn_register_independent_public_role(p_user uuid,p_cpf text,p_email text,p_role text,p_name text,p_phone text,p_password text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('public-role:'||p_user::text,0));
 IF p_role NOT IN ('consumer','producer') OR NOT EXISTS(SELECT 1 FROM public.app_people WHERE user_id=p_user AND cpf_normalized=p_cpf AND email_normalized=p_email AND archived_at IS NULL) THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
 IF EXISTS(SELECT 1 FROM public.app_user_role_assignments WHERE user_id=p_user AND role_code=p_role AND revoked_at IS NULL) THEN RETURN false; END IF;
 PERFORM public.add_public_role_with_profile(p_user,p_cpf,p_email,p_role,p_name,p_phone);
 UPDATE public.app_public_portal_credentials SET password_hash=extensions.crypt(encode(extensions.digest(p_password,'sha256'),'hex'),extensions.gen_salt('bf',12)),password_format='sha256_bcrypt',email_verified_at=NULL,updated_at=clock_timestamp() WHERE user_id=p_user AND role_code=p_role;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION hvm_identity_private.fn_register_independent_public_role(uuid,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_identity_private.fn_register_independent_public_role(uuid,text,text,text,text,text,text) TO service_role;
CREATE FUNCTION public.fn_register_independent_public_role(p_user uuid,p_cpf text,p_email text,p_role text,p_name text,p_phone text,p_password text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT hvm_identity_private.fn_register_independent_public_role(p_user,p_cpf,p_email,p_role,p_name,p_phone,p_password); $$;
REVOKE ALL ON FUNCTION public.fn_register_independent_public_role(uuid,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_register_independent_public_role(uuid,text,text,text,text,text,text) TO service_role;

CREATE FUNCTION hvm_identity_private.fn_public_portal_confirmed(p_user uuid,p_role text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 RETURN EXISTS(SELECT 1 FROM public.app_public_portal_credentials WHERE user_id=p_user AND role_code=p_role AND email_verified_at IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION hvm_identity_private.fn_public_portal_confirmed(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_identity_private.fn_public_portal_confirmed(uuid,text) TO service_role;
CREATE FUNCTION public.fn_public_portal_confirmed(p_user uuid,p_role text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT hvm_identity_private.fn_public_portal_confirmed(p_user,p_role); $$;
REVOKE ALL ON FUNCTION public.fn_public_portal_confirmed(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_portal_confirmed(uuid,text) TO service_role;

CREATE FUNCTION hvm_identity_private.fn_issue_public_portal_email_flow(p_user uuid,p_role text,p_purpose text,p_digest text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_public_portal_credentials WHERE user_id=p_user AND role_code=p_role) THEN RETURN false; END IF;
 INSERT INTO public.app_public_portal_email_flows(token_digest,user_id,role_code,purpose) VALUES(p_digest,p_user,p_role,p_purpose); RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION hvm_identity_private.fn_issue_public_portal_email_flow(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_identity_private.fn_issue_public_portal_email_flow(uuid,text,text,text) TO service_role;
CREATE FUNCTION public.fn_issue_public_portal_email_flow(p_user uuid,p_role text,p_purpose text,p_digest text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT hvm_identity_private.fn_issue_public_portal_email_flow(p_user,p_role,p_purpose,p_digest); $$;
REVOKE ALL ON FUNCTION public.fn_issue_public_portal_email_flow(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_issue_public_portal_email_flow(uuid,text,text,text) TO service_role;

CREATE FUNCTION hvm_identity_private.fn_consume_public_portal_email_flow(p_user uuid,p_role text,p_purpose text,p_digest text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.app_public_portal_email_flows SET consumed_at=clock_timestamp() WHERE token_digest=p_digest AND user_id=p_user AND role_code=p_role AND purpose=p_purpose AND consumed_at IS NULL AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_purpose='confirmation' THEN UPDATE public.app_public_portal_credentials SET email_verified_at=clock_timestamp() WHERE user_id=p_user AND role_code=p_role; END IF; RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION hvm_identity_private.fn_consume_public_portal_email_flow(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_identity_private.fn_consume_public_portal_email_flow(uuid,text,text,text) TO service_role;
CREATE FUNCTION public.fn_consume_public_portal_email_flow(p_user uuid,p_role text,p_purpose text,p_digest text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT hvm_identity_private.fn_consume_public_portal_email_flow(p_user,p_role,p_purpose,p_digest); $$;
REVOKE ALL ON FUNCTION public.fn_consume_public_portal_email_flow(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_consume_public_portal_email_flow(uuid,text,text,text) TO service_role;

CREATE FUNCTION hvm_identity_private.fn_reset_public_portal_password(p_user uuid,p_role text,p_password text,p_digest text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE proof public.app_role_security_challenges;
BEGIN
 UPDATE public.app_role_security_challenges SET consumed_at=clock_timestamp() WHERE user_id=p_user AND role_code=p_role AND purpose='password_recovery' AND token_digest=p_digest AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at>clock_timestamp() AND attempts_count<max_attempts RETURNING * INTO proof;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.app_public_portal_credentials SET password_hash=extensions.crypt(encode(extensions.digest(p_password,'sha256'),'hex'),extensions.gen_salt('bf',12)),password_format='sha256_bcrypt',email_verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE user_id=p_user AND role_code=p_role;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUBLIC_PORTAL_CREDENTIAL_MISSING'; END IF;
 DELETE FROM auth.sessions WHERE id IN(SELECT session_id FROM public.app_public_portal_sessions WHERE user_id=p_user AND role_code=p_role);
 INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,client_ip_hash,payload_after) VALUES(proof.request_id,p_user,p_role,'password.reset.completed','app_role_security_challenges',proof.id,repeat('0',64),jsonb_build_object('portalRole',p_role));
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION hvm_identity_private.fn_reset_public_portal_password(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_identity_private.fn_reset_public_portal_password(uuid,text,text,text) TO service_role;
CREATE FUNCTION public.fn_reset_public_portal_password(p_user uuid,p_role text,p_password text,p_digest text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT hvm_identity_private.fn_reset_public_portal_password(p_user,p_role,p_password,p_digest); $$;
REVOKE ALL ON FUNCTION public.fn_reset_public_portal_password(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reset_public_portal_password(uuid,text,text,text) TO service_role;

CREATE FUNCTION hvm_identity_private.fn_change_public_portal_password(p_user uuid,p_role text,p_password text,p_challenge uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE proof public.app_role_security_challenges;
BEGIN
 UPDATE public.app_role_security_challenges SET consumed_at=clock_timestamp() WHERE id=p_challenge AND user_id=p_user AND role_code=p_role AND purpose='security_code' AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at>clock_timestamp() AND attempts_count<max_attempts RETURNING * INTO proof;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.app_public_portal_credentials SET password_hash=extensions.crypt(encode(extensions.digest(p_password,'sha256'),'hex'),extensions.gen_salt('bf',12)),password_format='sha256_bcrypt',updated_at=clock_timestamp() WHERE user_id=p_user AND role_code=p_role;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUBLIC_PORTAL_CREDENTIAL_MISSING'; END IF;
 DELETE FROM auth.sessions WHERE id IN(SELECT session_id FROM public.app_public_portal_sessions WHERE user_id=p_user AND role_code=p_role);
 INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,client_ip_hash,payload_after) VALUES(proof.request_id,p_user,p_role,'password.changed','app_role_security_challenges',proof.id,repeat('0',64),jsonb_build_object('portalRole',p_role));
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION hvm_identity_private.fn_change_public_portal_password(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_identity_private.fn_change_public_portal_password(uuid,text,text,uuid) TO service_role;
CREATE FUNCTION public.fn_change_public_portal_password(p_user uuid,p_role text,p_password text,p_challenge uuid) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT hvm_identity_private.fn_change_public_portal_password(p_user,p_role,p_password,p_challenge); $$;
REVOKE ALL ON FUNCTION public.fn_change_public_portal_password(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_change_public_portal_password(uuid,text,text,uuid) TO service_role;

-- Existing RLS role checks now require the server-bound public portal too.
CREATE OR REPLACE FUNCTION public.has_role(required_role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.has_role_for(auth.uid(),required_role) AND (required_role NOT IN ('consumer','producer') OR EXISTS(
 SELECT 1 FROM public.app_public_portal_sessions b JOIN auth.sessions s ON s.id=b.session_id AND s.user_id=b.user_id
 WHERE b.user_id=auth.uid() AND b.role_code=required_role AND b.session_id=nullif(auth.jwt()->>'session_id','')::uuid AND(s.not_after IS NULL OR s.not_after>now())));
$$;
REVOKE ALL ON FUNCTION public.has_role(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_role(text) TO authenticated,service_role;
COMMENT ON TABLE public.app_public_portal_credentials IS 'Passwords are independent by portal. Domain person references never grant another login. Backend only, no client grants.';
COMMENT ON TABLE public.app_public_portal_sessions IS 'A Supabase token authorizes exactly the public portal verified by the backend; a cookie cannot change it.';

CREATE FUNCTION hvm_identity_private.fn_unassigned_mailbox_identity(p_email text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 RETURN (SELECT a.id FROM auth.users a WHERE lower(a.email)=lower(btrim(p_email))
 AND NOT EXISTS(SELECT 1 FROM public.app_user_role_assignments r WHERE r.user_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM public.app_people p WHERE p.user_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM public.app_admin_principals p WHERE p.admin_user_id=a.id));
END;
$$;
REVOKE ALL ON FUNCTION hvm_identity_private.fn_unassigned_mailbox_identity(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_identity_private.fn_unassigned_mailbox_identity(text) TO service_role;
CREATE FUNCTION public.fn_unassigned_mailbox_identity(p_email text) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT hvm_identity_private.fn_unassigned_mailbox_identity(p_email); $$;
REVOKE ALL ON FUNCTION public.fn_unassigned_mailbox_identity(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_unassigned_mailbox_identity(text) TO service_role;

CREATE FUNCTION hvm_identity_private.fn_attach_public_identity(p_person uuid,p_user uuid,p_cpf text,p_email text,p_role text,p_name text,p_phone text,p_password text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_owner uuid;
BEGIN
 SELECT user_id INTO old_owner FROM public.app_people WHERE id=p_person AND cpf_normalized=p_cpf AND email_normalized=p_email AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.app_user_role_assignments WHERE user_id=old_owner AND role_code IN ('consumer','producer')) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.app_user_role_assignments WHERE user_id=p_user) OR EXISTS(SELECT 1 FROM public.app_admin_principals WHERE admin_user_id=p_user) THEN RETURN false; END IF;
 UPDATE public.app_people SET user_id=p_user WHERE id=p_person;
 RETURN hvm_identity_private.fn_register_independent_public_role(p_user,p_cpf,p_email,p_role,p_name,p_phone,p_password);
END;
$$;
REVOKE ALL ON FUNCTION hvm_identity_private.fn_attach_public_identity(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_identity_private.fn_attach_public_identity(uuid,uuid,text,text,text,text,text,text) TO service_role;
CREATE FUNCTION public.fn_attach_public_identity(p_person uuid,p_user uuid,p_cpf text,p_email text,p_role text,p_name text,p_phone text,p_password text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT hvm_identity_private.fn_attach_public_identity(p_person,p_user,p_cpf,p_email,p_role,p_name,p_phone,p_password); $$;
REVOKE ALL ON FUNCTION public.fn_attach_public_identity(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_attach_public_identity(uuid,uuid,text,text,text,text,text,text) TO service_role;

CREATE FUNCTION hvm_identity_private.fn_resolve_public_portal_email_flow(p_role text,p_purpose text,p_digest text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('userId',f.user_id,'email',p.email_normalized) FROM public.app_public_portal_email_flows f JOIN public.app_people p ON p.user_id=f.user_id
 WHERE f.role_code=p_role AND f.purpose=p_purpose AND f.token_digest=p_digest AND f.consumed_at IS NULL AND f.expires_at>clock_timestamp();
$$;
REVOKE ALL ON FUNCTION hvm_identity_private.fn_resolve_public_portal_email_flow(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_identity_private.fn_resolve_public_portal_email_flow(text,text,text) TO service_role;
CREATE FUNCTION public.fn_resolve_public_portal_email_flow(p_role text,p_purpose text,p_digest text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT hvm_identity_private.fn_resolve_public_portal_email_flow(p_role,p_purpose,p_digest); $$;
REVOKE ALL ON FUNCTION public.fn_resolve_public_portal_email_flow(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_public_portal_email_flow(text,text,text) TO service_role;

-- Restrict every private client read to a valid portal. Existing anonymous
-- projections and administrative policies keep their original visibility.
DO $$ DECLARE p record; gate text; BEGIN
 FOR p IN SELECT * FROM pg_policies WHERE schemaname='public' AND 'authenticated'=ANY(roles) AND cmd='SELECT'
   AND qual IS NOT NULL AND policyname NOT LIKE '%public_read' AND policyname NOT LIKE '%read_all'
 LOOP
  gate := 'public.has_role(''consumer'') OR public.has_role(''producer'') OR public.is_any_platform_admin()';
  IF p.policyname IN ('producer_profiles_self_read','properties_self_read','property_boundaries_self_read','rural_activities_self_read','verification_requests_producer_read','verification_decisions_producer_final_read','delivery_municipalities_owner_read','delivery_scope_owner_read','store_owner_read','hours_owner_read','products_owner_read','price_owner_read','media_owner_read','store_media_owner_read','trial_owner_read','order_producer_read','delivery_windows_owner_read') THEN
   gate := 'public.has_role(''producer'')';
  ELSIF p.policyname IN ('favorites_owner_read','order_customer_read','delivery_proofs_customer_read','refunds_owner_read') OR (p.policyname='quote_owner_read' AND p.tablename IN ('app_checkout_quotes','app_delivery_quotes')) THEN
   gate := 'public.has_role(''consumer'')';
  ELSIF p.tablename='app_notifications' THEN gate := 'public.has_role(recipient_role)';
  ELSIF p.tablename='app_complaints' THEN gate := 'public.has_role(reporter_role)';
  ELSIF p.tablename='app_subscriptions' THEN gate := 'public.has_role(coalesce(plan_snapshot->>''targetAudience'',''consumer''))';
  END IF;
  EXECUTE format('ALTER POLICY %I ON public.%I USING ((%s) AND (%s))',p.policyname,p.tablename,p.qual,gate);
 END LOOP;
END $$;
ALTER POLICY orders_participant_read ON public.app_orders USING (
 (customer_user_id=(SELECT auth.uid()) AND public.has_role('consumer')) OR
 (producer_user_id=(SELECT auth.uid()) AND public.has_role('producer'))
);
ALTER POLICY pos_owner_read ON public.app_pos_sales USING (
 (customer_user_id=(SELECT auth.uid()) AND public.has_role('consumer')) OR
 (producer_user_id=(SELECT auth.uid()) AND public.has_role('producer'))
);
