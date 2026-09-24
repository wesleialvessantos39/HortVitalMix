-- Trilha 05 — hierarquia administrativa e migração segura de identidade existente
-- Aditiva: permite distinguir convites para identidade nova vs. identidade já existente,
-- e permite que Administrador Setorial leia apenas os convites que ele próprio emitiu.

ALTER TABLE public.app_admin_invites
  ADD COLUMN IF NOT EXISTS identity_mode varchar(16) NOT NULL DEFAULT 'new';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname='ck_app_admin_invites_identity_mode'
       AND conrelid='public.app_admin_invites'::regclass
  ) THEN
    ALTER TABLE public.app_admin_invites
      ADD CONSTRAINT ck_app_admin_invites_identity_mode
      CHECK (identity_mode IN ('new','existing'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ix_app_admin_invites_invited_by_created
  ON public.app_admin_invites(invited_by, created_at DESC);

DROP POLICY IF EXISTS invites_super_admin_read ON public.app_admin_invites;
DROP POLICY IF EXISTS invites_admin_hierarchy_read ON public.app_admin_invites;

CREATE POLICY invites_admin_hierarchy_read
  ON public.app_admin_invites
  FOR SELECT TO authenticated
  USING (
    public.is_platform_super_admin()
    OR invited_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS invite_sectors_super_admin_read ON public.app_admin_invite_sectors;
DROP POLICY IF EXISTS invite_sectors_admin_hierarchy_read ON public.app_admin_invite_sectors;

CREATE POLICY invite_sectors_admin_hierarchy_read
  ON public.app_admin_invite_sectors
  FOR SELECT TO authenticated
  USING (
    public.is_platform_super_admin()
    OR EXISTS (
      SELECT 1
        FROM public.app_admin_invites i
       WHERE i.id = invite_id
         AND i.invited_by = (SELECT auth.uid())
    )
  );

COMMENT ON COLUMN public.app_admin_invites.identity_mode IS
  'new cria identidade administrativa; existing vincula papel administrativo a identidade canônica já existente sem duplicar CPF/app_people.';
