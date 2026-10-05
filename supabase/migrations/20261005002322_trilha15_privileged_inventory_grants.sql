-- T15: restrict the automatic Supabase default grants on the new tables only.
-- Applied migrations remain immutable; this is a separate additive correction.
REVOKE ALL ON public.app_inventory_lots, public.app_inventory_movements,
  public.app_inventory_reservations FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.app_inventory_lots,
  public.app_inventory_reservations TO service_role;
GRANT SELECT, INSERT ON public.app_inventory_movements TO service_role;
