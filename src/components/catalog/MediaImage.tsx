import {
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
} from "react";
import { mediaPreview, mediaPreviewWidth } from "../../lib/mediaPreview";
import { stableMediaUrl, invalidateMediaUrl } from "../../lib/mediaCache";

export function MediaImage({
  src,
  priority = false,
  loading,
  onError,
  onLoad,
  onReady,
  sizes = "(max-width: 600px) 100vw, 480px",
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  priority?: boolean;
  onReady?: () => void;
}) {
  const preferred = useMemo(() => stableMediaUrl(src), [src]),
    [retry, setRetry] = useState<string | null>(null),
    [near, setNear] = useState(priority),
    node = useRef<HTMLImageElement>(null);
  const variant = mediaPreview(src, mediaPreviewWidth(sizes));
  const source = retry === src ? src : (variant ?? preferred);
  useLayoutEffect(() => {
    if (node.current?.complete && node.current.naturalWidth > 0) onReady?.();
  }, [source, onReady]);
  useEffect(() => {
    if (
      priority ||
      !node.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(node.current);
    return () => observer.disconnect();
  }, [priority]);
  return (
    <img
      {...props}
      ref={node}
      src={source}
      srcSet={
        variant && retry !== src
          ? [320, 640, 1280]
              .map((w) => `${mediaPreview(src, w as 320 | 640 | 1280)} ${w}w`)
              .join(", ")
          : undefined
      }
      sizes={sizes}
      onLoad={(event) => {
        onReady?.();
        onLoad?.(event);
      }}
      loading={loading ?? (near || priority ? "eager" : "lazy")}
      decoding="async"
      fetchPriority={
        props.fetchPriority ?? (priority || near ? "high" : "auto")
      }
      onError={(event) => {
        if (source !== src) {
          invalidateMediaUrl(src);
          setRetry(src);
          return;
        }
        invalidateMediaUrl(src);
        onError?.(event);
      }}
    />
  );
}
