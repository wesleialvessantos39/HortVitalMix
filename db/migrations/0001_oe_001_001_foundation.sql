CREATE TABLE IF NOT EXISTS app_schema_migrations (
  version BIGINT PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  execution_ms INTEGER NOT NULL DEFAULT 0 CHECK (execution_ms >= 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
