export type DevicePlatform =
  "android" | "ios" | "windows" | "macos" | "linux" | "unknown";
export type DeviceSignals = {
  userAgent: string;
  platform: string;
  uaPlatform?: string;
  maxTouchPoints: number;
  standalone: boolean;
};

/** Capability signals are local only; no identifier or fingerprint is collected. */
export function detectPwaDevice(signals: DeviceSignals) {
  const ua = signals.userAgent;
  const platform = signals.uaPlatform || signals.platform;
  let device: DevicePlatform = "unknown";
  if (
    /iPad|iPhone|iPod/i.test(ua) ||
    (/Mac/i.test(platform) && signals.maxTouchPoints > 1)
  )
    device = "ios";
  else if (/Android/i.test(platform + " " + ua)) device = "android";
  else if (/Win/i.test(platform)) device = "windows";
  else if (/Mac/i.test(platform)) device = "macos";
  else if (/Linux|CrOS/i.test(platform)) device = "linux";
  const internalBrowser =
    /Instagram|FBAN|FBAV|WhatsApp|Line\/|MicroMessenger|; wv\)|\bwv\b/i.test(
      ua,
    );
  const browser = /Firefox|FxiOS/i.test(ua)
    ? "firefox"
    : /SamsungBrowser/i.test(ua)
      ? "samsung"
      : /Edg|EdgiOS/i.test(ua)
        ? "edge"
        : /Chrome|CriOS/i.test(ua)
          ? "chrome"
          : /Safari/i.test(ua)
            ? "safari"
            : "unknown";
  return {
    platform: device,
    browser,
    internalBrowser,
    standalone: signals.standalone,
  };
}

export function readPwaDevice() {
  const nav = navigator as Navigator & {
    standalone?: boolean;
    userAgentData?: { platform?: string };
  };
  return detectPwaDevice({
    userAgent: nav.userAgent,
    platform: nav.platform,
    uaPlatform: nav.userAgentData?.platform,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      nav.standalone === true,
  });
}
