-- HortiVitalMix v10 / Trilha 01. Errata autorizada em 2026-09-19.
CREATE INDEX ix_app_people_email_lower ON public.app_people(lower(email_normalized));
CREATE INDEX ix_app_user_roles_granted_at ON public.app_user_role_assignments(granted_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX ix_app_producer_profiles_pending ON public.app_producer_profiles(created_at) WHERE verification_status IN ('declared','pending');
CREATE INDEX ix_app_user_roles_granted_by ON public.app_user_role_assignments(granted_by);
CREATE INDEX ix_app_user_roles_revoked_by ON public.app_user_role_assignments(revoked_by);
CREATE INDEX ix_app_user_roles_role_code ON public.app_user_role_assignments(role_code);
-- Correção executável: now() não é IMMUTABLE e não pode integrar predicado de índice.
CREATE INDEX ix_app_audit_events_recent ON public.app_audit_events(occurred_at DESC,action);
-- Índices UNIQUE de CPF/email/person_id já suprem buscas exatas, sem cópias redundantes.
