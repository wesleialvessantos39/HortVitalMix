import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mobileReleaseRouter } from "../../server/routes/mobileReleaseRoutes";

afterEach(() => vi.unstubAllGlobals());

describe("mobile release discovery", () => {
  it("returns only an approved Android APK from the official release path", async () => {
    const tag = "hvm-mobile-r101";
    const base = "https://github.com/wesleialvessantos39/HortVitalMix/releases/download/" + tag + "/";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      {
        tag_name: "unrelated-release",
        assets: [{ name: "malware.apk", browser_download_url: "https://example.org/malware.apk", size: 500 }],
      },
      {
        tag_name: tag,
        draft: false,
        prerelease: false,
        published_at: "2026-10-09T00:00:00Z",
        assets: [
          { name: "HortiVitalMix-Android-101.apk", browser_download_url: base + "HortiVitalMix-Android-101.apk", size: 5000 },
          { name: "HortiVitalMix-Android-101.sha256", browser_download_url: base + "HortiVitalMix-Android-101.sha256", size: 64 },
          { name: "fake.apk", browser_download_url: "https://example.org/fake.apk", size: 999 },
        ],
      },
    ]), { status: 200 })));
    const app = express();
    app.use("/api/v1", mobileReleaseRouter);
    const result = await request(app).get("/api/v1/mobile/releases/latest");
    expect(result.status).toBe(200);
    expect(result.body.android).toMatchObject({
      buildNumber: 101,
      version: "1.0.101",
      downloadUrl: base + "HortiVitalMix-Android-101.apk",
      checksumUrl: base + "HortiVitalMix-Android-101.sha256",
      sizeBytes: 5000,
    });
    expect(result.body.ios.downloadUrl).toBeNull();
  });
});
