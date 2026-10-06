import { useEffect, useState, useCallback } from "react";
import { api } from "../../lib/api";
import { prepareMediaUrls } from "../../lib/prepareMedia";
import {
  PublicProductsResponseSchema,
  type PublicProduct,
} from "../../../shared/contracts/product";
export function usePublicProducts({
  storeSlug,
  categoryId,
  search,
}: {
  storeSlug?: string;
  categoryId?: string | null;
  search?: string;
}) {
  const [products, setProducts] = useState<PublicProduct[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const params = new URLSearchParams();
    if (storeSlug) params.set("storeSlug", storeSlug);
    if (categoryId) params.set("categoryId", categoryId);
    if (search?.trim()) params.set("search", search.trim().slice(0, 100));
    async function load(initial = false) {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      if (initial) {
        setLoading(true);
        setError(false);
      }
      try {
        const result = PublicProductsResponseSchema.parse(
          await api(`/v1/products?${params}`, { signal: controller.signal }),
        );
        if (initial)
          void prepareMediaUrls(
            result.products
              .slice(0, 3)
              .map(
                (product) =>
                  product.media.find((media) => media.isPrimary)?.url ??
                  product.media[0]?.url,
              ),
            { signal: controller.signal },
          );
        if (!controller.signal.aborted) {
          setProducts(result.products);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError(true);
          setProducts([]);
        }
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load(true);
    const refresh = () => {
      if (document.visibilityState !== "hidden") void load();
    };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [storeSlug, categoryId, search, attempt]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { products, loading, error, retry };
}
