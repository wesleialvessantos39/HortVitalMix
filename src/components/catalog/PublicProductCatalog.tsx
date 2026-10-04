import { useEffect, useState } from "react";
import { Leaf, Salad } from "lucide-react";
import { api } from "../../lib/api";
import {
  PublicProductsResponseSchema,
  PACKAGING_LABELS,
  UNIT_LABELS,
  formatProductPrice,
  type PublicProduct,
} from "../../../shared/contracts/product";
import "../../pages/producer/products.css";

export function PublicProductCatalog({
  storeSlug,
  categoryId,
  search,
  onNavigate,
  emptyTitle = "Nenhum produto disponível agora",
}: {
  storeSlug?: string;
  categoryId?: string | null;
  search?: string;
  onNavigate: (path: string) => void;
  emptyTitle?: string;
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
  if (loading)
    return (
      <p className="hvm-product-notice" role="status">
        Carregando os alimentos…
      </p>
    );
  if (error)
    return (
      <div className="hvm-product-notice hvm-product-error" role="alert">
        <p>Não foi possível carregar os produtos.</p>
        <button className="secondary" onClick={() => setAttempt((a) => a + 1)}>
          Tentar novamente
        </button>
      </div>
    );
  if (!products.length)
    return (
      <div className="hvm-product-empty">
        <Salad size={36} />
        <h3>{emptyTitle}</h3>
        <p>
          {search
            ? `Nenhum alimento encontrado para “${search}”.`
            : "Volte em breve para conhecer os alimentos preparados pelos produtores."}
        </p>
      </div>
    );
  return (
    <div className="hvm-product-grid" aria-label="Catálogo de alimentos">
      {products.map((product) => {
        const primary = product.media.find((m) => m.isPrimary);
        return (
          <article className="hvm-product-card" key={product.id}>
            <div className="hvm-product-photo">
              {primary ? (
                <img src={primary.url} alt={product.title} loading="lazy" />
              ) : (
                <Leaf size={40} />
              )}
            </div>
            <div className="hvm-product-card-body">
              <small>{product.categoryName}</small>
              <h3>{product.title}</h3>
              <p>
                {PACKAGING_LABELS[product.packagingType]} ·{" "}
                {product.netWeightGrams} g
              </p>
              <strong className="hvm-product-price">
                {formatProductPrice(product.currentPrice.priceCents)}{" "}
                <small>/ {UNIT_LABELS[product.unitType]}</small>
              </strong>
              <details>
                <summary>Preparo e conservação</summary>
                <p>{product.description}</p>
                <p>Validade: {product.shelfLifeDays} dias.</p>
                <p>{product.conservationNotes}</p>
              </details>
              {!storeSlug && (
                <button
                  className="text-button"
                  onClick={() =>
                    onNavigate(
                      `/produtores/${encodeURIComponent(product.storeSlug)}`,
                    )
                  }
                >
                  Conheça {product.storeName}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
