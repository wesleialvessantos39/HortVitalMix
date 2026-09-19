-- HortiVitalMix v10 / Trilha 01.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA extensions;

CREATE TABLE public.app_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_tag VARCHAR(64) NOT NULL CHECK (release_tag ~ '^[a-z0-9][a-z0-9_.-]{2,63}$'),
  environment VARCHAR(32) NOT NULL CHECK (environment IN ('development','homologation','production')),
  commit_sha CHAR(40) NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  migration_history_hash CHAR(64) NOT NULL CHECK (migration_history_hash ~ '^[0-9a-f]{64}$'),
  is_current BOOLEAN NOT NULL DEFAULT true,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deployed_by VARCHAR(128),
  notes TEXT
);
CREATE UNIQUE INDEX uq_app_releases_current_env ON public.app_releases(environment) WHERE is_current;
CREATE INDEX ix_app_releases_env_time ON public.app_releases(environment,deployed_at DESC);
COMMENT ON TABLE public.app_releases IS 'Histórico de releases por ambiente; uma única release corrente.';
COMMENT ON COLUMN public.app_releases.migration_history_hash IS 'SHA-256 dos nomes e conteúdos ordenados de migrations verificadas.';
COMMENT ON COLUMN public.app_releases.schema_version IS 'Versão lógica do manifesto; nunca o timestamp do arquivo.';
ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_releases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_releases FROM anon, authenticated;
GRANT ALL ON public.app_releases TO service_role;

CREATE TABLE public.app_global_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_guard BOOLEAN NOT NULL DEFAULT true UNIQUE CHECK (singleton_guard),
  platform_name VARCHAR(64) NOT NULL DEFAULT 'HortiVitalMix' CHECK (length(trim(platform_name)) >= 2),
  slogan VARCHAR(255) NOT NULL DEFAULT 'Tudo fresco. Tudo da sua região.' CHECK (length(trim(slogan)) >= 5),
  default_municipality VARCHAR(100) NOT NULL DEFAULT 'Ariquemes' CHECK (length(trim(default_municipality)) >= 2),
  default_state CHAR(2) NOT NULL DEFAULT 'RO' CHECK (default_state IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  currency CHAR(3) NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Porto_Velho',
  support_email VARCHAR(255) NOT NULL DEFAULT 'hortivitalmix@gmail.com' CHECK (support_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  support_phone VARCHAR(32) CHECK (support_phone IS NULL OR support_phone ~ '^\+[1-9]\d{1,14}$'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by UUID
);
COMMENT ON TABLE public.app_global_config IS 'Configuração pública canônica singleton com revisão otimista.';
ALTER TABLE public.app_global_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_global_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_global_config FROM anon, authenticated;
GRANT ALL ON public.app_global_config TO service_role;

CREATE FUNCTION public.trg_fn_global_config_bump_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF ROW(OLD.platform_name,OLD.slogan,OLD.default_municipality,OLD.default_state,OLD.currency,OLD.timezone,OLD.support_email,OLD.support_phone)
     IS DISTINCT FROM ROW(NEW.platform_name,NEW.slogan,NEW.default_municipality,NEW.default_state,NEW.currency,NEW.timezone,NEW.support_email,NEW.support_phone) THEN
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := clock_timestamp();
  ELSE
    NEW.revision := OLD.revision;
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_app_global_config_bump_revision
BEFORE UPDATE ON public.app_global_config
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_global_config_bump_revision();
COMMENT ON FUNCTION public.trg_fn_global_config_bump_revision() IS 'Incrementa revisão somente quando campos de negócio mudam.';
