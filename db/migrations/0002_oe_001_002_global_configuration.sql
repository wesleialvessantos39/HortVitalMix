CREATE TABLE IF NOT EXISTS app_global_config (
  id UUID PRIMARY KEY,
  singleton_key TEXT NOT NULL UNIQUE DEFAULT 'global' CHECK (singleton_key = 'global'),
  revision BIGINT NOT NULL CHECK (revision > 0),
  brand_name TEXT NOT NULL CHECK (brand_name = 'HortiVitalMix'),
  brand_tagline TEXT NOT NULL CHECK (length(trim(brand_tagline)) BETWEEN 1 AND 120),
  page_title TEXT NOT NULL CHECK (length(trim(page_title)) BETWEEN 1 AND 120),
  logo_alt_text TEXT NOT NULL CHECK (length(trim(logo_alt_text)) BETWEEN 1 AND 160),
  primary_color CHAR(7) NOT NULL CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color CHAR(7) NOT NULL CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color CHAR(7) NOT NULL CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  support_email TEXT NULL CHECK (support_email IS NULL OR (length(trim(support_email)) BETWEEN 3 AND 254 AND support_email LIKE '%@%')),
  support_phone TEXT NULL CHECK (support_phone IS NULL OR length(trim(support_phone)) BETWEEN 8 AND 32),
  support_whatsapp TEXT NULL CHECK (support_whatsapp IS NULL OR length(trim(support_whatsapp)) BETWEEN 8 AND 32),
  region_country_code CHAR(2) NOT NULL CHECK (region_country_code ~ '^[A-Z]{2}$'),
  region_state_code CHAR(2) NOT NULL CHECK (region_state_code ~ '^[A-Z]{2}$'),
  region_city TEXT NOT NULL CHECK (length(trim(region_city)) BETWEEN 2 AND 80),
  default_locale TEXT NOT NULL CHECK (default_locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  timezone TEXT NOT NULL CHECK (length(trim(timezone)) BETWEEN 1 AND 80),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL
);

CREATE TABLE IF NOT EXISTS app_audit_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (length(trim(event_type)) BETWEEN 1 AND 120),
  resource_type TEXT NOT NULL CHECK (length(trim(resource_type)) BETWEEN 1 AND 120),
  resource_id UUID NOT NULL,
  actor_id UUID NULL,
  request_id UUID NOT NULL,
  command_id UUID NULL,
  before_data JSONB NULL CHECK (before_data IS NULL OR jsonb_typeof(before_data) = 'object'),
  after_data JSONB NULL CHECK (after_data IS NULL OR jsonb_typeof(after_data) = 'object'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_audit_events_command
  ON app_audit_events(command_id)
  WHERE command_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_app_audit_events_resource
  ON app_audit_events(resource_type, resource_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS ix_app_audit_events_request
  ON app_audit_events(request_id);

INSERT INTO app_global_config (
  id,
  singleton_key,
  revision,
  brand_name,
  brand_tagline,
  page_title,
  logo_alt_text,
  primary_color,
  secondary_color,
  accent_color,
  support_email,
  support_phone,
  support_whatsapp,
  region_country_code,
  region_state_code,
  region_city,
  default_locale,
  currency_code,
  timezone,
  parameters
)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'global',
  1,
  'HortiVitalMix',
  'Do produtor local para a sua mesa',
  'HortiVitalMix | Do produtor local para a sua mesa',
  'HortiVitalMix - do produtor local para a sua mesa',
  '#0F4D2F',
  '#78A936',
  '#EF6500',
  NULL,
  NULL,
  NULL,
  'BR',
  'RO',
  'Ariquemes',
  'pt-BR',
  'BRL',
  'America/Porto_Velho',
  '{"marketInitialCity":"Ariquemes","marketInitialState":"RO"}'::jsonb
)
ON CONFLICT (singleton_key) DO NOTHING;
