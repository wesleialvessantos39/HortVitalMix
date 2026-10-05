import { Leaf, Salad } from "lucide-react";
import {
  PACKAGING_LABELS,
  UNIT_LABELS,
  formatProductPrice,
  type PublicProduct,
} from "../../../shared/contracts/product";
import "../../pages/producer/products.css";
import { usePublicProducts } from "./usePublicProducts";
import { MediaCarousel } from "./MediaCarousel";

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
  const catalog = usePublicProducts({ storeSlug, categoryId, search });
  return (
    <PublicProductGrid
      {...catalog}
      storeSlug={storeSlug}
      search={search}
      onNavigate={onNavigate}
      emptyTitle={emptyTitle}
    />
  );
}

export function PublicProductGrid({
  products,
  loading,
  error,
  retry,
  storeSlug,
  search,
  onNavigate,
  emptyTitle = "Nenhum produto disponível agora",
}: {
  products: PublicProduct[];
  loading: boolean;
  error: boolean;
  retry: () => void;
  storeSlug?: string;
  search?: string;
  onNavigate: (path: string) => void;
  emptyTitle?: string;
}) {
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
        <button className="secondary" onClick={retry}>
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
      {products.map((product, index) => {
        const media = [...product.media].sort(
          (a, b) =>
            Number(b.isPrimary) - Number(a.isPrimary) ||
            a.displayOrder - b.displayOrder,
        );
        return (
          <article className="hvm-product-card" key={product.id}>
            <div className="hvm-product-photo">
              {media.length ? (
                <MediaCarousel
                  slides={media.map((m) => ({
                    id: m.id,
                    imageUrl: m.url,
                    alt: product.title,
                    href: storeSlug
                      ? undefined
                      : `/produtores/${encodeURIComponent(product.storeSlug)}`,
                  }))}
                  label={`Fotos de ${product.title}`}
                  onNavigate={onNavigate}
                  priority={index < 3}
                />
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
              <span
                className={`hvm-product-badge ${product.inStock ? "published" : ""}`}
                aria-label="Disponibilidade"
              >
                {product.inStock ? "Em estoque" : "Esgotado"}
              </span>
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
