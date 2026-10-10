import { eraseOwnOfflineData } from "./offlineDb";
const key = "hvm.account.erasure.cleanup";
const pending = new Set<string>();
let flight: Promise<boolean> | null = null;
function remembered() {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (Array.isArray(ids))
      for (const id of ids)
        if (typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id))
          pending.add(id);
  } catch {
    /* Memory cleanup still works when persistent storage is unavailable. */
  }
}
function save() {
  try {
    if (pending.size) localStorage.setItem(key, JSON.stringify([...pending]));
    else localStorage.removeItem(key);
  } catch {
    /* Retry in this document when storage becomes accessible. */
  }
}
/** Called only after the server confirms a consented account deletion. */
export async function rememberConfirmedAccountErasure(userId: string) {
  remembered();
  pending.add(userId);
  save();
  return drainAccountErasureCleanup();
}
export async function drainAccountErasureCleanup(): Promise<boolean> {
  if (flight) return flight;
  remembered();
  flight = (async () => {
    for (const id of [...pending]) {
      try {
        await eraseOwnOfflineData(id);
        pending.delete(id);
        save();
      } catch {
        /* Keep the confirmed cleanup request for a later storage opportunity. */
      }
    }
    return pending.size === 0;
  })();
  try {
    return await flight;
  } finally {
    flight = null;
  }
}
export function startAccountErasureCleanup() {
  void drainAccountErasureCleanup();
  window.addEventListener("focus", () => void drainAccountErasureCleanup());
  window.addEventListener("online", () => void drainAccountErasureCleanup());
}
