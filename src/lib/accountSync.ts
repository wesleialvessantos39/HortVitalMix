import { api } from "./api";
import { synchronize } from "./offlineDb";
import type { ShellSession } from "../hooks/useSession";

export async function synchronizeOwnAccount(
  session: ShellSession,
  signal?: AbortSignal,
) {
  if (session.activeRole !== "consumer" && session.activeRole !== "producer")
    throw Error("PUBLIC_ACCOUNT_REQUIRED");
  if (!navigator.onLine) throw Error("OFFLINE");
  await api("/v1/account/profile", { signal });
  if (session.activeRole === "producer")
    await synchronize(session.userId, signal);
  if (!signal?.aborted)
    window.dispatchEvent(new Event("hvm:account-synchronized"));
}
