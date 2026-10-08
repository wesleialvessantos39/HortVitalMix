import { useCallback, useEffect, useRef, useState } from "react";
import { Sprout } from "lucide-react";
import { PageLoading } from "../PageLoading";
import { api } from "../../lib/api";
import { prepareMediaUrls } from "../../lib/prepareMedia";
import {
  HighlightsResponseSchema,
  type HighlightProduct,
} from "../../../shared/contracts/highlights";
import { MediaCarousel } from "./MediaCarousel";
import { ProductSlideCaption } from "./ProductSlideCaption";
import "./storefrontMedia.css";

export default function RegionalHighlights({
  municipalityId,
  regionLabel,
  blocked,
  onNavigate,
}: {
  municipalityId?: string;
  regionLabel: string | null;
  blocked: boolean;
  onNavigate: (path: string) => void;
}) {
  const [products, setProducts] = useState<HighlightProduct[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0),
    [pagination, setPagination] = useState({ page: 1, hasMore: false });
  const read = useRef<((page: number) => Promise<void>) | null>(null);
  const current = useRef(pagination);
  current.current = pagination;
  useEffect(() => {
    const abort = new AbortController();
    let inFlight: Promise<void> | null = null;
    setProducts([]);
    setLoading(!blocked);
    setError(false);
    setPagination({ page: 1, hasMore: false });
    if (blocked) return () => abort.abort();
    async function load(page: number) {
      if (inFlight) await inFlight;
      if (abort.signal.aborted) return;
      const params = new URLSearchParams({ page: String(page) });
      if (municipalityId) params.set("municipalityId", municipalityId);
      const task = (async () => {
        try {
          const result = HighlightsResponseSchema.parse(
            await api(`/v1/discovery/highlights?${params}`, {
              signal: AbortSignal.any([
                abort.signal,
                AbortSignal.timeout(15000),
              ]),
            }),
          );
          const first = result.products[0];
          void prepareMediaUrls(
            [
              first?.media.find((media) => media.isPrimary)?.url ??
                first?.media[0]?.url,
            ],
            { signal: abort.signal, sizes:"100vw" },
          );
          void prepareMediaUrls([first?.producerAvatarUrl],{signal:abort.signal,sizes:"52px"});
          if (!abort.signal.aborted) {
            setProducts(result.products);
            setPagination({ page: result.page, hasMore: result.hasMore });
            setError(false);
          }
        } catch (failure) {
          if (!abort.signal.aborted) {
            setProducts([]);
            setError(true);
          }
          throw failure;
        } finally {
          if (!abort.signal.aborted) setLoading(false);
        }
      })();
      inFlight = task;
      try {
        await task;
      } finally {
        if (inFlight === task) inFlight = null;
      }
    }
    read.current = load;
    void load(1).catch(() => {});
    const refresh = () => {
      if (document.visibilityState !== "hidden" && !inFlight)
        void load(current.current.page).catch(() => {});
    };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      abort.abort();
      read.current = null;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [municipalityId, blocked, attempt]);
  const nextPage = useCallback(async () => {
    const p = current.current;
    await read.current?.(p.hasMore ? p.page + 1 : 1);
  }, []);
  return (
    <div className="hvm-regional-highlight">
      <div className="hvm-highlight-heading">
        <span>Tudo da sua região</span>
        <small>{regionLabel ?? "Todas as regiões"}</small>
      </div>
      {products.length ? (
        <MediaCarousel imageSizes="100vw"
          priority
          label="Produtos da região"
          onNavigate={onNavigate}
          onEnd={
            pagination.hasMore || pagination.page > 1 ? nextPage : undefined
          }
          slides={products.map((product) => ({
            id: product.id,
            imageUrl:
              product.media.find((m) => m.isPrimary)?.url ??
              product.media[0]?.url ??
              null,
            alt: `${product.title}, ${product.storeName}, ${product.municipality}`,
            href: `/produtores/${encodeURIComponent(product.storeSlug)}`,
            caption: (
              <ProductSlideCaption
                product={product}
                producerName={product.producerName}
                avatarUrl={product.producerAvatarUrl}
                storeName={product.storeName}
                region={product.municipality}
              />
            ),
          }))}
        />
      ) : loading ? (
        <PageLoading label="Preparando os destaques…" compact />
      ) : (
        <div
          className="hvm-highlight-empty"
          role={error ? "alert" : undefined}
        >
          <Sprout size={36} />
          <strong>
            {error
              ? "Não foi possível carregar os destaques"
              : blocked
                ? "Região indisponível"
                : "O próximo frescor vem do campo"}
          </strong>
          <p>
            {!error &&
              (blocked
                ? "Selecione uma região atendida para conhecer os produtos."
                : "Assim que os produtores publicarem alimentos nesta região, eles aparecerão aqui.")}
          </p>
          {error && (
            <button
              type="button"
              className="secondary"
              onClick={() => setAttempt((a) => a + 1)}
            >
              Tentar novamente
            </button>
          )}
        </div>
      )}
    </div>
  );
}
