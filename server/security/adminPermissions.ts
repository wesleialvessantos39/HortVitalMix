import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import type { AdminSectorCode } from "../../shared/contracts/adminGovernance.ts";

export async function resolveDeniedAdminSectors(
  userId: string,
): Promise<AdminSectorCode[]> {
  if (supabaseAdmin) {
    const result = await supabaseAdmin
      .from("app_admin_permission_overrides")
      .select("sector_code")
      .eq("user_id", userId)
      .eq("allowed", false);
    if (!result.error)
      return (Array.isArray(result.data) ? result.data : []).map(
        (row) => row.sector_code as AdminSectorCode,
      );
  }
  if (!dbPool) throw new Error("PERMISSIONS_UNAVAILABLE");
  const result = await dbPool.query<{ sector_code: AdminSectorCode }>(
    "SELECT sector_code FROM public.app_admin_permission_overrides WHERE user_id=$1 AND NOT allowed",
    [userId],
  );
  return result.rows.map((row) => row.sector_code);
}
