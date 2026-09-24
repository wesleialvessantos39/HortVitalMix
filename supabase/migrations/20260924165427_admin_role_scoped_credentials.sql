-- Trilha 05 hotfix — credenciais administrativas segregadas por portal
-- Administrador e Super administrador podem representar a mesma pessoa/CPF e
-- usar o mesmo Gmail de entrada, mantendo senhas e identidades Auth separadas.

ALTER TABLE public.app_admin_principals
  ADD COLUMN IF NOT EXISTS portal_role varchar(64) NOT NULL DEFAULT 'platform_super_admin',
  ADD COLUMN IF NOT EXISTS auth_email varchar(255) NULL;

UPDATE public.app_admin_principals ap
SET portal_role = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.app_user_role_assignments r
    WHERE r.user_id = ap.admin_user_id
      AND r.role_code = 'platform_super_admin'
      AND r.revoked_at IS NULL
      AND (r.expires_at IS NULL OR r.expires_at > now())
  ) THEN 'platform_super_admin'
  ELSE 'platform_admin'
END;

UPDATE public.app_admin_principals
SET auth_email = admin_email
WHERE auth_email IS NULL;

ALTER TABLE public.app_admin_principals
  DROP CONSTRAINT IF EXISTS app_admin_principals_person_id_key,
  DROP CONSTRAINT IF EXISTS app_admin_principals_admin_email_key;

ALTER TABLE public.app_admin_principals
  ADD CONSTRAINT app_admin_principals_portal_role_check
    CHECK (portal_role IN ('platform_admin','platform_super_admin')),
  ADD CONSTRAINT app_admin_principals_auth_email_check
    CHECK (
      auth_email IS NULL OR (
        auth_email = lower(trim(auth_email))
        AND position('@' in auth_email) > 1
        AND position('.' in split_part(auth_email,'@',2)) > 1
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_admin_principals_person_role
  ON public.app_admin_principals(person_id, portal_role);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_admin_principals_email_role
  ON public.app_admin_principals(admin_email, portal_role);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_admin_principals_auth_email
  ON public.app_admin_principals(auth_email)
  WHERE auth_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_app_admin_principals_login
  ON public.app_admin_principals(admin_email, portal_role, admin_user_id);

ALTER TABLE public.app_admin_invites
  ADD COLUMN IF NOT EXISTS auth_email varchar(255) NULL;

COMMENT ON COLUMN public.app_admin_principals.portal_role IS
'Portal administrativo desta credencial. Administrador e Super administrador são identidades de acesso separadas.';

COMMENT ON COLUMN public.app_admin_principals.auth_email IS
'E-mail técnico da identidade Supabase Auth. Pode usar alias Gmail interno; admin_email permanece o e-mail digitado no portal.';

COMMENT ON COLUMN public.app_admin_invites.auth_email IS
'E-mail técnico usado no Supabase Auth para manter senha independente por portal sem alterar o e-mail de entrada exibido ao usuário.';
