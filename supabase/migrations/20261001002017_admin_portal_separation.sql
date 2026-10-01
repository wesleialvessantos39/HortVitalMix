-- Separação estrita das portas administrativas.
-- O resolver de login administrativo deixa de expor o e-mail da pessoa
-- vinculada: cadastro público (Produtor/Consumidor) não pode resolver um
-- principal administrativo. Só o e-mail administrativo declarado entra.

DROP VIEW IF EXISTS public.app_admin_login_resolver;

CREATE VIEW public.app_admin_login_resolver AS
SELECT
  ap.admin_email::text AS login_email,
  ap.admin_user_id,
  ap.email_verified_at,
  ap.portal_role,
  ap.auth_email,
  'admin_email'::text AS alias_kind
FROM public.app_admin_principals ap;

REVOKE ALL ON public.app_admin_login_resolver FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_admin_login_resolver TO service_role;

COMMENT ON VIEW public.app_admin_login_resolver IS
  'Fonte canônica server-side dos identificadores de login administrativo. Expõe somente o e-mail administrativo declarado em app_admin_principals: o e-mail da pessoa vinculada não autoriza acesso administrativo.';
