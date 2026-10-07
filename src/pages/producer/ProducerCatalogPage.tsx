import { useCallback, useEffect, useState } from "react";
import { MediaImage } from "../../components/catalog/MediaImage";
import { ArrowLeft, Plus, Salad, Pencil, Store } from "lucide-react";
import { producerRead } from "../../lib/offlineDb";
import type { ShellSession } from "../../hooks/useSession";
import {
  ProducerCatalogResponseSchema,
  formatProductPrice,
  type ProducerCatalog,
} from "../../../shared/contracts/product";
import {
  ProductCommandFeedback,
  productErrorMessage,
  useProductCommands,
} from "./ProductCommandFeedback";
import "./products.css";

export default function ProducerCatalogPage({
  session,
  onNavigate,
}: {
  session: ShellSession;
  onNavigate: (path: string) => void;
}) {
  const [catalog, setCatalog] = useState<ProducerCatalog | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const commands = useProductCommands(session, (saved) =>
    setCatalog((current) =>
      current
        ? {
            ...current,
            products: current.products.map((p) =>
              p.id === saved.id ? saved : p,
            ),
          }
        : null,
    ),
  );
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const result = await producerRead(session.userId,"/v1/producer/products",ProducerCatalogResponseSchema,signal);
      if (!signal?.aborted) setCatalog(result);
    } catch (failure) {
      if (!signal?.aborted) setError(productErrorMessage(failure));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [session.userId]);
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [load, session.userId]);
  return (
    <section className="hvm-products">
      <button className="text-button" onClick={() => onNavigate("/conta")}>
        <ArrowLeft size={17} /> Minha conta
      </button>
      <header className="hvm-product-heading">
        <div>
          <span className="eyebrow">Da sua produção para a mesa</span>
          <h1>Meus produtos</h1>
          <p>Organize seu catálogo e acompanhe os preços de venda.</p>
        </div>
        <button
          className="primary"
          disabled={!catalog?.canCreate || loading}
          onClick={() => onNavigate("/produtor/produtos/novo")}
        >
          <Plus size={18} /> Novo produto
        </button>
      </header>
      {loading ? (
        <p role="status" className="hvm-product-notice">
          Carregando seus produtos…
        </p>
      ) : error ? (
        <div role="alert" className="hvm-product-notice hvm-product-error">
          <p>{error}</p>
          <button className="secondary" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      ) : (
        catalog && (
          <>
            {!catalog.canCreate && (
              <div className="hvm-product-notice">
                <p>
                  Ative sua loja e conclua a aprovação do imóvel para cadastrar
                  e publicar produtos.
                </p>
                <button
                  className="secondary"
                  onClick={() => onNavigate("/produtor/loja")}
                >
                  <Store size={17} /> Minha loja
                </button>
              </div>
            )}
            <ProductCommandFeedback
              commands={commands}
              onReload={() => {
                commands.clear();
                void load();
              }}
            />
            {!catalog.products.length ? (
              <div className="hvm-product-empty">
                <Salad size={40} />
                <h2>Seu catálogo começa aqui</h2>
                <p>
                  Cadastre alimentos higienizados, informe a embalagem e defina
                  seu primeiro preço.
                </p>
              </div>
            ) : (
              <div className="hvm-product-grid">
                {catalog.products.map((product,index) => {
                  const primary = product.media.find((m) => m.isPrimary);
                  return (
                    <article className="hvm-product-card" key={product.id}>
                      <div className="hvm-product-photo">
                        {primary ? (
                          <MediaImage
                            src={primary.url}
                            alt={product.title}
                            priority={index<3}
                          />
                        ) : (
                          <Salad size={48} />
                        )}
                      </div>
                      <div className="hvm-product-card-body">
                        <span
                          className={`hvm-product-badge ${product.isPublished ? "published" : ""}`}
                        >
                          {product.isPublished ? "Publicado" : "Rascunho"}
                        </span>
                        <small>{product.categoryName}</small>
                        <h2>{product.title}</h2>
                        <p>
                          {product.netWeightGrams} g · Validade:{" "}
                          {product.shelfLifeDays} dias
                        </p>
                        <strong className="hvm-product-price">
                          {formatProductPrice(product.currentPrice.priceCents)}
                        </strong>
                        <div className="hvm-product-actions">
                          <button
                            className="secondary"
                            onClick={() =>
                              onNavigate(
                                `/produtor/produtos/${product.id}/editar`,
                              )
                            }
                          >
                            <Pencil size={16} /> Editar produto
                          </button>
                          <button className="secondary" onClick={() => onNavigate(`/produtor/produtos/${product.id}/lotes`)}>Lotes e colheitas</button>
                          <button
                            className="text-button"
                            disabled={
                              commands.busy ||
                              commands.reauth ||
                              commands.conflict ||
                              (!catalog.canCreate && !product.isPublished)
                            }
                            onClick={() => {
                              const body = {
                                expectedRevision: product.revision,
                                isPublished: !product.isPublished,
                              };
                              void commands.execute(
                                `/v1/producer/products/${product.id}/publish`,
                                {
                                  ...body,
                                  commandId: commands.command({
                                    id: product.id,
                                    ...body,
                                  }),
                                },
                                product.isPublished
                                  ? "Produto despublicado."
                                  : "Produto publicado na sua vitrine.",
                              );
                            }}
                          >
                            {product.isPublished ? "Despublicar" : "Publicar"}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
