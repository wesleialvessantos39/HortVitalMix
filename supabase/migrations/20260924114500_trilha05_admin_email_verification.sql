-- Trilha 05 — confirmação explícita do e-mail administrativo
ALTER TABLE public.app_admin_principals
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS ix_app_admin_principals_unverified_email
  ON public.app_admin_principals(admin_email)
  WHERE email_verified_at IS NULL;

COMMENT ON COLUMN public.app_admin_principals.email_verified_at IS
'Momento em que o proprietário da credencial administrativa confirmou o e-mail por OTP do Supabase Auth.';

-- Credenciais administrativas criadas por convite já passam por um link enviado ao
-- endereço de destino; a aplicação marca esse campo durante o aceite do convite.
-- O primeiro Super administrador existente permanece NULL para exigir a
-- confirmação explícita após a implantação desta migration.
