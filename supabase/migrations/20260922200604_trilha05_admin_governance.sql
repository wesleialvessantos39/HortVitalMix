-- Volume 01 / Trilha 05 — Governança Administrativa
-- Fonte: MANUAL MESTRE TÉCNICO v10 — TRILHAS 01 A 06.
-- Compatibilidade preservada com a decisão vigente do Livro Raiz:
-- e-mails de segurança são entregues exclusivamente pelo Supabase Auth/SMTP interno.
-- Por isso o OTP de MFA é persistido como hash pelo GoTrue e a tabela da aplicação
-- registra o desafio/estado sem duplicar o segredo.

CREATE TABLE public.app_admin_sectors (
  code varchar(64) PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  name varchar(128) NOT NULL,
  description text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.app_admin_sectors(code,name,description) VALUES
 ('document_verification','Setor de Análise Documental Rural','Homologação de CAR/CCIR e validação de vínculo rural'),
 ('catalog_moderation','Moderação de Produtos','Auditoria de hortaliças, higienização e lojas publicadas'),
 ('finance_ops','Operações Financeiras','Gestão de repasses, liquidações e conciliação com gateway')
ON CONFLICT(code) DO UPDATE SET name=excluded.name,description=excluded.description,is_active=true;

CREATE TABLE public.app_admin_sector_members (
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 sector_code varchar(64) NOT NULL REFERENCES public.app_admin_sectors(code) ON DELETE RESTRICT,
 assigned_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
 assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 authorization_version integer NOT NULL DEFAULT 1 CHECK(authorization_version>0),
 expires_at timestamptz NULL,
 revoked_at timestamptz NULL,
 revoked_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
 revoke_reason varchar(255) NULL,
 PRIMARY KEY(user_id,sector_code)
);
CREATE INDEX ix_app_admin_sector_members_active ON public.app_admin_sector_members(user_id,sector_code) WHERE revoked_at IS NULL;
CREATE INDEX ix_app_admin_sector_members_expires ON public.app_admin_sector_members(expires_at) WHERE revoked_at IS NULL AND expires_at IS NOT NULL;

CREATE TABLE public.app_admin_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email varchar(255) NOT NULL CHECK(email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
 target_role varchar(64) NOT NULL REFERENCES public.app_roles(code) ON DELETE RESTRICT,
 token_digest char(64) NOT NULL UNIQUE CHECK(token_digest ~ '^[0-9a-f]{64}$'),
 invited_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 is_accepted boolean NOT NULL DEFAULT false,
 accepted_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
 accepted_at timestamptz NULL,
 expires_at timestamptz NOT NULL,
 invalidated_at timestamptz NULL,
 auth_user_id uuid NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT chk_admin_invite_role CHECK(target_role IN('platform_admin','platform_super_admin')),
 CONSTRAINT chk_admin_invite_expiry CHECK(expires_at>created_at)
);
CREATE INDEX ix_app_admin_invites_email_active ON public.app_admin_invites(lower(email)) WHERE is_accepted=false AND invalidated_at IS NULL;
CREATE INDEX ix_app_admin_invites_pending ON public.app_admin_invites(expires_at) WHERE is_accepted=false AND invalidated_at IS NULL;

CREATE TABLE public.app_admin_invite_sectors (
 invite_id uuid NOT NULL REFERENCES public.app_admin_invites(id) ON DELETE CASCADE,
 sector_code varchar(64) NOT NULL REFERENCES public.app_admin_sectors(code) ON DELETE RESTRICT,
 PRIMARY KEY(invite_id,sector_code)
);

CREATE TABLE public.app_admin_mfa_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 otp_hash char(64) NULL CHECK(otp_hash IS NULL OR otp_hash ~ '^[0-9a-f]{64}$'),
 otp_salt char(32) NULL CHECK(otp_salt IS NULL OR otp_salt ~ '^[0-9a-f]{32}$'),
 provider varchar(32) NOT NULL DEFAULT 'supabase_auth_email_otp' CHECK(provider IN('supabase_auth_email_otp','local_hash')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts>0),
 expires_at timestamptz NOT NULL,
 is_verified boolean NOT NULL DEFAULT false,
 verified_at timestamptz NULL,
 invalidated_at timestamptz NULL,
 request_id uuid NOT NULL,
 command_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT chk_admin_mfa_expiry CHECK(expires_at>created_at),
 CONSTRAINT chk_admin_mfa_material CHECK(
  (provider='supabase_auth_email_otp' AND otp_hash IS NULL AND otp_salt IS NULL)
  OR (provider='local_hash' AND otp_hash IS NOT NULL AND otp_salt IS NOT NULL)
 )
);
CREATE INDEX ix_app_admin_mfa_active ON public.app_admin_mfa_challenges(user_id,created_at DESC) WHERE is_verified=false AND invalidated_at IS NULL;

