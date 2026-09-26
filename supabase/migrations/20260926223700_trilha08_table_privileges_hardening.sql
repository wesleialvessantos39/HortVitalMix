-- T07/T08: remove privilégios herdados dos defaults do Supabase.
-- RLS não protege TRUNCATE; authenticated deve possuir somente SELECT.
REVOKE ALL PRIVILEGES ON TABLE
  public.app_user_addresses,
  public.app_properties,
  public.app_property_boundaries,
  public.app_rural_activities
FROM anon, authenticated;

GRANT SELECT ON TABLE
  public.app_user_addresses,
  public.app_properties,
  public.app_property_boundaries,
  public.app_rural_activities
TO authenticated;
