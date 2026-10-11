import { api } from "./api";
import { synchronize } from "./offlineDb";
import type { ShellSession } from "../hooks/useSession";
import {
  assertOfflineIdentity,
  currentOfflineIdentity,
  refreshPortalCache,
  setOfflineIdentity,
  synchronizePortalRequests,
} from "./portalOffline";
import { synchronizeDocumentUploads } from "./offlineDocuments";

export async function synchronizeOwnAccount(
  session: ShellSession,
  signal?: AbortSignal,
) {
  if (!navigator.onLine) throw Error("OFFLINE");
  const previous = currentOfflineIdentity();
  const verified = await api<ShellSession>("/v1/auth/session", {
    signal,
    offlineBypass: true,
  });
  if (previous) assertOfflineIdentity(previous);
  if (
    verified.userId !== session.userId ||
    verified.activeRole !== session.activeRole
  )
    throw Error("SESSION_CHANGED");
  setOfflineIdentity(verified);
  const owner = currentOfflineIdentity();
  if (!owner) throw Error("AUTH_REQUIRED");
  if (
    session.activeRole === "platform_admin" ||
    session.activeRole === "platform_super_admin"
  )
    await api("/v1/admin/auth/verify-session", { signal, offlineBypass: true });
  await synchronizePortalRequests(owner, signal);
  await synchronizeDocumentUploads(owner, signal);
  if (session.activeRole === "producer")
    try {
      await synchronize(session.userId, signal);
    } catch (error) {
      if (
        ["RECENT_AUTH_REQUIRED", "AUTH_REQUIRED", "SESSION_EXPIRED"].includes(
          (error as Error).message,
        )
      )
        window.dispatchEvent(
          new CustomEvent("hvm:offline-auth-required", {
            detail: { scope: owner.scope },
          }),
        );
      throw error;
    }
  await refreshPortalCache(owner, signal);
  if (!signal?.aborted)
    window.dispatchEvent(new Event("hvm:account-synchronized"));
}
