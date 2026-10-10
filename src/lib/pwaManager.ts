import { PwaVersionSchema, type PwaVersion } from "../../shared/contracts/pwa";
import { isNativeApp } from "./nativeTransport";
import { readPwaDevice } from "./pwaDevice";
import { cryptoRandomUUID } from "./uuid";
import {
  appUpdateBlockReason,
  inspectPwaSafety,
  startPwaSafety,
} from "./pwaSafety";
import {
  holdPwaTransition,
  pwaTransitionHeld,
  releasePwaTransition,
} from "./pwaTransition";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}
export type PwaUpdateState =
  | "checking"
  | "current"
  | "preparing"
  | "waiting"
  | "applying"
  | "offline"
  | "error"
  | "unsupported";
export type PwaSnapshot = {
  device: ReturnType<typeof readPwaDevice>;
  readiness: "checking" | "ready" | "unsupported" | "error";
  workerReady: boolean;
  promptAvailable: boolean;
  installState:
    "idle" | "prompting" | "accepted" | "dismissed" | "confirmed" | "error";
  version: PwaVersion | null;
  loadedBuildId: string;
  updateState: PwaUpdateState;
  reason: string | null;
  lastCheckedAt: string | null;
};
let snapshot: PwaSnapshot = {
  device: {
    platform: "unknown",
    browser: "unknown",
    internalBrowser: false,
    standalone: false,
  },
  readiness: "checking",
  workerReady: false,
  promptAvailable: false,
  installState: "idle",
  version: null,
  loadedBuildId: "",
  updateState: "checking",
  reason: null,
  lastCheckedAt: null,
};
const listeners = new Set<() => void>();
let started = false;
let registration: ServiceWorkerRegistration | null = null;
let deferredPrompt: InstallPromptEvent | null = null;
let checking: Promise<void> | null = null;
let applying = false;
let transitioningToken = "";
let transitionTimeout: ReturnType<typeof setTimeout> | undefined;
let lastAttempt = 0;
let reloading = false;
const publish = (next: Partial<PwaSnapshot>) => {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
};
export const getPwaSnapshot = () => snapshot;
export function subscribePwa(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const visible = () => document.visibilityState !== "hidden";

function workerVersion(worker: ServiceWorker): Promise<PwaVersion> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(Error("PWA_WORKER_TIMEOUT"));
    }, 4000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      const parsed = PwaVersionSchema.safeParse(event.data);
      if (parsed.success) resolve(parsed.data);
      else reject(Error("PWA_WORKER_INVALID"));
    };
    worker.postMessage({ type: "HVM_GET_VERSION" }, [channel.port2]);
  });
}
function releaseTransition() {
  if (transitioningToken) releasePwaTransition(transitioningToken);
  transitioningToken = "";
  clearTimeout(transitionTimeout);
}
function takeTransition(token: string) {
  if (!holdPwaTransition(token)) return false;
  transitioningToken = token;
  clearTimeout(transitionTimeout);
  transitionTimeout = setTimeout(() => {
    releaseTransition();
    applying = false;
    publish({
      updateState: "waiting",
      reason: "A atualização será tentada novamente em um momento seguro.",
    });
  }, 15000);
  return true;
}

async function reloadForActiveWorker() {
  const activeWorker =
    navigator.serviceWorker.controller ?? registration?.active;
  if (
    reloading ||
    !snapshot.loadedBuildId ||
    !navigator.onLine ||
    !activeWorker
  )
    return;
  try {
    const version = await workerVersion(activeWorker);
    if (version.buildId === snapshot.loadedBuildId) {
      releaseTransition();
      applying = false;
      publish({ updateState: "current", reason: null });
      return;
    }
    if (version.buildId !== snapshot.version?.buildId) return;
    const blocked = await inspectPwaSafety();
    if (blocked) {
      releaseTransition();
      applying = false;
      publish({ updateState: "waiting", reason: blocked });
      return;
    }
    if (!transitioningToken && !takeTransition(cryptoRandomUUID())) return;
    if (appUpdateBlockReason()) {
      releaseTransition();
      return;
    }
    reloading = true;
    publish({ updateState: "applying", reason: null });
    // Only after confirmed complete cache + all safety guards. Native apps
    // never reach this manager. No queue deletion, logout or command replay.
    window.location.reload();
  } catch {
    releaseTransition();
    publish({
      updateState: "error",
      reason:
        "Não foi possível confirmar a nova versão. Seu trabalho foi preservado.",
    });
  }
}

