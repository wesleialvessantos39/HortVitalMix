-- HortiVitalMix v10 / Trilha 01
-- Hardening documental idempotente. Não altera schema_version nem histórico de migrations.

COMMENT ON COLUMN public.app_users.status IS
  'Estado de governança da conta; alteração reservada ao backend privilegiado.';
COMMENT ON COLUMN public.app_users.authorization_revision IS
  'Revisão de autorização usada para invalidar decisões de acesso após mudanças críticas.';
COMMENT ON COLUMN public.app_users.blocked_by IS
  'Identificador interno do ator que bloqueou a conta; nunca aceito do cliente.';
COMMENT ON COLUMN public.app_users.block_reason IS
  'Motivo operacional de bloqueio/suspensão; pode conter contexto interno, nunca credenciais.';

COMMENT ON COLUMN public.app_people.email_normalized IS
  'E-mail canônico normalizado em minúsculas; PII protegida por RLS.';
COMMENT ON COLUMN public.app_people.phone_e164 IS
  'Telefone canônico em formato E.164; PII protegida por RLS.';

COMMENT ON COLUMN public.app_user_role_assignments.granted_by IS
  'Ator interno que concedeu o papel; governança server-side.';
COMMENT ON COLUMN public.app_user_role_assignments.revoked_by IS
  'Ator interno que revogou o papel; governança server-side.';
COMMENT ON COLUMN public.app_user_role_assignments.revoke_reason IS
  'Motivo de revogação do papel; informação operacional protegida.';

COMMENT ON COLUMN public.app_producer_profiles.verification_status IS
  'Estado de verificação de governança; não editável diretamente pelo produtor.';
COMMENT ON COLUMN public.app_producer_profiles.trust_level IS
  'Nível de confiança de governança; não editável diretamente pelo produtor.';

COMMENT ON COLUMN public.app_audit_events.payload_before IS
  'Snapshot sanitizado anterior à ação; proibido armazenar PII bruta, tokens ou credenciais.';
COMMENT ON COLUMN public.app_audit_events.payload_after IS
  'Snapshot sanitizado posterior à ação; proibido armazenar PII bruta, tokens ou credenciais.';
COMMENT ON COLUMN public.app_audit_events.client_ip_hash IS
  'SHA-256 do IP combinado com APP_IP_PEPPER; IP bruto não é persistido.';
COMMENT ON COLUMN public.app_audit_events.user_agent_hash IS
  'SHA-256 do user-agent quando presente; valor bruto não deve ser persistido.';
