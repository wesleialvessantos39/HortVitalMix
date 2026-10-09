-- Immutable signed-package metadata, publication policy and CI synchronization.
-- Browser roles never read these tables directly; the API projects public DTOs.
CREATE TABLE public.app_mobile_release_policy (
  singleton_guard boolean PRIMARY KEY DEFAULT true CHECK(singleton_guard),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  android_minimum_build integer NOT NULL DEFAULT 0 CHECK(android_minimum_build>=0),
  ios_minimum_build integer NOT NULL DEFAULT 0 CHECK(ios_minimum_build>=0),
  android_auto_publish boolean NOT NULL DEFAULT false,
  ios_auto_publish boolean NOT NULL DEFAULT false,
  android_signing_identity varchar(160),
  ios_signing_identity varchar(160),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);
CREATE INDEX ix_app_mobile_release_policy_updated_by ON public.app_mobile_release_policy(updated_by);
INSERT INTO public.app_mobile_release_policy(singleton_guard) VALUES(true);

CREATE TABLE public.app_mobile_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK(platform IN('android','ios')),
  version varchar(40) NOT NULL,
  build_number integer NOT NULL CHECK(build_number>0),
  min_supported_build integer NOT NULL CHECK(min_supported_build>0 AND min_supported_build<=build_number),
  runtime_fingerprint varchar(64) NOT NULL CHECK(runtime_fingerprint ~ '^[a-f0-9]{64}$'),
  source_commit varchar(40) NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
  schema_version integer NOT NULL CHECK(schema_version>0),
  sha256 varchar(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 100 AND 157286400),
  channel text NOT NULL CHECK((platform='android' AND channel='apk') OR (platform='ios' AND channel IN('app_store','testflight'))),
  url varchar(2048) NOT NULL,
  release_notes varchar(1600) NOT NULL DEFAULT '',
  signing_identity varchar(160) NOT NULL,
  status text NOT NULL DEFAULT 'verified' CHECK(status IN('verified','published','withdrawn')),
  ci_run_id varchar(30) NOT NULL CHECK(ci_run_id ~ '^[0-9]+$'),
  ci_run_attempt integer NOT NULL CHECK(ci_run_attempt>0),
  payload_hash varchar(64) NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  withdrawn_at timestamptz,
  UNIQUE(platform,build_number),
  UNIQUE(platform,ci_run_id,ci_run_attempt)
);
CREATE UNIQUE INDEX ux_app_mobile_releases_current_platform ON public.app_mobile_releases(platform) WHERE status='published';
CREATE INDEX ix_app_mobile_releases_history ON public.app_mobile_releases(platform,verified_at DESC,id);

CREATE TABLE public.app_mobile_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ci_run_id varchar(30) NOT NULL CHECK(ci_run_id ~ '^[0-9]+$'),
  ci_run_attempt integer NOT NULL CHECK(ci_run_attempt>0),
  source_commit varchar(40) NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
  build_number integer NOT NULL CHECK(build_number>0),
  sha256 varchar(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 100 AND 157286400),
  storage_path varchar(300) NOT NULL,
  expires_at timestamptz NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  consumed_at timestamptz,
  UNIQUE(ci_run_id,ci_run_attempt,build_number)
);
CREATE INDEX ix_app_mobile_uploads_pending ON public.app_mobile_uploads(expires_at) WHERE consumed_at IS NULL;
CREATE INDEX ix_app_mobile_uploads_path ON public.app_mobile_uploads(storage_path);

CREATE TABLE public.app_mobile_release_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid REFERENCES public.app_mobile_releases(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN('verified','published','withdrawn','restored','configured')),
  actor_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ci_run_id varchar(30),
  revision integer NOT NULL CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_app_mobile_release_events_release ON public.app_mobile_release_events(release_id,created_at DESC);
CREATE INDEX ix_app_mobile_release_events_actor ON public.app_mobile_release_events(actor_id);
ALTER TABLE public.app_mobile_release_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_mobile_release_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_mobile_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_mobile_releases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_mobile_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_mobile_uploads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_mobile_release_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_mobile_release_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_mobile_release_policy, public.app_mobile_releases, public.app_mobile_uploads, public.app_mobile_release_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.app_mobile_release_policy TO service_role;
GRANT SELECT,INSERT ON public.app_mobile_releases TO service_role;
GRANT UPDATE(status,published_at,withdrawn_at) ON public.app_mobile_releases TO service_role;
GRANT SELECT,INSERT ON public.app_mobile_uploads TO service_role;
GRANT UPDATE(consumed_at) ON public.app_mobile_uploads TO service_role;
GRANT SELECT,INSERT ON public.app_mobile_release_events TO service_role;
COMMENT ON TABLE public.app_mobile_releases IS 'Package metadata is immutable; CI identity is checked against GitHub JWKS and the trusted main workflow. First signer requires administrative approval.';
COMMENT ON TABLE public.app_mobile_release_policy IS 'Minimum supported builds never decrease through the API; withdrawal preserves the security floor.';
