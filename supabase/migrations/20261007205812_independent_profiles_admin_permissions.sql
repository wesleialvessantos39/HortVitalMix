-- Correções após T25: perfis por cadastro e poderes administrativos revogáveis.
-- Identidades, Auth, negócio e todas as migrations anteriores são preservados.
CREATE SCHEMA hvm_governance_private;
REVOKE ALL ON SCHEMA hvm_governance_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA hvm_governance_private TO authenticated,service_role;

CREATE TABLE public.app_account_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 role_code varchar(32) NOT NULL REFERENCES public.app_roles(code) ON DELETE RESTRICT,
 person_id uuid NOT NULL REFERENCES public.app_people(id) ON DELETE CASCADE,
 full_name varchar(255) NOT NULL CHECK(length(trim(full_name)) BETWEEN 3 AND 255),
 cpf_normalized char(11) NOT NULL,
 email_normalized varchar(255) NOT NULL,
 phone_e164 varchar(32) NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(user_id,role_code),
 CHECK(role_code IN ('consumer','producer','platform_admin','platform_super_admin'))
);
CREATE INDEX ix_account_profiles_role ON public.app_account_profiles(role_code);
CREATE INDEX ix_account_profiles_person ON public.app_account_profiles(person_id);
ALTER TABLE public.app_account_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_account_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_account_profiles FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.app_account_profiles TO service_role;

CREATE TABLE public.app_admin_permission_overrides (
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 sector_code varchar(64) NOT NULL REFERENCES public.app_admin_sectors(code) ON DELETE RESTRICT,
 allowed boolean NOT NULL,
 changed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,sector_code)
);
CREATE INDEX ix_permission_overrides_sector ON public.app_admin_permission_overrides(sector_code);
CREATE INDEX ix_permission_overrides_actor ON public.app_admin_permission_overrides(changed_by);
ALTER TABLE public.app_admin_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_permission_overrides FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_admin_permission_overrides FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.app_admin_permission_overrides TO service_role;

CREATE FUNCTION hvm_governance_private.seed_profiles(uid uuid) RETURNS void
LANGUAGE sql SET search_path='' AS $$
 INSERT INTO public.app_account_profiles(user_id,role_code,person_id,full_name,cpf_normalized,email_normalized,phone_e164,revision)
 SELECT r.user_id,r.role_code,p.id,
 CASE WHEN edited.actor_id=r.user_id AND edited.actor_role=r.role_code THEN p.full_name
      WHEN length(trim(au.raw_user_meta_data->>'full_name')) BETWEEN 3 AND 255 THEN trim(au.raw_user_meta_data->>'full_name')
      ELSE p.full_name END,
 p.cpf_normalized,coalesce(ap.admin_email,p.email_normalized),p.phone_e164,p.revision
 FROM public.app_user_role_assignments r
 LEFT JOIN public.app_admin_principals ap ON ap.admin_user_id=r.user_id AND ap.portal_role=r.role_code
 JOIN public.app_people p ON p.id=ap.person_id OR (ap.person_id IS NULL AND p.user_id=r.user_id)
 LEFT JOIN auth.users au ON au.id=r.user_id
 LEFT JOIN LATERAL (SELECT a.actor_id,a.actor_role FROM public.app_audit_events a WHERE a.target_entity='app_people' AND a.target_id=p.id AND a.action='profile.updated' ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1) edited ON true
 WHERE r.user_id=uid AND r.role_code IN ('consumer','producer','platform_admin','platform_super_admin')
 ON CONFLICT(user_id,role_code) DO NOTHING;
$$;
CREATE FUNCTION hvm_governance_private.seed_profile_trigger() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='app_admin_principals' THEN PERFORM hvm_governance_private.seed_profiles(NEW.admin_user_id);
 ELSIF TG_TABLE_NAME='app_people' THEN PERFORM hvm_governance_private.seed_profiles(NEW.user_id);
 ELSE PERFORM hvm_governance_private.seed_profiles(NEW.user_id); END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER account_profile_from_role AFTER INSERT OR UPDATE ON public.app_user_role_assignments FOR EACH ROW EXECUTE FUNCTION hvm_governance_private.seed_profile_trigger();
