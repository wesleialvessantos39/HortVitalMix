import { Router } from "express";

/** Mostra apenas APKs publicados e assinados pelo fluxo oficial do repositorio. */
export const mobileReleaseRouter = Router();
type Asset = { name?: unknown; browser_download_url?: unknown; size?: unknown };
type Release = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: Asset[];
  published_at?: unknown;
};
type Latest = {
  android: null | {
    version: string;
    buildNumber: number;
    downloadUrl: string;
    checksumUrl: string | null;
    sizeBytes: number;
    publishedAt: string | null;
  };
  ios: { downloadUrl: null; distribution: "apple-authorized-only" };
};
const source = "https://api.github.com/repos/wesleialvessantos39/HortVitalMix/releases?per_page=10";
const prefix = "https://github.com/wesleialvessantos39/HortVitalMix/releases/download/";
let cache: { until: number; data: Latest } | null = null;

mobileReleaseRouter.get("/mobile/releases/latest", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=60, s-maxage=300");
  if (cache && cache.until > Date.now()) {
    res.json(cache.data);
    return;
  }
  try {
    const remote = await fetch(source, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "HortiVitalMix-mobile-updates",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!remote.ok) throw new Error("RELEASE_SOURCE_UNAVAILABLE");
    const data = await remote.json() as unknown;
    if (!Array.isArray(data)) throw new Error("RELEASE_RESPONSE_INVALID");
    let android: Latest["android"] = null;
    for (const release of data as Release[]) {
      if (release.draft || release.prerelease || typeof release.tag_name !== "string") continue;
      const match = /^hvm-mobile-r([1-9][0-9]*)$/.exec(release.tag_name);
      if (!match || !Array.isArray(release.assets)) continue;
      const number = Number(match[1]);
      if (!Number.isSafeInteger(number)) continue;
      const download = prefix + release.tag_name + "/";
      const apkName = "HortiVitalMix-Android-" + number + ".apk";
      const shaName = "HortiVitalMix-Android-" + number + ".sha256";
      const apk = release.assets.find((asset) =>
        asset.name === apkName &&
        asset.browser_download_url === download + apkName &&
        typeof asset.size === "number" && asset.size > 0
      );
      if (!apk || typeof apk.browser_download_url !== "string") continue;
      const sha = release.assets.find((asset) =>
        asset.name === shaName && asset.browser_download_url === download + shaName
      );
      android = {
        version: "1.0." + number,
        buildNumber: number,
        downloadUrl: apk.browser_download_url,
        checksumUrl: typeof sha?.browser_download_url === "string" ? sha.browser_download_url : null,
        sizeBytes: apk.size as number,
        publishedAt: typeof release.published_at === "string" ? release.published_at : null,
      };
      break;
    }
    const value: Latest = { android, ios: { downloadUrl: null, distribution: "apple-authorized-only" } };
    cache = { until: Date.now() + 300000, data: value };
    res.json(value);
  } catch {
    res.status(503).json({ error: "MOBILE_RELEASES_UNAVAILABLE" });
  }
});
