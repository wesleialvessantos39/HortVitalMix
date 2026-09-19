-- HortiVitalMix v10 / Trilha 01. Errata autorizada em 2026-09-19.
CREATE TABLE public.app_audit_events(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),request_id UUID NOT NULL,actor_id UUID,actor_role VARCHAR(64) NOT NULL DEFAULT 'anonymous',
 action VARCHAR(128) NOT NULL CHECK(action ~ '^[a-z][a-z0-9._]{2,127}$'),target_entity VARCHAR(64) NOT NULL,target_id UUID,
 payload_before JSONB,payload_after JSONB,client_ip_hash CHAR(64) NOT NULL CHECK(client_ip_hash ~ '^[0-9a-f]{64}$'),
 user_agent_hash CHAR(64) CHECK(user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$'),command_id UUID,occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.app_audit_events IS 'Auditoria append-only, sem PII bruta em payloads; identificadores de ator preservados.';
ALTER TABLE public.app_audit_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.app_audit_events FORCE ROW LEVEL SECURITY; REVOKE ALL ON public.app_audit_events FROM anon, authenticated; GRANT ALL ON public.app_audit_events TO service_role;
CREATE UNIQUE INDEX uq_app_audit_events_command_id ON public.app_audit_events(command_id) WHERE command_id IS NOT NULL;
CREATE INDEX ix_app_audit_events_occurred_at ON public.app_audit_events(occurred_at DESC);
CREATE INDEX ix_app_audit_events_actor ON public.app_audit_events(actor_id,occurred_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX ix_app_audit_events_target ON public.app_audit_events(target_entity,target_id,occurred_at DESC);
CREATE INDEX ix_app_audit_events_action ON public.app_audit_events(action,occurred_at DESC);
CREATE FUNCTION public.trg_fn_prevent_audit_tampering() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'VIOLACAO_DE_AUDITORIA: operação % bloqueada',TG_OP USING ERRCODE='42501';END;$$;
CREATE TRIGGER trg_app_audit_events_immutable BEFORE UPDATE OR DELETE ON public.app_audit_events FOR EACH ROW EXECUTE FUNCTION public.trg_fn_prevent_audit_tampering();
CREATE TRIGGER trg_app_audit_events_no_truncate BEFORE TRUNCATE ON public.app_audit_events FOR EACH STATEMENT EXECUTE FUNCTION public.trg_fn_prevent_audit_tampering();
COMMENT ON FUNCTION public.trg_fn_prevent_audit_tampering() IS 'Bloqueia UPDATE, DELETE e TRUNCATE da auditoria.';