CREATE TRIGGER account_profile_from_principal AFTER INSERT ON public.app_admin_principals FOR EACH ROW EXECUTE FUNCTION hvm_governance_private.seed_profile_trigger();
CREATE TRIGGER account_profile_from_person AFTER INSERT ON public.app_people FOR EACH ROW EXECUTE FUNCTION hvm_governance_private.seed_profile_trigger();
SELECT hvm_governance_private.seed_profiles(id) FROM public.app_users;
REVOKE ALL ON FUNCTION hvm_governance_private.seed_profiles(uuid),hvm_governance_private.seed_profile_trigger() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_governance_private.seed_profiles(uuid),hvm_governance_private.seed_profile_trigger() TO service_role;

-- Backend RPC usada somente ao concluir um cadastro de papel novo.
CREATE FUNCTION public.set_registration_role_profile(p_user_id uuid,p_role text,p_full_name text,p_phone_e164 text) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF p_role NOT IN ('consumer','producer') OR length(trim(p_full_name)) NOT BETWEEN 3 AND 255 OR p_phone_e164 !~ '^\+55[1-9][0-9]9[0-9]{8}$' THEN RAISE EXCEPTION 'INVALID_PROFILE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_user_role_assignments r JOIN public.app_users u ON u.id=r.user_id WHERE r.user_id=p_user_id AND r.role_code=p_role AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>now()) AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active') THEN RAISE EXCEPTION 'PROFILE_NOT_AUTHORIZED'; END IF;
 UPDATE public.app_account_profiles SET full_name=trim(p_full_name),phone_e164=p_phone_e164,updated_at=clock_timestamp() WHERE user_id=p_user_id AND role_code=p_role;
 IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_registration_role_profile(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_registration_role_profile(uuid,text,text,text) TO service_role;

-- A exceção de Super administrador é explícita e não sobrepõe uma revogação.
CREATE FUNCTION hvm_governance_private.has_permission(uid uuid,sector text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_users u
 JOIN public.app_admin_principals ap ON ap.admin_user_id=u.id
 JOIN public.app_user_role_assignments r ON r.user_id=u.id AND r.role_code=ap.portal_role
 JOIN public.app_admin_sectors s ON s.code=sector AND s.is_active
 WHERE u.id=uid AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
 AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>now())
 AND NOT EXISTS(SELECT 1 FROM public.app_admin_permission_overrides o WHERE o.user_id=u.id AND o.sector_code=sector AND NOT o.allowed)
 AND (ap.portal_role='platform_super_admin' OR EXISTS(SELECT 1 FROM public.app_admin_sector_members m WHERE m.user_id=u.id AND m.sector_code=sector AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>now()))));
