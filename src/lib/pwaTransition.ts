// A short transition lease prevents NEW writes while every tab votes. Existing
// operations always finish before the lease is taken. No command is replayed.
let lease: { token: string; release: () => void; done: Promise<void> } | null =
  null;
const blockers = new Map<symbol, string>();
const changed = () => {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("hvm:pwa-safety-changed"));
};

export function holdPwaTransition(token: string) {
  if (lease) return lease.token === token;
  let release!: () => void;
  lease = {
    token,
    done: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release(),
  };
  changed();
  return true;
}
export function releasePwaTransition(token: string) {
  if (lease?.token !== token) return;
  const current = lease;
  lease = null;
  current.release();
  changed();
}
export function pwaTransitionHeld() {
  return lease !== null;
}
export async function waitForPwaTransition() {
  while (lease) await lease.done;
}

/** Also covers queued/uncertain cart commands outside HTML forms. */
export function blockPwaUpdate(reason: string) {
  const key = Symbol();
  blockers.set(key, reason);
  changed();
  return () => {
    blockers.delete(key);
    changed();
  };
}
export function pwaOperationBlockReason() {
  return blockers.values().next().value ?? null;
}