CREATE TABLE public.app_admin_auth_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email_hash char(64) NOT NULL CHECK(email_hash ~ '^[0-9a-f]{64}$'),
 ip_hash char(64) NOT NULL CHECK(ip_hash ~ '^[0-9a-f]{64}$'),
 outcome varchar(16) NOT NULL CHECK(outcome IN('success','failure','mfa_pending','mfa_failure')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_app_admin_auth_attempts_email ON public.app_admin_auth_attempts(email_hash,occurred_at DESC);
CREATE INDEX ix_app_admin_auth_attempts_ip ON public.app_admin_auth_attempts(ip_hash,occurred_at DESC);

CREATE OR REPLACE FUNCTION public.has_role_for(user_uuid uuid,required_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.app_user_role_assignments r
  JOIN public.app_users u ON u.id=r.user_id
  WHERE r.user_id=user_uuid AND r.role_code=required_role
   AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>now())
   AND u.status='active'
 );
$$;

CREATE OR REPLACE FUNCTION public.fn_is_last_active_super_admin(candidate_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.has_role_for(candidate_user_id,'platform_super_admin') AND (
  SELECT count(*) FROM public.app_user_role_assignments r
  JOIN public.app_users u ON u.id=r.user_id
  WHERE r.role_code='platform_super_admin' AND r.revoked_at IS NULL
   AND (r.expires_at IS NULL OR r.expires_at>now()) AND u.status='active'
 )<=1;
$$;

ALTER TABLE public.app_admin_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_sectors FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_sector_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_sector_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_invite_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_invite_sectors FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_mfa_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_auth_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY sectors_read_all ON public.app_admin_sectors FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY sector_members_self_read ON public.app_admin_sector_members FOR SELECT TO authenticated USING((SELECT auth.uid())=user_id);
CREATE POLICY sector_members_super_admin_read ON public.app_admin_sector_members FOR SELECT TO authenticated USING((SELECT public.is_platform_super_admin()));
CREATE POLICY invites_super_admin_read ON public.app_admin_invites FOR SELECT TO authenticated USING((SELECT public.is_platform_super_admin()));
CREATE POLICY invite_sectors_super_admin_read ON public.app_admin_invite_sectors FOR SELECT TO authenticated USING((SELECT public.is_platform_super_admin()));
CREATE POLICY mfa_self_read ON public.app_admin_mfa_challenges FOR SELECT TO authenticated USING((SELECT auth.uid())=user_id);
CREATE POLICY auth_attempts_super_admin_read ON public.app_admin_auth_attempts FOR SELECT TO authenticated USING((SELECT public.is_platform_super_admin()));

REVOKE ALL ON public.app_admin_sectors,public.app_admin_sector_members,public.app_admin_invites,
 public.app_admin_invite_sectors,public.app_admin_mfa_challenges,public.app_admin_auth_attempts
 FROM anon,authenticated;
GRANT SELECT ON public.app_admin_sectors TO anon,authenticated;
GRANT SELECT ON public.app_admin_sector_members,public.app_admin_invites,public.app_admin_invite_sectors,
 public.app_admin_mfa_challenges,public.app_admin_auth_attempts TO authenticated;

CREATE TRIGGER trg_app_admin_invites_updated_at
BEFORE UPDATE ON public.app_admin_invites
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_bump_updated_at();

REVOKE ALL ON FUNCTION public.has_role_for(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_is_last_active_super_admin(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.has_role_for(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_last_active_super_admin(uuid) TO service_role;

COMMENT ON TABLE public.app_admin_sectors IS 'Catálogo canônico de setores administrativos — Volume 01 / Trilha 05 / Manual v10.';
COMMENT ON TABLE public.app_admin_sector_members IS 'Associação N:N de usuários administrativos com setores.';
COMMENT ON TABLE public.app_admin_invites IS 'Convites administrativos; token HortiVitalMix persistido somente como SHA-256.';
COMMENT ON TABLE public.app_admin_invite_sectors IS 'Setores materializados no convite antes da ativação da identidade administrativa.';
COMMENT ON TABLE public.app_admin_mfa_challenges IS 'Desafios MFA para Super administrador. No modo Supabase Auth-only, o hash do OTP fica sob custódia do GoTrue.';
COMMENT ON TABLE public.app_admin_auth_attempts IS 'Rate limiting persistente do login administrativo.';
