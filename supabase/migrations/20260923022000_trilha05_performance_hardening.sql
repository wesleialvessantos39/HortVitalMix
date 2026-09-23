-- Volume 01 / Trilha 05 — hardening de performance e RLS
-- Aditivo à migration canônica da governança. Não reescreve histórico anterior.

CREATE INDEX IF NOT EXISTS ix_app_admin_invite_sectors_sector_code
  ON public.app_admin_invite_sectors(sector_code);

CREATE INDEX IF NOT EXISTS ix_app_admin_invites_accepted_by
  ON public.app_admin_invites(accepted_by)
  WHERE accepted_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_app_admin_invites_invited_by
  ON public.app_admin_invites(invited_by);

CREATE INDEX IF NOT EXISTS ix_app_admin_invites_target_role
  ON public.app_admin_invites(target_role);

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_admin_invites_auth_user
  ON public.app_admin_invites(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_app_admin_sector_members_assigned_by
  ON public.app_admin_sector_members(assigned_by)
  WHERE assigned_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_app_admin_sector_members_revoked_by
  ON public.app_admin_sector_members(revoked_by)
  WHERE revoked_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_app_admin_sector_members_sector_code
  ON public.app_admin_sector_members(sector_code);

-- Corrige aviso de FK herdado da Trilha 03 sem alterar sua semântica.
CREATE INDEX IF NOT EXISTS ix_app_role_security_challenges_role_code
  ON public.app_role_security_challenges(role_code);

DROP POLICY IF EXISTS sector_members_self_read
  ON public.app_admin_sector_members;
DROP POLICY IF EXISTS sector_members_super_admin_read
  ON public.app_admin_sector_members;

CREATE POLICY sector_members_scoped_read
  ON public.app_admin_sector_members
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR (SELECT public.is_platform_super_admin())
  );

COMMENT ON INDEX public.ux_app_admin_invites_auth_user IS
  'Uma identidade Auth pendente pertence a no máximo um convite administrativo HortiVitalMix.';