$$;
CREATE FUNCTION hvm_governance_private.not_denied(sector text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.app_admin_permission_overrides o WHERE o.user_id=(SELECT auth.uid()) AND o.sector_code=sector AND NOT o.allowed);
$$;
REVOKE ALL ON FUNCTION hvm_governance_private.has_permission(uuid,text),hvm_governance_private.not_denied(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_governance_private.has_permission(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION hvm_governance_private.not_denied(text) TO authenticated,service_role;

-- Policies adicionais restritivas fecham também leituras diretas de clientes.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('app_admin_auth_attempts','account_governance'),('app_admin_invites','account_governance'),('app_admin_invite_sectors','account_governance'),
 ('app_admin_principals','account_governance'),('app_admin_sector_members','account_governance'),('app_users','account_governance'),
 ('app_people','account_governance'),('app_user_role_assignments','account_governance'),('app_audit_events','account_governance'),
 ('app_outbox_events','account_governance'),('app_documents','document_verification'),('app_verification_requests','document_verification'),
 ('app_verification_decisions','document_verification'),('app_delivery_attempts','finance_ops')
 ) AS mapping(tbl,sector) LOOP
 EXECUTE format('CREATE POLICY administrative_permission_restriction ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT hvm_governance_private.not_denied(%L)))',item.tbl,item.sector);
 END LOOP;
END $$;
CREATE POLICY notification_permission_restriction ON public.app_notifications AS RESTRICTIVE FOR SELECT TO authenticated USING(required_sector IS NULL OR hvm_governance_private.not_denied(required_sector));

-- Proteção SQL e API: mantém outro Super com governança plena, sem prazo.
CREATE OR REPLACE FUNCTION public.delete_active_account(p_user_id uuid,p_actor_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE v_person uuid; v_public boolean;
BEGIN
 IF p_user_id=p_actor_id THEN RAISE EXCEPTION 'SUPER_ADMIN_PROTECTED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('hvm-account-blocks'));
 IF EXISTS(SELECT 1 FROM app_user_role_assignments WHERE user_id=p_user_id AND role_code='platform_super_admin' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())) AND (
 NOT hvm_governance_private.has_permission(p_actor_id,'account_governance') OR NOT EXISTS(SELECT 1 FROM app_admin_principals WHERE admin_user_id=p_actor_id AND portal_role='platform_super_admin') OR NOT EXISTS(
 SELECT 1 FROM app_admin_principals ap JOIN app_users u ON u.id=ap.admin_user_id JOIN app_user_role_assignments r ON r.user_id=u.id AND r.role_code='platform_super_admin'
 WHERE u.id<>p_user_id AND ap.portal_role='platform_super_admin' AND r.revoked_at IS NULL AND r.expires_at IS NULL AND u.status='active'
 AND hvm_governance_private.has_permission(u.id,'account_governance'))
 ) THEN RAISE EXCEPTION 'LAST_SUPER_ADMIN_PROTECTED'; END IF;
 PERFORM 1 FROM app_users WHERE id=p_user_id FOR UPDATE;
 SELECT p.id,p.user_id=p_user_id INTO v_person,v_public FROM app_people p LEFT JOIN app_admin_principals ap ON ap.person_id=p.id WHERE p.user_id=p_user_id OR ap.admin_user_id=p_user_id LIMIT 1;
 IF v_public THEN DELETE FROM app_producer_profiles WHERE person_id=v_person; END IF;
 DELETE FROM app_registration_reviews WHERE user_id=p_user_id;
 DELETE FROM auth.users WHERE id=p_user_id;
 DELETE FROM app_users WHERE id=p_user_id;
 IF v_person IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_people WHERE id=v_person AND user_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM app_admin_principals WHERE person_id=v_person) THEN DELETE FROM app_people WHERE id=v_person; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_active_account(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_active_account(uuid,uuid) TO service_role;

CREATE POLICY seller_contact_permission_restriction ON public.app_refund_seller_contacts AS RESTRICTIVE FOR SELECT TO authenticated
 USING((SELECT hvm_governance_private.not_denied('refund_management')));

-- Registro do segundo papel e seu perfil em uma única transação.
CREATE FUNCTION public.add_public_role_with_profile(p_user_id uuid,p_cpf_normalized text,p_email_normalized text,p_role text,p_full_name text,p_phone_e164 text)
RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE person uuid;
BEGIN
 person:=public.add_public_role_to_existing_identity(p_user_id,p_cpf_normalized,p_email_normalized,p_role);
 PERFORM public.set_registration_role_profile(p_user_id,p_role,p_full_name,p_phone_e164);
 RETURN person;
END;
$$;
REVOKE ALL ON FUNCTION public.add_public_role_with_profile(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_public_role_with_profile(uuid,text,text,text,text,text) TO service_role;

-- O novo serviço transacional atua como service_role; clientes seguem só SELECT.
GRANT INSERT,UPDATE ON public.app_admin_sector_members TO service_role;
