import { useEffect } from "react";
import type { ShellSession } from "../hooks/useSession";
import { synchronizeOwnAccount } from "../lib/accountSync";

/** Sync only this public identity. Commands retain their original idempotency keys. */
export function AutomaticAccountSync({
  session,
}: {
  session: ShellSession | null;
}) {
  useEffect(() => {
    if (
      !session ||
      (session.activeRole !== "consumer" && session.activeRole !== "producer")
    )
      return;
    const controller = new AbortController();
    let flight = false;
    const sync = async () => {
      if (
        flight ||
        controller.signal.aborted ||
        !navigator.onLine ||
        document.visibilityState === "hidden"
      )
        return;
      flight = true;
      try {
        await synchronizeOwnAccount(session, controller.signal);
      } catch {
        /* Durable commands and the visible offline status retain recovery. */
      } finally {
        flight = false;
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 60_000);
    window.addEventListener("online", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("hvm:offline-changed", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("hvm:offline-changed", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [session?.userId, session?.activeRole]);
  return null;
}
