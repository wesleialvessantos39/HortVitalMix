-- HortiVitalMix — Volume 01 / Trilha 04 — confirmação dupla de contato e recuperação de senha.
-- Implementação aditiva da migration 0011 do Manual Mestre Técnico v10.
-- Preserva integralmente as migrations e hardenings anteriores do projeto canônico.

CREATE TABLE public.app_contact_verification_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  channel VARCHAR(16) NOT NULL CHECK (channel IN ('email','phone')),
  destination_masked VARCHAR(128) NOT NULL,
  destination_fingerprint CHAR(64) NOT NULL CHECK (destination_fingerprint ~ '^[0-9a-f]{64}$'),
  otp_hash CHAR(64) NOT NULL CHECK (otp_hash ~ '^[0-9a-f]{64}$'),
  otp_salt CHAR(32) NOT NULL CHECK (otp_salt ~ '^[0-9a-f]{32}$'),
  token_digest CHAR(64) NOT NULL CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  attempts_count INTEGER NOT NULL DEFAULT 0 CHECK (attempts_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  is_consumed BOOLEAN NOT NULL DEFAULT false,
  consumed_at TIMESTAMPTZ NULL,
  invalidated_at TIMESTAMPTZ NULL,
  request_id UUID NOT NULL,
  command_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_challenge_expiry CHECK (expires_at > created_at)
);
COMMENT ON TABLE public.app_contact_verification_challenges IS
  'Desafios de verificação de contato. OTP e token persistidos apenas como hash/digest.';
CREATE INDEX ix_app_challenges_user_channel_active
  ON public.app_contact_verification_challenges(user_id, channel, created_at DESC)
  WHERE is_consumed = false AND invalidated_at IS NULL;
CREATE INDEX ix_app_challenges_expires
  ON public.app_contact_verification_challenges(expires_at)
  WHERE is_consumed = false AND invalidated_at IS NULL;
CREATE UNIQUE INDEX uq_app_challenges_command ON public.app_contact_verification_challenges(command_id);
CREATE UNIQUE INDEX uq_app_challenges_token_digest ON public.app_contact_verification_challenges(token_digest);

CREATE TABLE public.app_password_recovery_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token_digest CHAR(64) NOT NULL CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMPTZ NULL,
  invalidated_at TIMESTAMPTZ NULL,
  request_id UUID NOT NULL,
  command_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_recovery_expiry CHECK (expires_at > created_at)
);
CREATE INDEX ix_app_recovery_user_active
  ON public.app_password_recovery_requests(user_id, created_at DESC)
  WHERE is_used = false AND invalidated_at IS NULL;
CREATE UNIQUE INDEX uq_app_recovery_command ON public.app_password_recovery_requests(command_id);
CREATE UNIQUE INDEX uq_app_recovery_token_digest ON public.app_password_recovery_requests(token_digest);

CREATE TABLE public.app_outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel VARCHAR(16) NOT NULL CHECK (channel IN ('email','sms')),
  recipient_user_id UUID NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  recipient_masked VARCHAR(128) NOT NULL,
  template_code VARCHAR(64) NOT NULL,
  encrypted_payload BYTEA NOT NULL,
  payload_nonce CHAR(24) NOT NULL CHECK (payload_nonce ~ '^[0-9a-f]{24}$'),
  payload_auth_tag CHAR(32) NOT NULL CHECK (payload_auth_tag ~ '^[0-9a-f]{32}$'),
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','dispatched','failed','abandoned')),
  attempts_count INTEGER NOT NULL DEFAULT 0 CHECK (attempts_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_error VARCHAR(255) NULL,
  dispatched_at TIMESTAMPTZ NULL,
  request_id UUID NOT NULL,
  command_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.app_outbox_events IS
  'Fila transacional de entrega. Payload cifrado com AES-256-GCM. Nenhum OTP/token em claro.';
COMMENT ON COLUMN public.app_outbox_events.encrypted_payload IS
  'Ciphertext AES-256-GCM. Chave: OUTBOX_ENCRYPTION_KEY (server-side).';
CREATE INDEX ix_app_outbox_dispatch
  ON public.app_outbox_events(status, next_attempt_at)
  WHERE status IN ('pending','failed');
CREATE UNIQUE INDEX uq_app_outbox_command ON public.app_outbox_events(command_id);

CREATE TABLE public.app_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_event_id UUID NOT NULL REFERENCES public.app_outbox_events(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  provider VARCHAR(32) NOT NULL,
  provider_message_id VARCHAR(255) NULL,
  outcome VARCHAR(32) NOT NULL CHECK (outcome IN ('success','transient_failure','permanent_failure')),
  error_category VARCHAR(64) NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_app_delivery_attempts_event
  ON public.app_delivery_attempts(outbox_event_id, attempt_number);

CREATE OR REPLACE FUNCTION public.trg_fn_bump_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_fn_bump_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_fn_bump_updated_at() TO service_role;
CREATE TRIGGER trg_app_outbox_events_updated_at
BEFORE UPDATE ON public.app_outbox_events
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_bump_updated_at();

ALTER TABLE public.app_contact_verification_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_contact_verification_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_password_recovery_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_password_recovery_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_outbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_delivery_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY "challenges_self_read" ON public.app_contact_verification_challenges
FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "recovery_self_read" ON public.app_password_recovery_requests
FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "outbox_super_admin_read" ON public.app_outbox_events
FOR SELECT TO authenticated USING (public.is_platform_super_admin());
CREATE POLICY "attempts_super_admin_read" ON public.app_delivery_attempts
FOR SELECT TO authenticated USING (public.is_platform_super_admin());

REVOKE ALL ON TABLE public.app_contact_verification_challenges FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_password_recovery_requests FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_outbox_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_delivery_attempts FROM anon, authenticated;
GRANT SELECT ON TABLE public.app_contact_verification_challenges TO authenticated;
GRANT SELECT ON TABLE public.app_password_recovery_requests TO authenticated;
GRANT SELECT ON TABLE public.app_outbox_events TO authenticated;
GRANT SELECT ON TABLE public.app_delivery_attempts TO authenticated;
GRANT ALL ON TABLE public.app_contact_verification_challenges TO service_role;
GRANT ALL ON TABLE public.app_password_recovery_requests TO service_role;
GRANT ALL ON TABLE public.app_outbox_events TO service_role;
GRANT ALL ON TABLE public.app_delivery_attempts TO service_role;

CREATE INDEX IF NOT EXISTS ix_app_challenges_request ON public.app_contact_verification_challenges(request_id);
CREATE INDEX IF NOT EXISTS ix_app_recovery_request ON public.app_password_recovery_requests(request_id);
CREATE INDEX IF NOT EXISTS ix_app_outbox_request ON public.app_outbox_events(request_id);