async function onWorkerMessage(event: MessageEvent) {
  const message = event.data;
  if (!message || typeof message.type !== "string") return;
  const source = event.source as ServiceWorker | null;
  if (!source?.scriptURL) return;
  const sourceUrl = new URL(source.scriptURL);
  if (
    sourceUrl.origin !== location.origin ||
    sourceUrl.pathname !== "/offline-worker.js"
  )
    return;
  if (message.type === "HVM_BUILD_QUERY") {
    source.postMessage({
      type: "HVM_CLIENT_VOTE",
      token: message.token,
      buildId: snapshot.loadedBuildId,
    });
  } else if (
    message.type === "HVM_PREPARE_UPDATE" ||
    message.type === "HVM_COMMIT_UPDATE"
  ) {
    const token =
      message.type === "HVM_COMMIT_UPDATE"
        ? String(message.token).replace(/:commit$/, "")
        : message.token;
    let reason = await inspectPwaSafety();
    if (!reason && (!snapshot.loadedBuildId || !takeTransition(token)))
      reason = "Esta aba ainda está verificando sua atividade.";
    if (!reason) {
      try {
        const preparedVersion = await workerVersion(source);
        if (preparedVersion.buildId !== message.buildId)
          throw Error("PWA_VOTE_BUILD_MISMATCH");
        // Background tabs may not have fetched the new version yet. The
        // waiting worker proves the same complete, verified build for all tabs.
        publish({ version: preparedVersion });
      } catch {
        reason = "Não foi possível confirmar os arquivos da atualização.";
      }
    }
    reason = appUpdateBlockReason() ?? reason;
    if (reason && transitioningToken === token) releaseTransition();
    source.postMessage({
      type: "HVM_CLIENT_VOTE",
      token: message.token,
      safe: !reason,
      reason,
    });
    if (!reason) publish({ updateState: "applying", reason: null });
  } else if (message.type === "HVM_ABORT_UPDATE") {
    if (transitioningToken === message.token) releaseTransition();
    applying = false;
    publish({
      updateState: "waiting",
      reason: "A atualização aguarda um momento seguro em todas as abas.",
    });
  } else if (message.type === "HVM_UPDATE_DEFERRED") {
    if (transitioningToken && transitioningToken !== message.token) return;
    releaseTransition();
    applying = false;
    publish({
      updateState: "waiting",
      reason: message.reason || "A atualização aguarda as outras abas.",
    });
  } else if (message.type === "HVM_PREPARATION_FAILED") {
    releaseTransition();
    publish({
      updateState: "error",
      reason:
        "Não foi possível preparar todos os arquivos. A versão funcional foi preservada.",
    });
  } else if (message.type === "HVM_UPDATE_ACTIVATED") {
    publish({ workerReady: true, readiness: "ready" });
    void reloadForActiveWorker();
  }
}

