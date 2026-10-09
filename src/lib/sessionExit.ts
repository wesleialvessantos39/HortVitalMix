import { clearAdminAccess } from "./adminAccessHandoff";
import { clearAdminSession } from "./adminSessionStore";
import { cryptoRandomUUID } from "./uuid";

const exitKey = "hvm.session.exit";
const received = new Set<string>();
let channel: BroadcastChannel | null = null;

function receiveExit(id: unknown) {
  if (typeof id !== "string" || id.length > 100 || received.has(id)) return;
  received.add(id);
  if (received.size > 16) received.delete(received.values().next().value!);
  // This message contains no credential or personal data. Server-side session
  // revocation remains the authority; invalidate cached UI in other tabs too.
  try {
    clearAdminSession();
  } catch {
    /* Storage may be disabled. */
  }
  clearAdminAccess();
  window.dispatchEvent(new Event("hvm:session-cleared"));
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === exitKey && event.newValue) receiveExit(event.newValue);
  });
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel("hvm-session-exit");
      channel.onmessage = (event: MessageEvent<unknown>) =>
        receiveExit(event.data);
    } catch {
      /* The storage event remains available. */
    }
  }
}

export function announceBrowserSessionExit() {
  const id = cryptoRandomUUID();
  receiveExit(id);
  try {
    localStorage.setItem(exitKey, id);
  } catch {
    /* No persistent storage. */
  }
  try {
    channel?.postMessage(id);
  } catch {
    /* The storage event is a fallback. */
  }
}
