CREATE TABLE IF NOT EXISTS app_releases (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('development', 'homologation', 'production')),
  release_version TEXT NOT NULL CHECK (length(trim(release_version)) BETWEEN 1 AND 120),
  commit_sha CHAR(40) NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  artifact_ref TEXT NULL CHECK (artifact_ref IS NULL OR length(trim(artifact_ref)) BETWEEN 1 AND 240),
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_releases_current
  ON app_releases ((1))
  WHERE is_current;

CREATE INDEX IF NOT EXISTS ix_app_releases_environment_deployed
  ON app_releases(environment, deployed_at DESC);
