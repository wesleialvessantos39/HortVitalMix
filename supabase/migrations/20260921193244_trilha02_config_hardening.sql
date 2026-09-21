-- HortiVitalMix — Volume 01 / Trilha 02 — Configuração global revisionada e auditoria imutável.
-- Migration aditiva equivalente à 0009 histórica do Manual Mestre Técnico v10.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='app_global_config'
      AND column_name='updated_by'
  ) THEN
    ALTER TABLE public.app_global_config ADD COLUMN updated_by UUID NULL;
  END IF;
END $$;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT p.polname
    FROM pg_policy p
    JOIN pg_class c ON c.oid=p.polrelid
    WHERE c.relnamespace='public'::regnamespace
      AND c.relname='app_global_config'
      AND p.polcmd IN ('a','w','*')
      AND p.polroles::oid[] @> ARRAY[
        (SELECT oid FROM pg_roles WHERE rolname='authenticated')
      ]::oid[]
  LOOP
    EXECUTE format('DROP POLICY %I ON public.app_global_config',pol.polname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_audit_events_command_id
  ON public.app_audit_events(command_id)
  WHERE command_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_app_audit_events_config_target
  ON public.app_audit_events(target_entity,occurred_at DESC)
  WHERE target_entity='app_global_config';

COMMENT ON COLUMN public.app_global_config.updated_by IS
  'UUID do ator que aplicou a última mutação. Preenchido pelo backend.';
