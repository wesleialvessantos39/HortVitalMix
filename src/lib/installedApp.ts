import { isNativeApp, nativeBackendOrigin } from "./nativeTransport";
import type { AppPlatform } from "../../shared/contracts/appDistribution";

export type InstalledNativeApp = {
  platform: AppPlatform;
  version: string;
  buildNumber: number;
  runtimeFingerprint: string;
};

let installed: Promise<InstalledNativeApp | null> | null = null;

/** Read the signed application's identity. Browsers and user agents are not evidence of an installed build. */
export function readInstalledApp(): Promise<InstalledNativeApp | null> {
  if (!isNativeApp()) return Promise.resolve(null);
  if (installed) return installed;
  installed = (async () => {
    const [{ Capacitor }, { App }] = await Promise.all([
      import("@capacitor/core"),
      import("@capacitor/app"),
    ]);
    const platform = Capacitor.getPlatform();
    if (platform !== "android" && platform !== "ios") throw Error("NATIVE_PLATFORM_UNAVAILABLE");
    const info = await App.getInfo();
    if (!/^\d+$/.test(info.build)) throw Error("NATIVE_BUILD_UNAVAILABLE");
    const buildNumber = Number(info.build);
    if (!Number.isSafeInteger(buildNumber) || buildNumber < 1 || buildNumber > 2147483647)
      throw Error("NATIVE_BUILD_UNAVAILABLE");
    const runtimeFingerprint = import.meta.env.VITE_HVM_NATIVE_RUNTIME_HASH ?? "";
    if (!/^[a-f0-9]{64}$/.test(runtimeFingerprint)) throw Error("NATIVE_RUNTIME_UNAVAILABLE");
    return { platform, version: info.version, buildNumber, runtimeFingerprint };
  })();
  void installed.catch(() => { installed = null; });
  return installed;
}

/** Destinations come from the application's signed backend configuration, never release-provided arbitrary URLs. */
export function nativeDownloadDestination(platform: AppPlatform): string {
  if (platform !== "android" && platform !== "ios") throw Error("NATIVE_PLATFORM_UNAVAILABLE");
  const origin = nativeBackendOrigin();
  if (!origin) throw Error("NATIVE_PLATFORM_UNAVAILABLE");
  return new URL(`/downloads/${platform}`, origin).href;
}

export async function openNativeDownload(platform: AppPlatform): Promise<void> {
  const url = nativeDownloadDestination(platform);
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url });
}

export function subscribeNativeResume(listener: () => void): () => void {
  if (!isNativeApp()) return () => {};
  let disposed = false;
  let remove: (() => Promise<void>) | undefined;
  void import("@capacitor/app").then(async ({ App }) => {
    const handle = await App.addListener("appStateChange", ({ isActive }) => {
      if (!disposed && isActive) listener();
    });
    if (disposed) await handle.remove();
    else remove = () => handle.remove();
  }).catch(() => { /* Focus and visibility polling remain available. */ });
  return () => { disposed = true; void remove?.(); };
}
