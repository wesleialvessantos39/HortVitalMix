import { describe, expect, it } from "vitest";
import { detectPwaDevice, type DeviceSignals } from "../../src/lib/pwaDevice";
const signals = (changes: Partial<DeviceSignals> = {}): DeviceSignals => ({
  userAgent: "",
  platform: "",
  maxTouchPoints: 0,
  standalone: false,
  ...changes,
});
describe("local device signals", () => {
  it.each([
    [
      { userAgent: "Mozilla Android Chrome/153", platform: "Linux armv8" },
      "android",
    ],
    [{ userAgent: "Mozilla iPhone Safari/605", platform: "iPhone" }, "ios"],
    [{ userAgent: "Mozilla iPad Safari/605", platform: "iPad" }, "ios"],
    [
      {
        userAgent: "Mozilla Macintosh Safari/605",
        platform: "MacIntel",
        maxTouchPoints: 5,
      },
      "ios",
    ],
    [{ userAgent: "privacy reduced", uaPlatform: "Android" }, "android"],
    [{ platform: "Win32", maxTouchPoints: 10 }, "windows"],
    [{ platform: "MacIntel", maxTouchPoints: 0 }, "macos"],
    [{ platform: "Linux x86_64" }, "linux"],
    [{}, "unknown"],
  ] as const)("identifies %j as %s", (input, expected) =>
    expect(detectPwaDevice(signals(input)).platform).toBe(expected),
  );
  it.each([
    "WhatsApp",
    "Instagram",
    "FBAN/FBIOS",
    "FBAV/42",
    "Mozilla Android; wv)",
    "Line/42",
  ])("detects internal browser %s", (userAgent) =>
    expect(detectPwaDevice(signals({ userAgent })).internalBrowser).toBe(true),
  );
  it("keeps standalone separate from platform and installation history", () => {
    expect(
      detectPwaDevice(signals({ platform: "MacIntel", standalone: true }))
        .standalone,
    ).toBe(true);
    expect(detectPwaDevice(signals({ platform: "MacIntel" })).standalone).toBe(
      false,
    );
  });
  it.each([
    ["Version/27.0 Mobile Safari/605.1.15", "safari"],
    ["CriOS/153 Mobile Safari/604.1", "chrome"],
    ["FxiOS/144 Mobile Safari/605.1.15", "firefox"],
    ["EdgiOS/153 Mobile Safari/605.1.15", "edge"],
    ["AppleWebKit/605.1.15 Mobile", "unknown"],
  ])(
    "distinguishes iOS browser signals %s without assuming Safari",
    (suffix, browser) => {
      const device = detectPwaDevice(
        signals({
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) " + suffix,
          platform: "iPhone",
          maxTouchPoints: 5,
        }),
      );
      expect(device.platform).toBe("ios");
      expect(device.browser).toBe(browser);
      expect(device.internalBrowser).toBe(false);
    },
  );
});
