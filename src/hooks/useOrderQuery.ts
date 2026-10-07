import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import { api, type ApiFailure } from "../lib/api";
import { orderMessage } from "../lib/orders";

/** Sequential polling while visible; aborts on logout, route change and unmount. */
export function useOrderQuery<T>(
  path: string,
  userId: string | null,
  schema: z.ZodType<T>,
) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    setData(null);
    setError("");
  }, [path, userId]);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined,
      loading = false,
      stopped = false;
    const visibleNow = () => document.visibilityState !== "hidden";
    async function load() {
      if (
        loading ||
        stopped ||
        controller.signal.aborted ||
        document.visibilityState === "hidden"
      )
        return;
      clearTimeout(timer);
      loading = true;
      try {
        const value = schema.parse(
          await api<unknown>(path, {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(20000),
            ]),
          }),
        );
        if (controller.signal.aborted) return;
        setData(value);
        setError("");
        const status = (value as { status?: string }).status;
        stopped = status === "delivered" || status === "cancelled";
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(orderMessage(e));
        if ([401, 403, 404].includes((e as ApiFailure).status ?? 0)) {
          setData(null);
          stopped = true;
        }
      } finally {
        loading = false;
        if (!stopped && !controller.signal.aborted && visibleNow())
          timer = setTimeout(() => void load(), 15000);
      }
    }
    const visible = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") void load();
    };
    void load();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [path, userId, schema, version]);
  return { data, error, refresh };
}
