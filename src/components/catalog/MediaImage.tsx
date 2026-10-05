import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ImgHTMLAttributes,
} from "react";
import { stableMediaUrl, invalidateMediaUrl } from "../../lib/mediaCache";

export function MediaImage({
  src,
  priority = false,
  loading,
  onError,
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  priority?: boolean;
}) {
  const preferred = useMemo(() => stableMediaUrl(src), [src]),
    [retry, setRetry] = useState<string | null>(null),
    [near, setNear] = useState(priority),
    node = useRef<HTMLImageElement>(null);
  const source = retry === src ? src : preferred;
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