export async function tryPwaUpdate() {
  if (
    isNativeApp() ||
    !registration ||
    applying ||
    reloading ||
    !visible() ||
    !navigator.onLine ||
    pwaTransitionHeld()
  )
    return;
  if (Date.now() - lastAttempt < 5000) return;
  lastAttempt = Date.now();
  if (!registration.waiting) {
    await reloadForActiveWorker();
    return;
  }
  applying = true;
  let submitted = false;
  try {
    const worker = registration.waiting;
    const version = await workerVersion(worker);
    // A stale waiting build must not replace the actual published candidate.
    if (!snapshot.version || version.buildId !== snapshot.version.buildId) {
      publish({
        updateState: "preparing",
        reason: "Verificando os arquivos da versão publicada.",
      });
      return;
    }
    const reason = await inspectPwaSafety();
    if (reason) {
      publish({ updateState: "waiting", reason });
      return;
    }
    publish({ updateState: "preparing", reason: null });
    worker.postMessage({
      type: "HVM_REQUEST_UPDATE",
      token: cryptoRandomUUID(),
    });
    submitted = true;
    // A bounded response timer; the worker decides using ALL live clients.
    setTimeout(() => {
      applying = false;
    }, 9000);
  } catch {
    publish({
      updateState: "error",
      reason: "Não foi possível verificar o aplicativo agora.",
    });
  } finally {
    if (!submitted) applying = false;
  }
}

function observeRegistration(reg: ServiceWorkerRegistration) {
  const inspect = () => {
    if (reg.waiting) {
      publish({ updateState: "waiting" });
      void tryPwaUpdate();
    }
    const installing = reg.installing;
    if (!installing) return;
    if (snapshot.version?.buildId !== snapshot.loadedBuildId)
      publish({ updateState: "preparing" });
    installing.addEventListener("statechange", () => {
      if (
        installing.state === "installed" ||
        installing.state === "activated"
      ) {
        publish({
          workerReady: Boolean(reg.active || reg.waiting),
          readiness: "ready",
        });
        void tryPwaUpdate();
      }
      if (installing.state === "redundant")
        publish({
          updateState: "error",
          reason:
            "A preparação falhou. A versão atual e seus dados foram preservados.",
        });
    });
  };
  reg.addEventListener("updatefound", inspect);
  inspect();
}

