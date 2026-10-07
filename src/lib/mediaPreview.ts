import { apiBase } from "./api";
// A UUID identifies immutable bytes. The backend rechecks the public catalog;
// private/editing photos fall back to their existing authorized signed URL.
export function mediaPreview(value: string, width: 320 | 640 | 1280 = 640) {
  try {
    const u = new URL(value);
    if (u.origin !== "https://xipbsazvymkqqfmfegwu.supabase.co") return null;
    const m = u.pathname.match(
      /^\/storage\/v1\/object\/sign\/(product-media|store-media)\/(?:[0-9a-f-]{36}\/){1,2}([0-9a-f-]{36})-[0-9a-f]{64}\.(?:jpg|jpeg|png|webp)$/i,
    );
    return m
      ? `${apiBase()}/v1/public-media/${m[1] === "product-media" ? "product" : "store"}/${m[2].toLowerCase()}?width=${width}`
      : null;
  } catch {
    return null;
  }
}
export function mediaPreviewWidth(sizes?: string): 320 | 640 | 1280 {
  const width = typeof window === "undefined" ? 640 : window.innerWidth,
    ratio =
      typeof window === "undefined"
        ? 1
        : Math.min(window.devicePixelRatio || 1, 2);
  if (sizes === "52px") return 320;
  const pixels =
    (sizes?.includes("100vw") ? width : Math.min(width, 480)) * ratio;
  return pixels <= 320 ? 320 : pixels <= 640 ? 640 : 1280;
}
