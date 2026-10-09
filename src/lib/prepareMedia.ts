import {
  invalidateMediaUrl,
  mediaUrlCacheUntil,
  stableMediaUrl,
} from "./mediaCache";

const WAIT_MS = 8000;
import { mediaPreview, mediaPreviewWidth } from "./mediaPreview";
import { publicMediaSource } from "./publicMediaSource";
const MAX_ENTRIES = 24;
type Entry = {
  promise: Promise<void>;
  until: number;
  image?: HTMLImageElement;
};
const entries = new Map<string, Entry>();
function decodedBytes(image: HTMLImageElement) {
  if (!image.naturalWidth) return 0;
  // naturalWidth is density-corrected by srcset. Use the requested variant
  // width as an upper bound, including previews that were not enlarged.
  let width = image.naturalWidth;
  try {
    const url = new URL(image.currentSrc || image.src, location.href);
    const requested = Number(url.searchParams.get("width"));
    if (
      url.pathname.includes("/v1/public-media/") &&
      [320, 640, 1280].includes(requested)
    )
      width = Math.max(width, requested);
  } catch {
    /* Legacy URL keeps its full intrinsic dimensions. */
  }
  return width * width * (image.naturalHeight / image.naturalWidth) * 4;
}

function prepare(
  value: string,
  priority: "high" | "low",
  sizes?: string,
  publicPreview = true,
) {
  const approved = publicMediaSource(value);
  if (!approved) return Promise.resolve();
  const variant = publicPreview
    ? mediaPreview(approved, mediaPreviewWidth(sizes))
    : null;
  const src = variant ?? stableMediaUrl(approved);
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
    if (!loaded) delete entry.image;
    // Keep decoded previews within a phone-friendly 16 MiB budget.
    if (loaded) {
      let bytes = 0;
      for (const e of entries.values())
        if (e.image?.complete) bytes += decodedBytes(e.image);
      for (const e of entries.values()) {
        if (bytes <= 16 * 1024 * 1024) break;
        if (e.image?.complete) {
          bytes -= decodedBytes(e.image);
          delete e.image;
        }
      }
    }
    const until = loaded
      ? variant
        ? Date.now() + 300000
        : mediaUrlCacheUntil(src)
      : 0;
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
  if (variant) {
    image.srcset = [320, 640, 1280]
      .map((w) => `${mediaPreview(approved, w as 320 | 640 | 1280)} ${w}w`)
      .join(", ");
    image.sizes = sizes ?? "(max-width: 600px) 100vw, 480px";
  }
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
    sizes,
    publicPreview = true,
  }: {
    signal?: AbortSignal;
    priority?: "high" | "low";
    sizes?: string;
    publicPreview?: boolean;
  } = {},
) {
  if (signal?.aborted || typeof Image === "undefined") return;
  const downloads = Promise.all(
    [...new Set(values.filter((value): value is string => Boolean(value)))].map(
      (value) => prepare(value, priority, sizes, publicPreview),
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

if (typeof window !== "undefined")
  window.addEventListener("hvm:session-cleared", () => entries.clear());
