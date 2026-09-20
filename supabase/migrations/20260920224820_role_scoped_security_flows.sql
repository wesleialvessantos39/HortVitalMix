CREATE TABLE IF NOT EXISTS public.app_role_security_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role_code VARCHAR(64) NOT NULL REFERENCES public.app_roles(code) ON DELETE RESTRICT,
  purpose VARCHAR(32) NOT NULL
    CHECK (purpose IN ('password_recovery','security_code')),
  token_digest CHAR(64) NULL
    CHECK (token_digest IS NULL OR token_digest ~ '^[0-9a-f]{64}$'),
  attempts_count INTEGER NOT NULL DEFAULT 0 CHECK (attempts_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  invalidated_at TIMESTAMPTZ NULL,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_role_security_expiry CHECK (expires_at > created_at),
  CONSTRAINT chk_role_security_token_shape CHECK (
    (purpose = 'password_recovery' AND token_digest IS NOT NULL)
    OR
    (purpose = 'security_code' AND token_digest IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_role_security_token_digest
  ON public.app_role_security_challenges(token_digest)
  WHERE token_digest IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_app_role_security_active
  ON public.app_role_security_challenges(user_id, role_code, purpose, created_at DESC)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

ALTER TABLE public.app_role_security_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_role_security_challenges FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_role_security_challenges FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.app_role_security_challenges IS
'Escopo de segurança por papel para recuperação de senha e códigos de reautenticação. Impede reutilização cruzada entre consumer, producer, platform_admin e platform_super_admin.';

COMMENT ON COLUMN public.app_role_security_challenges.token_digest IS
'Digest SHA-256 do token de contexto da recuperação. Nunca persistir token em claro.';
