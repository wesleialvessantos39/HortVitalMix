import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  native: false, platform: "web", getInfo: vi.fn(), open: vi.fn(), addListener: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => sdk.native, getPlatform: () => sdk.platform },
  CapacitorHttp: { request: vi.fn() },
}));
vi.mock("@capacitor/app", () => ({ App: { getInfo: sdk.getInfo, addListener: sdk.addListener } }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: sdk.open } }));

beforeEach(() => {
  vi.resetModules();
  sdk.native = true;
  sdk.platform = "android";
  sdk.getInfo.mockReset().mockResolvedValue({ id: "br.com.hortivitalmix.app", name: "HortiVitalMix", version: "1.4.0", build: "42" });
  sdk.open.mockReset().mockResolvedValue(undefined);
  sdk.addListener.mockReset();
  vi.stubEnv("VITE_HVM_NATIVE_RUNTIME_HASH", "a".repeat(64));
  vi.stubEnv("VITE_HVM_NATIVE_BACKEND_ORIGIN", "https://hortvitalmix.vercel.app");
});
afterEach(() => vi.unstubAllEnvs());

describe("identity and installation of the signed native application", () => {
  it("does not treat an Android user agent or a browser query as an installed package", async () => {
    sdk.native = false;
    sdk.platform = "web";
    vi.stubGlobal("navigator", { userAgent: "Android HortiVitalMix/999.0" });
    const { readInstalledApp } = await import("../../src/lib/installedApp");
    expect(await readInstalledApp()).toBeNull();
    expect(sdk.getInfo).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("deduplicates actual App.getInfo reads and preserves build, platform and runtime identity", async () => {
    const { readInstalledApp } = await import("../../src/lib/installedApp");
    const [first, second] = await Promise.all([readInstalledApp(), readInstalledApp()]);
    expect(first).toEqual({ platform: "android", version: "1.4.0", buildNumber: 42, runtimeFingerprint: "a".repeat(64) });
    expect(second).toBe(first);
    expect(sdk.getInfo).toHaveBeenCalledOnce();
  });
  for (const build of ["", "1.4", "NaN", "-1", "0", "2147483648"]) {
    it(`fails closed for an unverifiable signed build (${JSON.stringify(build)})`, async () => {
      sdk.getInfo.mockResolvedValue({ version: "1.0.0", build });
      const { readInstalledApp } = await import("../../src/lib/installedApp");
      await expect(readInstalledApp()).rejects.toThrow("NATIVE_BUILD_UNAVAILABLE");
      expect(sdk.open).not.toHaveBeenCalled();
    });
  }
  it("requires the runtime fingerprint compiled by the native pipeline and permits a retry after SDK failure", async () => {
    vi.stubEnv("VITE_HVM_NATIVE_RUNTIME_HASH", "");
    const { readInstalledApp } = await import("../../src/lib/installedApp");
    await expect(readInstalledApp()).rejects.toThrow("NATIVE_RUNTIME_UNAVAILABLE");
    vi.stubEnv("VITE_HVM_NATIVE_RUNTIME_HASH", "b".repeat(64));
    expect((await readInstalledApp())?.runtimeFingerprint).toBe("b".repeat(64));
  });
  it("only opens the stable installation route on the backend compiled into the signed app", async () => {
    vi.stubEnv("VITE_HVM_NATIVE_BACKEND_ORIGIN", "https://app.exemplo.com.br");
    const { openNativeDownload, nativeDownloadDestination } = await import("../../src/lib/installedApp");
    expect(sdk.open).not.toHaveBeenCalled();
    await openNativeDownload("ios");
    expect(sdk.open).toHaveBeenCalledExactlyOnceWith({ url: "https://app.exemplo.com.br/downloads/ios" });
    expect(() => nativeDownloadDestination("android?redirect=https://evil.invalid" as "android")).toThrow("NATIVE_PLATFORM_UNAVAILABLE");
  });
  it("rejects a downloaded or query-specified origin masquerading as build configuration", async () => {
    vi.stubEnv("VITE_HVM_NATIVE_BACKEND_ORIGIN", "https://hortvitalmix.vercel.app/?redirect=https://evil.invalid");
    const { openNativeDownload } = await import("../../src/lib/installedApp");
    await expect(openNativeDownload("android")).rejects.toThrow("NATIVE_BACKEND_INVALID");
    expect(sdk.open).not.toHaveBeenCalled();
  });
  it("cleans a resume listener that finishes registration after its subscriber is disposed", async () => {
    let finish!: (value: { remove: () => Promise<void> }) => void;
    const remove = vi.fn().mockResolvedValue(undefined);
    sdk.addListener.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { subscribeNativeResume } = await import("../../src/lib/installedApp");
    const onResume = vi.fn();
    const stop = subscribeNativeResume(onResume);
    await vi.waitFor(() => expect(sdk.addListener).toHaveBeenCalledOnce());
    stop();
    finish({ remove });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    const callback = sdk.addListener.mock.calls[0][1];
    callback({ isActive: true });
    expect(onResume).not.toHaveBeenCalled();
  });
});
