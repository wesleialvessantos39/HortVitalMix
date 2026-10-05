import { supabaseAdmin } from "../supabase/client.ts";

const entries = new Map<string, { url: string; expires: number }>();
const pending = new Map<string, Promise<string>>();
const TTL_SECONDS = 900;
const REUSE_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 2048;

// Callers query current ownership/publication gates before passing paths here.
// Only image signatures are reused; business responses are never cached here.
export async function signedMediaUrls(bucket: string, paths: string[]) {
  const unique = [...new Set(paths)];
  const missing = unique.filter((path) => {
    const key = `${bucket}/${path}`;
    const cached = entries.get(key);
    if (cached && cached.expires <= Date.now()) entries.delete(key);
    return !entries.has(key) && !pending.has(key);
  });
  if (missing.length) {
    const batch = (async () => {
      if (!supabaseAdmin) throw Error("MEDIA_UNAVAILABLE");
      const signed = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrls(missing, TTL_SECONDS);
      if (
        signed.error ||
        signed.data?.length !== missing.length ||
        signed.data.some((item) => item.error || !item.signedUrl)
      )
        throw Error("MEDIA_UNAVAILABLE");
      signed.data.forEach((item, index) => {
        entries.set(`${bucket}/${missing[index]}`, {
          url: item.signedUrl!,
          expires: Date.now() + REUSE_MS,
        });
      });
      while (entries.size > MAX_ENTRIES)
        entries.delete(entries.keys().next().value!);
      return signed.data.map((item) => item.signedUrl!);
    })();
    missing.forEach((path, index) => {
      const key = `${bucket}/${path}`;
      const value = batch.then((urls) => urls[index]);
      pending.set(key, value);
      void value
        .finally(() => {
          if (pending.get(key) === value) pending.delete(key);
        })
        .catch(() => {});
    });
  }
  const urls = await Promise.all(
    unique.map((path) => {
      const key = `${bucket}/${path}`;
      return (
        pending.get(key) ??
        entries.get(key)?.url ??
        Promise.reject(Error("MEDIA_UNAVAILABLE"))
      );
    }),
  );
  return new Map(unique.map((path, index) => [path, urls[index]]));
}
