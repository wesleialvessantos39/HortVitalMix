import { api, withAdminIdentityConfirmation } from "./api";
import { clearAdminAccess } from "./adminAccessHandoff";
import {
  clearAdminSession,
  readAdminAccessToken,
  readAdminRefreshToken,
} from "./adminSessionStore";
import { clearProducerSnapshots } from "./offlineDb";
import { announceBrowserSessionExit } from "./sessionExit";

export async function logoutCurrentBrowserSessions() {
  // Finish an already-started refresh/password confirmation before revocation.
  // Neither response may recreate HttpOnly cookies after the exit succeeds.
  await withAdminIdentityConfirmation(async () => {
    // All portal sessions belong to this backend. The unused Supabase browser
    // client never authenticates or persists a session; importing it here would
    // add a second Auth client without revoking our HttpOnly/bearer sessions.
    const token = readAdminAccessToken();
    await api("/v1/auth/logout", {
      method: "POST",
      headers: token ? { Authorization: "Bearer " + token } : undefined,
      body: JSON.stringify({ refreshToken: readAdminRefreshToken() }),
    });
    clearAdminSession();
    clearAdminAccess();
    // Invalidate late session reads before clearing IndexedDB, without
    // navigating away until that asynchronous cleanup has completed.
    window.dispatchEvent(new Event("hvm:session-ending"));
    // Do not return to the storefront while an offline authenticated snapshot
    // remains accessible. A browser without IndexedDB cannot have that cache.
    if (globalThis.indexedDB) await clearProducerSnapshots();
    announceBrowserSessionExit();
  });
}
