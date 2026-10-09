import {
  createSupabasePublicClient,
  supabaseAdmin,
} from "../supabase/client.ts";

type BrowserIdentity = {
  accessToken?: string | null;
  refreshToken?: string | null;
};

const invalidRefresh = (error: { status?: number; code?: string }) =>
  [
    "refresh_token_not_found",
    "refresh_token_already_used",
    "session_not_found",
    "user_not_found",
  ].includes(error.code ?? "");

const invalidAccess = (error: { status?: number; code?: string }) =>
  error.code
    ? error.code === "bad_jwt" || invalidRefresh(error)
    : error.status === 401 || error.status === 403;

// The cookie portal and the administrative bearer can belong to different
// identities. Revoke each present browser session, never other devices.
export async function revokeBrowserSessions(identities: BrowserIdentity[]) {
  const seenAccess = new Set<string>();
  const seenRefresh = new Set<string>();
  for (const identity of identities) {
    const access = identity.accessToken ?? "";
    const refresh = identity.refreshToken ?? "";
    if (!access && !refresh) continue;
    if (!supabaseAdmin) return false;

    if (access && !seenAccess.has(access)) {
      seenAccess.add(access);
      const { error } = await supabaseAdmin.auth.admin.signOut(access, "local");
      if (error && !invalidAccess(error)) return false;
    }
    // Independently check the refresh token as well: an in-flight response or
    // another tab may have left access/refresh credentials from distinct
    // identities. For a matching revoked session, Auth reports it missing.
    // Refresh only to revoke it; no token is returned or written to cookies.
    if (refresh && !seenRefresh.has(refresh)) {
      seenRefresh.add(refresh);
      const client = createSupabasePublicClient();
      if (!client) return false;
      const result = await client.auth.refreshSession({
        refresh_token: refresh,
      });
      if (result.error) {
        if (invalidRefresh(result.error)) continue;
        return false;
      }
      const token = result.data.session?.access_token ?? "";
      if (!token) return false;
      const { error } = await supabaseAdmin.auth.admin.signOut(token, "local");
      // A newly minted token cannot be treated as merely expired. Only an
      // explicit already-revoked identity is safe to consider completed.
      if (error && !invalidRefresh(error)) return false;
    }
  }
  return true;
}
