-- Remove inherited Supabase service_role defaults before granting the intended capabilities.
REVOKE ALL ON public.app_food_configuration,public.app_food_rules,public.app_food_rule_versions,public.app_food_assets,public.app_food_materials,public.app_food_acceptances FROM service_role;
GRANT SELECT,UPDATE ON public.app_food_configuration TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.app_food_rules,public.app_food_assets,public.app_food_materials TO service_role;
GRANT SELECT,INSERT ON public.app_food_rule_versions,public.app_food_acceptances TO service_role;
