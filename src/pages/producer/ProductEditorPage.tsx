import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ArrowLeft, ImagePlus, Leaf } from "lucide-react";
import { api } from "../../lib/api";
import { optimizeImage } from "../../lib/optimizeImage";
import { MediaImage } from "../../components/catalog/MediaImage";
import type { ShellSession } from "../../hooks/useSession";
import {
  PublicCategoriesResponseSchema,
  flattenCategories,
  type Category,
} from "../../../shared/contracts/category";
import {
  CreateProductSchema,
  UpdateProductSchema,
  ProductMutationResponseSchema,
  PACKAGING_LABELS,
  UNIT_LABELS,
  formatProductPrice,
  productPriceToCents,
  type Product,
} from "../../../shared/contracts/product";
import {
  ProductCommandFeedback,
  useProductCommands,
  productErrorMessage,
} from "./ProductCommandFeedback";
import "./products.css";

type Draft = {
  categoryId: string;
  title: string;
  description: string;
  packagingType: Product["packagingType"];
  netWeightGrams: string;
  unitType: Product["unitType"];
  shelfLifeDays: string;
  conservationNotes: string;
};
const empty: Draft = {
  categoryId: "",
  title: "",
  description: "",
  packagingType: "pote_higienizado",
  netWeightGrams: "",
  unitType: "pote",
  shelfLifeDays: "5",
  conservationNotes: "Manter refrigerado entre 2°C e 6°C",
};
function draftFrom(p: Product): Draft {
  return {
    categoryId: p.categoryId,
    title: p.title,
    description: p.description,
    packagingType: p.packagingType,
    netWeightGrams: String(p.netWeightGrams),
    unitType: p.unitType,
    shelfLifeDays: String(p.shelfLifeDays),
    conservationNotes: p.conservationNotes,
  };
}
const priceText = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
export default function ProductEditorPage({
  id,
  session,
  onNavigate,
}: {
  id?: string;
  session: ShellSession;
  onNavigate: (path: string) => void;
}) {
  const [product, setProduct] = useState<Product | null>(null),
    [draft, setDraft] = useState<Draft>(empty),
    [categories, setCategories] = useState<Category[]>([]);
  const [price, setPrice] = useState(""),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [fileInputKey, setFileInputKey] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const preparation = useRef(false);
  const commands = useProductCommands(session, (saved) => {
    setProduct(saved);
    if (!id) onNavigate(`/produtor/produtos/${saved.id}/editar?criado=1`);
    setFile(null);
    setFileInputKey((k) => k + 1);
  });
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError("");
      try {
        const [categoryResult, productResult] = await Promise.all([
          api("/v1/categories", { signal }),
          id
            ? api(`/v1/producer/products/${id}`, { signal })
            : Promise.resolve(null),
        ]);
        if (signal?.aborted) return;
        setCategories(
          flattenCategories(
            PublicCategoriesResponseSchema.parse(categoryResult).categories,
          ),
        );
        if (productResult) {
          const saved =
            ProductMutationResponseSchema.parse(productResult).product;
          setProduct(saved);
          setDraft(draftFrom(saved));
          setPrice(priceText(saved.currentPrice.priceCents));
        }
      } catch (error) {
        if (!signal?.aborted) setLoadError(productErrorMessage(error));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [id],
  );
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [load, session.userId]);
  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    const fields = {
      ...draft,
      netWeightGrams: Number(draft.netWeightGrams),
      shelfLifeDays: Number(draft.shelfLifeDays),
    };
    const body = product
      ? { ...fields, expectedRevision: product.revision }
      : { ...fields, priceCents: productPriceToCents(price) };
    const payload = {
      ...body,
      commandId: commands.command({ action: "details", ...body }),
    };
    const parsed = product
      ? UpdateProductSchema.safeParse(payload)
      : CreateProductSchema.safeParse(payload);
    if (!parsed.success) {
      commands.invalid(
        "Revise categoria, nome, descrição, peso, validade e preço. Peso e preço devem ser positivos.",
      );
      return;
    }
    await commands.execute(
      product ? `/v1/producer/products/${product.id}` : "/v1/producer/products",
      parsed.data,
      product
        ? "Informações do produto salvas."
        : "Rascunho criado. Adicione uma foto para publicar.",
      product ? "PATCH" : "POST",
    );
  }
  async function savePrice(event: FormEvent) {
    event.preventDefault();
    if (!product) return;
    const cents = productPriceToCents(price);
    if (cents === null) {
      commands.invalid(
        "Informe um preço positivo em reais, com até duas casas decimais.",
      );
      return;
    }
    const body = { expectedRevision: product.revision, newPriceCents: cents };
    await commands.execute(
      `/v1/producer/products/${product.id}/price`,
      { ...body, commandId: commands.command({ action: "price", ...body }) },
      "Novo preço salvo. As versões anteriores foram preservadas.",
    );
  }
  async function upload() {
    if (!file || !product || preparation.current) return;
    preparation.current = true;
    setPreparing(true);
    try {
      const image = await optimizeImage(file);
      const commandId = commands.command({
        action: "upload",
        revision: product.revision,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      });
      await commands.execute(
        `/v1/producer/products/${product.id}/media/upload?commandId=${commandId}&expectedRevision=${product.revision}`,
        null,
        "Foto adicionada ao produto.",
        "POST",
        image,
      );
    } catch (error) {
      commands.invalid(
        (error as Error).message || "Não foi possível preparar a foto.",
      );
    } finally {
      preparation.current = false;
      setPreparing(false);
    }
  }
  const blocked =
    preparing || commands.busy || commands.reauth || commands.conflict;
  const detailsChanged = product
    ? JSON.stringify(draft) !== JSON.stringify(draftFrom(product))
    : true;
  const changedPrice =
    productPriceToCents(price) !== product?.currentPrice.priceCents;
  return (
    <section className="hvm-products hvm-product-editor">
      <button
        className="text-button"
        onClick={() => onNavigate("/produtor/produtos")}
      >
        <ArrowLeft size={17} /> Meus produtos
      </button>
      <header className="hvm-product-heading">
        <div>
          <span className="eyebrow">Alimentos preparados com cuidado</span>
          <h1>{id ? "Editar produto" : "Novo produto"}</h1>
          <p>Informe como seu alimento é preparado, embalado e conservado.</p>
        </div>
        <Leaf className="hvm-product-emblem" size={38} />
      </header>
      {loading ? (
        <p role="status" className="hvm-product-notice">
          Carregando o produto…
        </p>
      ) : loadError ? (
        <div role="alert" className="hvm-product-notice hvm-product-error">
          <p>{loadError}</p>
          <button className="secondary" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          {new URLSearchParams(location.search).get("criado") === "1" &&
            !commands.notice && (
              <p className="hvm-product-notice" role="status">
                Rascunho criado. Adicione uma foto principal para publicar.
              </p>
            )}
          <ProductCommandFeedback
            commands={commands}
            onReload={() => {
              commands.clear();
              void load();
            }}
          />
          <form className="hvm-product-panel" onSubmit={saveDetails}>
            <h2>Informações do alimento</h2>
            <fieldset disabled={blocked} className="hvm-product-fields">
              <label>
                Nome do produto
                <input
                  required
                  minLength={3}
                  maxLength={255}
                  value={draft.title}
                  onChange={(e) => patch("title", e.target.value)}
                  placeholder="Ex.: Couve picada e higienizada"
                />
              </label>
              <label>
                Categoria
                <select
                  required
                  value={draft.categoryId}
                  onChange={(e) => patch("categoryId", e.target.value)}
                >
                  <option value="">Escolha uma categoria</option>
                  {product &&
                    !categories.some((c) => c.id === product.categoryId) && (
                      <option value={product.categoryId} disabled>
                        {product.categoryName} (inativa)
                      </option>
                    )}
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="hvm-product-full">
                Descrição
                <textarea
                  required
                  minLength={10}
                  maxLength={2000}
                  rows={4}
                  value={draft.description}
                  onChange={(e) => patch("description", e.target.value)}
                  placeholder="Conte como o alimento é preparado e higienizado."
                />
              </label>
              <label>
                Tipo de embalagem
                <select
                  value={draft.packagingType}
                  onChange={(e) =>
                    patch(
                      "packagingType",
                      e.target.value as Draft["packagingType"],
                    )
                  }
                >
                  {Object.entries(PACKAGING_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Peso líquido (g)
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50000}
                  step={1}
                  required
                  value={draft.netWeightGrams}
                  onChange={(e) => patch("netWeightGrams", e.target.value)}
                />
              </label>
              <label>
                Unidade de venda
                <select
                  value={draft.unitType}
                  onChange={(e) =>
                    patch("unitType", e.target.value as Draft["unitType"])
                  }
                >
                  {Object.entries(UNIT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Validade (dias)
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={2147483647}
                  step={1}
                  required
                  value={draft.shelfLifeDays}
                  onChange={(e) => patch("shelfLifeDays", e.target.value)}
                />
              </label>
              <label className="hvm-product-full">
                Cuidados de conservação
                <input
                  required
                  maxLength={255}
                  value={draft.conservationNotes}
                  onChange={(e) => patch("conservationNotes", e.target.value)}
                />
              </label>
              {!product && (
                <label>
                  Preço inicial (R$)
                  <input
                    required
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="Ex.: 12,90"
                  />
                </label>
              )}
            </fieldset>
            <div className="hvm-product-actions">
              <button
                className="primary"
                disabled={blocked || !detailsChanged || !categories.length}
              >
                {commands.busy
                  ? "Salvando…"
                  : product
                    ? "Salvar informações"
                    : "Criar rascunho"}
              </button>
            </div>
          </form>
          {product && (
            <>
              <form className="hvm-product-panel" onSubmit={savePrice}>
                <h2>Preço de venda</h2>
                <p>
                  Preço vigente:{" "}
                  <strong>
                    {formatProductPrice(product.currentPrice.priceCents)}
                  </strong>
                  . Cada alteração guarda uma nova versão.
                </p>
                <label>
                  Novo preço (R$)
                  <input
                    inputMode="decimal"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    disabled={blocked}
                  />
                </label>
                <button className="primary" disabled={blocked || !changedPrice}>
                  Salvar novo preço
                </button>
              </form>
              <section
                className="hvm-product-panel"
                aria-label="Fotos do produto"
              >
                <h2>Fotos do produto</h2>
                <p>
                  A primeira foto é a principal. Use JPEG, PNG ou WebP, com até
                  2 MB por foto.
                </p>
                <div className="hvm-product-media-grid">
                  {product.media.map((media) => (
                    <div className="hvm-product-media" key={media.id}>
                      <MediaImage publicPreview={false} src={media.url} alt={`Foto de ${product.title}`} />
                      {media.isPrimary ? (
                        <span className="hvm-product-badge published">
                          Foto principal
                        </span>
                      ) : (
                        <button
                          className="secondary"
                          disabled={blocked}
                          onClick={() => {
                            const body = {
                              expectedRevision: product.revision,
                              mediaId: media.id,
                            };
                            void commands.execute(
                              `/v1/producer/products/${product.id}/media/primary`,
                              {
                                ...body,
                                commandId: commands.command({
                                  action: "primary",
                                  ...body,
                                }),
                              },
                              "Foto principal atualizada.",
                            );
                          }}
                        >
                          Usar como principal
                        </button>
                      )}
                      <button
                        className="text-button"
                        disabled={blocked}
                        onClick={() => {
                          const body = {
                            expectedRevision: product.revision,
                            mediaId: media.id,
                          };
                          void commands.execute(
                            `/v1/producer/products/${product.id}/media/remove`,
                            {
                              ...body,
                              commandId: commands.command({
                                action: "remove",
                                ...body,
                              }),
                            },
                            "Foto removida.",
                          );
                        }}
                      >
                        Remover foto
                      </button>
                    </div>
                  ))}
                </div>
                <label>
                  {preparing ? "Preparando foto…" : "Adicionar foto"}
                  <input
                    key={fileInputKey}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={blocked || product.media.length >= 6}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={blocked || !file}
                  onClick={() => void upload()}
                >
                  <ImagePlus size={17} /> Enviar foto
                </button>
              </section>
              <section className="hvm-product-panel">
                <h2>Publicação</h2>
                <p>
                  {product.isPublished
                    ? "Este produto está publicado na vitrine da sua loja."
                    : "Este produto é um rascunho. Adicione uma foto principal para deixá-lo pronto para publicação."}
                </p>
                <button
                  className={product.isPublished ? "secondary" : "primary"}
                  disabled={blocked}
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
                          action: "publish",
                          ...body,
                        }),
                      },
                      product.isPublished
                        ? "Produto despublicado."
                        : "Produto publicado na sua vitrine.",
                    );
                  }}
                >
                  {product.isPublished
                    ? "Despublicar produto"
                    : "Publicar produto"}
                </button>
              </section>
            </>
          )}
        </>
      )}
    </section>
  );
}
