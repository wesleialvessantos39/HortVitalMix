import type { PoolClient } from "pg";
export async function withAuditContext<T>(
  client: PoolClient,
  pepper: string,
  fn: () => Promise<T>,
) {
  if (pepper.length < 16) throw new Error("AUDIT_PEPPER_NOT_CONFIGURED");
  await client.query("SELECT set_config('app.ip_pepper',$1,true)", [pepper]);
  return fn();
}
