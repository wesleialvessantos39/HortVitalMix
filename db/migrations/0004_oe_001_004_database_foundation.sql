ALTER TABLE app_releases
  ADD COLUMN IF NOT EXISTS schema_version BIGINT,
  ADD COLUMN IF NOT EXISTS migration_history_hash CHAR(64);

ALTER TABLE app_releases
  DROP CONSTRAINT IF EXISTS app_releases_schema_version_check;

ALTER TABLE app_releases
  ADD CONSTRAINT app_releases_schema_version_check
  CHECK (schema_version IS NULL OR schema_version > 0);

ALTER TABLE app_releases
  DROP CONSTRAINT IF EXISTS app_releases_migration_history_hash_check;

ALTER TABLE app_releases
  ADD CONSTRAINT app_releases_migration_history_hash_check
  CHECK (
    migration_history_hash IS NULL
    OR migration_history_hash ~ '^[0-9a-f]{64}$'
  );

CREATE TABLE IF NOT EXISTS app_feature_flags (
  id UUID PRIMARY KEY,
  flag_key TEXT NOT NULL UNIQUE CHECK (flag_key ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 240),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL
);

CREATE INDEX IF NOT EXISTS ix_app_feature_flags_enabled_key
  ON app_feature_flags(enabled, flag_key);
