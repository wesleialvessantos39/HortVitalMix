-- Distribution metadata only. Native binaries are signed/built independently;
-- publishing a web release never rewrites or migrates application data here.
CREATE TABLE public.app_mobile_distribution (
  singleton_guard boolean PRIMARY KEY DEFAULT true CHECK (singleton_guard),
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  android jsonb,
  ios jsonb,
  release_notes varchar(1600) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  CONSTRAINT app_mobile_distribution_android_shape CHECK (
    android IS NULL OR (
      jsonb_typeof(android) = 'object'
      AND android ?& ARRAY['version', 'url']
      AND (android - 'version' - 'url') = '{}'::jsonb
      AND jsonb_typeof(android->'version') = 'string'
      AND jsonb_typeof(android->'url') = 'string'
      AND length(android->>'version') BETWEEN 5 AND 40
      AND length(android->>'url') BETWEEN 10 AND 2048
    )
  ),
  CONSTRAINT app_mobile_distribution_ios_shape CHECK (
    ios IS NULL OR (
      jsonb_typeof(ios) = 'object'
      AND ios ?& ARRAY['version', 'url']
      AND (ios - 'version' - 'url') = '{}'::jsonb
      AND jsonb_typeof(ios->'version') = 'string'
      AND jsonb_typeof(ios->'url') = 'string'
      AND length(ios->>'version') BETWEEN 5 AND 40
      AND length(ios->>'url') BETWEEN 10 AND 2048
    )
  )
);

CREATE INDEX ix_app_mobile_distribution_updated_by
  ON public.app_mobile_distribution(updated_by);

ALTER TABLE public.app_mobile_distribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_mobile_distribution FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_mobile_distribution FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.app_mobile_distribution TO service_role;
COMMENT ON TABLE public.app_mobile_distribution IS
  'Server-only singleton. Public manifest omits operator identity; platform_configuration, recent authentication, CAS, receipts and audit protect changes.';
COMMENT ON COLUMN public.app_mobile_distribution.android IS
  'Explicit signed APK on trusted managed origin or Play Store URL. NULL means no Android build is available.';
COMMENT ON COLUMN public.app_mobile_distribution.ios IS
  'Official App Store/TestFlight destination only; NULL means no iOS build is available. Never direct IPA installation.';
INSERT INTO public.app_mobile_distribution(singleton_guard) VALUES (true);
