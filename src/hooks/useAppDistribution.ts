import { useSyncExternalStore } from "react";
import {
  AppDistributionResponseSchema,
  type AppDistributionResponse,
} from "../../shared/contracts/appDistribution";
import { api } from "../lib/api";

type Snapshot = { data: AppDistributionResponse | null; error: boolean; loading: boolean };
const initial: Snapshot = { data: null, error: false, loading: true };
let snapshot = initial;
let controller: AbortController | null = null;
let timer: number | undefined;
let reloadQueued = false;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function load() {
  if (controller || !listeners.size) return;
  const request = new AbortController();
  controller = request;
  try {
    const result = await api<unknown>("/v1/app-distribution", { signal: request.signal });
    const parsed = AppDistributionResponseSchema.safeParse(result);
    if (!parsed.success) throw Error("INVALID_APP_DISTRIBUTION");
    if (!request.signal.aborted) publish({ data: parsed.data, error: false, loading: false });
  } catch {
    // Retirar um canal precisa valer também nas telas que já estavam abertas.
    if (!request.signal.aborted) publish({ data: null, error: true, loading: false });
  } finally {
    if (controller === request) {
      controller = null;
      if (reloadQueued) { reloadQueued = false; void load(); }
    }
  }
}

const reloadVisible = () => { if (document.visibilityState !== "hidden") void load(); };
const reloadLatest = () => {
  if (controller) reloadQueued = true;
  else void load();
};
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void load();
    timer = window.setInterval(reloadVisible, 60_000);
    window.addEventListener("focus", reloadVisible);
    window.addEventListener("hvm:app-distribution-changed", reloadLatest);
    document.addEventListener("visibilitychange", reloadVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    controller?.abort();
    controller = null;
    reloadQueued = false;
    window.clearInterval(timer);
    window.removeEventListener("focus", reloadVisible);
    window.removeEventListener("hvm:app-distribution-changed", reloadLatest);
    document.removeEventListener("visibilitychange", reloadVisible);
    snapshot = initial;
  };
}

export function useAppDistribution() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => initial);
  return { ...state, reload: reloadLatest };
}
