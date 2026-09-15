CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL UNIQUE,
  checksum_sha256 char(64) NOT NULL,
  execution_ms integer NOT NULL CHECK (execution_ms >= 0),
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  git_commit char(40) NOT NULL,
  environment text NOT NULL CHECK (environment IN ('development', 'homologation', 'production')),
  schema_version integer NOT NULL REFERENCES app_schema_migrations(version),
  released_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (git_commit, environment)
);

CREATE TABLE IF NOT EXISTS app_global_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true CHECK (singleton),
  system_name varchar(80) NOT NULL,
  slogan varchar(180) NOT NULL,
  support_email varchar(254),
  support_phone varchar(30),
  default_city varchar(80) NOT NULL,
  default_state char(2) NOT NULL CHECK (default_state ~ '^[A-Z]{2}$'),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  timezone varchar(64) NOT NULL DEFAULT 'America/Porto_Velho',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (singleton)
);

CREATE TABLE IF NOT EXISTS app_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id varchar(128) NOT NULL,
  actor_type varchar(40) NOT NULL,
  actor_user_id uuid,
  action_code varchar(100) NOT NULL,
  entity_type varchar(100) NOT NULL,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  redacted_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (before_state IS NULL OR jsonb_typeof(before_state) = 'object'),
  CHECK (after_state IS NULL OR jsonb_typeof(after_state) = 'object')
);

CREATE INDEX IF NOT EXISTS app_audit_events_request_id_idx ON app_audit_events (request_id);
CREATE INDEX IF NOT EXISTS app_audit_events_entity_idx ON app_audit_events (entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app_audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS app_audit_events_immutable ON app_audit_events;
CREATE TRIGGER app_audit_events_immutable BEFORE UPDATE OR DELETE ON app_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

INSERT INTO app_global_config (system_name, slogan, default_city, default_state)
VALUES ('HortiVitalMix', 'Do produtor local para a sua mesa', 'Ariquemes', 'RO')
ON CONFLICT (singleton) DO NOTHING;
