import {
  invalidateMediaUrl,
  mediaUrlCacheUntil,
  stableMediaUrl,
} from "./mediaCache";

const WAIT_MS = 8000;
const MAX_ENTRIES = 128;
type Entry = {
  promise: Promise<void>;
  until: number;
  image?: HTMLImageElement;
};
const entries = new Map<string, Entry>();

function prepare(value: string, priority: "high" | "low") {
  const src = stableMediaUrl(value);
  const previous = entries.get(src);
  if (previous && previous.until > Date.now()) {
    if (priority === "high" && previous.image)
      previous.image.fetchPriority = "high";
    return previous.promise;
  }
  entries.delete(src);
  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = priority;
  let resolve!: () => void;
  const entry: Entry = {
    image,
    until: Date.now() + WAIT_MS,
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
  };
  entries.set(src, entry);
  while (entries.size > MAX_ENTRIES)
    entries.delete(entries.keys().next().value!);
  let settled = false;
  const finish = (loaded: boolean) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    image.onload = null;
    image.onerror = null;
    delete entry.image;
    const until = loaded ? mediaUrlCacheUntil(src) : 0;
    if (entries.get(src) === entry) {
      if (until > Date.now()) entry.until = until;
      else entries.delete(src);
    }
    if (!loaded) invalidateMediaUrl(src);
    resolve();
  };
  const timer = setTimeout(() => finish(false), WAIT_MS);
  image.onload = () => {
    if (typeof image.decode === "function")
      void image.decode().then(
        () => finish(true),
        () => finish(false),
      );
    else finish(true);
  };
  image.onerror = () => finish(false);
  image.src = src;
  return entry.promise;
}

// Prepare only the public image URLs already authorized by the API. Downloads
// start together and reuse the existing signature cache; no data/auth is cached.
// Callers prefetch without awaiting: a slow image must never hold up a view.
// Failures and slow images release only their preparation entry within eight seconds.
// A cancelled view stops waiting without cancelling another view's shared image.
export async function prepareMediaUrls(
  values: (string | null | undefined)[],
  {
    signal,
    priority = "high",
  }: {
    signal?: AbortSignal;
    priority?: "high" | "low";
  } = {},
) {
  if (signal?.aborted || typeof Image === "undefined") return;
  const downloads = Promise.all(
    [...new Set(values.filter((value): value is string => Boolean(value)))].map(
      (value) => prepare(value, priority),
    ),
  );
  if (!signal) {
    await downloads;
    return;
  }
  let cancel!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    cancel = resolve;
  });
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await Promise.race([downloads, cancelled]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
