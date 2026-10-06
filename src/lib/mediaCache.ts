const ORIGIN = "https://xipbsazvymkqqfmfegwu.supabase.co";
const entries = new Map<string, { url: string; until: number }>();
const MAX_ENTRIES = 512;
function keyOf(value: string) {
  try {
    const url = new URL(value);
    if (
      url.origin !== ORIGIN ||
      !/^\/storage\/v1\/object\/sign\/(?:product-media|store-media)\//.test(
        url.pathname,
      )
    )
      return null;
    url.searchParams.delete("token");
    return url.href;
  } catch {
    return null;
  }
}
function expiresAt(value: string) {
  try {
    const token = new URL(value).searchParams.get("token"),
      payload = token?.split(".")[1];
    if (!payload) return 0;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const data = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    );
    return typeof data.exp === "number" ? data.exp * 1000 - 60000 : 0;
  } catch {
    return 0;
  }
}
export function mediaUrlCacheUntil(value: string) {
  return keyOf(value) ? Math.min(expiresAt(value), Date.now() + 5 * 60000) : 0;
}
// Immutable Storage paths can receive a new signature at every API refresh or
// server cold start. Reuse the same still-valid image URL across page views so
// the browser reuses its download/decoded image. Never cache domain data, auth
// tokens, non-media URLs or unrecognized/expired signatures.
export function stableMediaUrl(value: string) {
  const key = keyOf(value);
  if (!key) return value;
  const current = entries.get(key);
  if (current && current.until > Date.now()) return current.url;
  entries.delete(key);
  const until = mediaUrlCacheUntil(value);
  if (until > Date.now()) entries.set(key, { url: value, until });
  while (entries.size > MAX_ENTRIES)
    entries.delete(entries.keys().next().value!);
  return value;
}
export function invalidateMediaUrl(value: string) {
  const key = keyOf(value);
  if (key) entries.delete(key);
}