async function check() {
  if (isNativeApp() || !visible() || pwaTransitionHeld()) return;
  if (!navigator.onLine) {
    publish({
      updateState: "offline",
      reason: "Sem conexão. A verificação retomará quando você se conectar.",
    });
    return;
  }
  if (!registration?.waiting)
    publish({ updateState: "checking", reason: null });
  try {
    const response = await fetch("/pwa-version.json", {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (
      !response.ok ||
      !/application\/json/i.test(response.headers.get("content-type") ?? "")
    )
      throw Error("PWA_VERSION_UNAVAILABLE");
    const version = PwaVersionSchema.parse(await response.json());
    const manifestResponse = await fetch("/manifest.webmanifest", {
      cache: "no-cache",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!manifestResponse.ok) throw Error("PWA_MANIFEST_UNAVAILABLE");
    const manifest = await manifestResponse.json();
    if (
      manifest.name !== "HortiVitalMix" ||
      manifest.display !== "standalone" ||
      manifest.start_url !== "/" ||
      manifest.scope !== "/" ||
      ![192, 512].every((size) =>
        manifest.icons?.some(
          (icon: { src: string; sizes: string }) =>
            icon.src === `/app-icons/icon-${size}.png` &&
            icon.sizes === `${size}x${size}`,
        ),
      )
    )
      throw Error("PWA_MANIFEST_INVALID");
    publish({ version, lastCheckedAt: new Date().toISOString() });
    if (!window.isSecureContext || !("serviceWorker" in navigator)) {
      publish({
        readiness: "unsupported",
        updateState: "unsupported",
        reason:
          "Abra este endereço em um navegador com HTTPS e suporte a aplicativos web.",
      });
      return;
    }
    if (!import.meta.env.PROD) {
      publish({
        readiness: "unsupported",
        updateState: "unsupported",
        reason: "A instalação é verificada na versão web publicada.",
      });
      return;
    }
    if (!registration) {
      registration = await navigator.serviceWorker.register(
        "/offline-worker.js",
        { scope: "/", updateViaCache: "none" },
      );
      observeRegistration(registration);
    } else await registration.update();
    const preparedWorker = registration.waiting || registration.active;
    const verifiedWorker = preparedWorker
      ? await workerVersion(preparedWorker).catch(() => null)
      : null;
    const ready = snapshot.workerReady || Boolean(verifiedWorker);
    publish({
      workerReady: ready,
      readiness: ready ? "ready" : "checking",
      updateState:
        version.buildId === snapshot.loadedBuildId
          ? "current"
          : registration.waiting
            ? "waiting"
            : "preparing",
      reason: null,
    });
    await tryPwaUpdate();
    navigator.serviceWorker.controller?.postMessage({
      type: "HVM_CLEAN_CACHES",
    });
  } catch {
    publish({
      readiness: snapshot.workerReady ? "ready" : "error",
      updateState: "error",
      reason:
        "Não foi possível verificar agora. A versão atual e seus dados continuam preservados.",
    });
  }
}
export function checkPwaUpdate() {
  checking ??= check().finally(() => {
    checking = null;
  });
  return checking;
}

/** Called before React renders, so no early browser installation event is lost. */
export function startPwaManager() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (isNativeApp()) {
    publish({ readiness: "unsupported", updateState: "unsupported" });
    return;
  }
  startPwaSafety();
  publish({
    device: readPwaDevice(),
    loadedBuildId:
      document.querySelector<HTMLMetaElement>('meta[name="hvm-pwa-build"]')
        ?.content ?? "",
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    publish({ promptAvailable: true, installState: "idle" });
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    // Confirmation is distinct from execution in standalone; no localStorage
    // flag pretends that a later browser visit is an installed application.
    publish({
      promptAvailable: false,
      installState: "confirmed",
      device: readPwaDevice(),
    });
  });
  const displayMode = window.matchMedia("(display-mode: standalone)");
  const updateDisplayMode = () => publish({ device: readPwaDevice() });
  if (typeof displayMode.addEventListener === "function")
    displayMode.addEventListener("change", updateDisplayMode);
  else if (typeof displayMode.addListener === "function")
    displayMode.addListener(updateDisplayMode);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      void onWorkerMessage(event);
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      void reloadForActiveWorker();
    });
  }
  const checkVisible = () => {
    if (visible()) void checkPwaUpdate();
  };
  window.addEventListener("online", checkVisible);
  window.addEventListener("focus", checkVisible);
  window.addEventListener("offline", () =>
    publish({
      updateState: "offline",
      reason: "Sem conexão. Seus dados offline continuam neste aparelho.",
    }),
  );
  document.addEventListener("visibilitychange", checkVisible);
  window.addEventListener("hvm:pwa-check", checkVisible);
  for (const name of [
    "hvm:api-mutating",
    "hvm:offline-changed",
    "hvm:pwa-safety-changed",
    "hvm:session-changed",
    "hvm:session-cleared",
  ])
    window.addEventListener(name, () => {
      if (registration?.waiting) void tryPwaUpdate();
    });
  setInterval(checkVisible, 60000);
  setInterval(() => {
    if (registration?.waiting || snapshot.updateState === "waiting")
      void tryPwaUpdate();
  }, 2500);
  void checkPwaUpdate();
}

export async function requestPwaInstallation(): Promise<
  "guide" | "accepted" | "dismissed"
> {
  if (
    snapshot.device.standalone ||
    !deferredPrompt ||
    snapshot.device.internalBrowser ||
    snapshot.readiness !== "ready"
  )
    return "guide";
  const prompt = deferredPrompt;
  deferredPrompt = null;
  publish({ promptAvailable: false, installState: "prompting" });
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (snapshot.installState !== "confirmed")
      publish({ installState: choice.outcome });
    return choice.outcome;
  } catch {
    publish({ installState: "error" });
    return "guide";
  }
}
