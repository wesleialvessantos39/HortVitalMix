import { useEffect } from "react";
import type { ShellSession } from "../hooks/useSession";
import { synchronizeOwnAccount } from "../lib/accountSync";
import {
  currentOfflineIdentity,
  resetPortalBackoff,
} from "../lib/portalOffline";

/** Reconcile only the live portal. No update notification is rendered. */
export function AutomaticAccountSync({
  session,
}: {
  session: ShellSession | null;
}) {
  useEffect(() => {
    if (!session?.activeRole) return;
    const controller = new AbortController();
    let flight = false,
      lastAttempt = 0,
      retry = 0,
      moreWork = false;
    let delayed: ReturnType<typeof setTimeout> | undefined;
    const sync = async () => {
      if (
        flight ||
        controller.signal.aborted ||
        !navigator.onLine ||
        document.visibilityState === "hidden"
      )
        return;
      if (Date.now() - lastAttempt < 1500) return;
      lastAttempt = Date.now();
      flight = true;
      moreWork = false;
      try {
        await synchronizeOwnAccount(session, controller.signal);
        retry = 0;
      } catch {
        if (!controller.signal.aborted && navigator.onLine) {
          clearTimeout(delayed);
          delayed = setTimeout(
            () => void sync(),
            Math.min(60000, 2000 * 2 ** Math.min(retry++, 5)),
          );
        }
      } finally {
        flight = false;
        if (moreWork && !controller.signal.aborted) queued();
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 30_000);
    const queued = () => {
      if (flight) {
        moreWork = true;
        return;
      }
      clearTimeout(delayed);
      delayed = setTimeout(
        () => void sync(),
        Math.max(50, 1600 - (Date.now() - lastAttempt)),
      );
    };
    const workChanged = (event: Event) => {
      if ((event as CustomEvent<{ queued?: boolean }>).detail?.queued !== false)
        queued();
    };
    const reconnected = async () => {
      const owner = currentOfflineIdentity();
      if (owner) await resetPortalBackoff(owner.scope).catch(() => {});
      queued();
    };
    window.addEventListener("online", reconnected);
    window.addEventListener("focus", queued);
    window.addEventListener("hvm:offline-saved", queued);
    window.addEventListener("hvm:offline-work", workChanged);
    document.addEventListener("visibilitychange", queued);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      clearTimeout(delayed);
      window.removeEventListener("online", reconnected);
      window.removeEventListener("focus", queued);
      window.removeEventListener("hvm:offline-saved", queued);
      window.removeEventListener("hvm:offline-work", workChanged);
      document.removeEventListener("visibilitychange", queued);
    };
  }, [session?.userId, session?.activeRole]);
  return null;
}
