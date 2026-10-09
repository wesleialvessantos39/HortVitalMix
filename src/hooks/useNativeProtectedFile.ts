import { useEffect, useState } from "react";
import { fetchApiFile } from "../lib/api";
import { isNativeApp } from "../lib/nativeTransport";

export function useNativeProtectedFile(url: string) {
  const native = isNativeApp() && Boolean(url) && !url.startsWith("blob:");
  const [preview, setPreview] = useState({ source: "", url: "", error: false });
  useEffect(() => {
    if (!native) return;
    const controller = new AbortController();
    let active = true;
    let objectUrl = "";
    void fetchApiFile(url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("DOCUMENT_NOT_AVAILABLE");
      const blob = await response.blob();
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setPreview({ source: url, url: objectUrl, error: false });
    }).catch(() => {
      if (active) setPreview({ source: url, url: "", error: true });
    });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, native]);
  return !native ? { url, loading: false, error: false } : {
    url: preview.source === url ? preview.url : "",
    loading: preview.source !== url,
    error: preview.source === url && preview.error,
  };
}
