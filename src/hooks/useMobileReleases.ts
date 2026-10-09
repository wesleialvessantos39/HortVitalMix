import { useSyncExternalStore } from "react";
import { PublicMobileReleasesSchema, type PublicMobileReleases } from "../../shared/contracts/mobileReleases";
import { api } from "../lib/api";
import { subscribeNativeResume } from "../lib/installedApp";

type Snapshot = { data: PublicMobileReleases | null; loading: boolean; error: boolean };
const initial: Snapshot = { data: null, loading: true, error: false };
let snapshot = initial;
let controller: AbortController | null = null;
let timer: number | undefined;
let queued = false;
let stopNativeResume: (() => void) | undefined;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}
async function load() {
  if (!listeners.size) return;
  if (controller) { queued = true; return; }
  const request = new AbortController();
  controller = request;
  try {
    const response = await api<unknown>("/v1/mobile-releases", { signal: request.signal });
    const parsed = PublicMobileReleasesSchema.safeParse(response);
    if (!parsed.success) throw Error("INVALID_MOBILE_RELEASES");
    if (!request.signal.aborted) publish({ data: parsed.data, loading: false, error: false });
  } catch {
    // Do not offer stale/withdrawn binaries after a failed check. Keep a known
    // minimum build so a mandatory security notice does not silently disappear.
    if (!request.signal.aborted) publish({
      data: snapshot.data ? { ...snapshot.data, android: null, ios: null } : null,
      loading: false, error: true,
    });
  } finally {
    if (controller === request) {
      controller = null;
      if (queued) { queued = false; void load(); }
    }
  }
}
const reloadVisible = () => { if (document.visibilityState !== "hidden") void load(); };
const reload = () => { void load(); };

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void load();
    timer = window.setInterval(reloadVisible, 60_000);
    window.addEventListener("focus", reloadVisible);
    window.addEventListener("online", reloadVisible);
    window.addEventListener("hvm:mobile-releases-changed", reload);
    document.addEventListener("visibilitychange", reloadVisible);
    stopNativeResume = subscribeNativeResume(reloadVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    controller?.abort();
    controller = null;
    queued = false;
    window.clearInterval(timer);
    window.removeEventListener("focus", reloadVisible);
    window.removeEventListener("online", reloadVisible);
    window.removeEventListener("hvm:mobile-releases-changed", reload);
    document.removeEventListener("visibilitychange", reloadVisible);
    stopNativeResume?.();
    stopNativeResume = undefined;
    snapshot = initial;
  };
}
export function useMobileReleases() {
  return { ...useSyncExternalStore(subscribe, () => snapshot, () => initial), reload };
}
