SET lock_timeout = '5s';
ALTER TABLE public.app_user_preferences
  ADD COLUMN IF NOT EXISTS appearance_theme text NULL
  CONSTRAINT app_user_preferences_appearance_theme_check CHECK (appearance_theme IN ('light', 'dark'));
COMMENT ON COLUMN public.app_user_preferences.appearance_theme IS 'Preferred light/dark appearance for authenticated accounts; an explicit device preference takes precedence. NULL means no account choice.';

