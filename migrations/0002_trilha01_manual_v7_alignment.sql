-- Trilha 01 - alinhamento preservando o histórico já publicado da migration 0001.
-- Esta migration corretiva existe porque a primeira versão da Trilha 01 já foi aplicada
-- em development antes da auditoria contra o Manual Mestre Técnico v7.

ALTER TABLE app_schema_migrations
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

UPDATE app_schema_migrations
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE app_schema_migrations
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE app_schema_migrations
  DROP CONSTRAINT IF EXISTS app_schema_migrations_pkey;

ALTER TABLE app_schema_migrations
  ADD CONSTRAINT app_schema_migrations_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_schema_migrations_version
  ON app_schema_migrations(version);

ALTER TABLE app_releases
  ADD COLUMN IF NOT EXISTS release_tag varchar(64),
  ADD COLUMN IF NOT EXISTS commit_sha char(40),
  ADD COLUMN IF NOT EXISTS migration_history_hash char(64),
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deployed_at timestamptz NOT NULL DEFAULT clock_timestamp();

UPDATE app_releases
SET
  release_tag = COALESCE(release_tag, 'legacy-' || substring(git_commit from 1 for 7)),
  commit_sha = COALESCE(commit_sha, git_commit),
  migration_history_hash = COALESCE(
    migration_history_hash,
    encode(
      digest(
        COALESCE(
          (
            SELECT string_agg(
              m.version::text || ':' || m.checksum_sha256,
              '|' ORDER BY m.version
            )
            FROM app_schema_migrations m
          ),
          ''
        ),
        'sha256'
      ),
      'hex'
    )
  ),
  deployed_at = COALESCE(deployed_at, released_at);

ALTER TABLE app_releases
  ALTER COLUMN release_tag SET NOT NULL,
  ALTER COLUMN commit_sha SET NOT NULL,
  ALTER COLUMN migration_history_hash SET NOT NULL;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY environment
           ORDER BY COALESCE(deployed_at, released_at) DESC, id DESC
         ) AS position
  FROM app_releases
)
UPDATE app_releases r
SET is_current = (ranked.position = 1)
FROM ranked
WHERE ranked.id = r.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_releases_current_env
  ON app_releases(environment)
  WHERE is_current = true;

ALTER TABLE app_global_config
  ADD COLUMN IF NOT EXISTS singleton_guard boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS platform_name varchar(64) NOT NULL DEFAULT 'HortiVitalMix',
  ADD COLUMN IF NOT EXISTS default_municipality varchar(100) NOT NULL DEFAULT 'Ariquemes';

UPDATE app_global_config
SET
  singleton_guard = singleton,
  platform_name = CASE
    WHEN system_name IS NULL OR btrim(system_name) = '' THEN 'HortiVitalMix'
    ELSE left(system_name, 64)
  END,
  default_municipality = CASE
    WHEN default_city IS NULL OR btrim(default_city) = '' THEN 'Ariquemes'
    ELSE left(default_city, 100)
  END,
  slogan = CASE
    WHEN slogan = 'Do produtor local para a sua mesa'
      THEN 'Tudo fresco. Tudo da sua região.'
    ELSE slogan
  END,
  support_email = COALESCE(support_email, 'hortivitalmix@gmail.com'),
  updated_at = clock_timestamp();

ALTER TABLE app_global_config
  ALTER COLUMN support_email SET DEFAULT 'hortivitalmix@gmail.com',
  ALTER COLUMN support_email SET NOT NULL,
  ALTER COLUMN support_phone TYPE varchar(32);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_global_config_singleton_guard
  ON app_global_config(singleton_guard)
  WHERE singleton_guard = true;
