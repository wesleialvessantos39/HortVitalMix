-- HortiVitalMix — Volume 01 / Trilha 04 — hardening de performance pós-linter Supabase.
-- Mantém as regras do Manual v10 e otimiza FK e políticas sem ampliar acesso.

CREATE INDEX IF NOT EXISTS ix_app_outbox_recipient_user
  ON public.app_outbox_events(recipient_user_id)
  WHERE recipient_user_id IS NOT NULL;

DROP POLICY IF EXISTS "challenges_self_read"
  ON public.app_contact_verification_challenges;
CREATE POLICY "challenges_self_read"
  ON public.app_contact_verification_challenges
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "recovery_self_read"
  ON public.app_password_recovery_requests;
CREATE POLICY "recovery_self_read"
  ON public.app_password_recovery_requests
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
