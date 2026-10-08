import { useEffect, useRef, useState, type FormEvent } from "react";
import { ImagePlus, Layers, Package, Trash2 } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import { optimizeImage } from "../../lib/optimizeImage";
import { MediaImage } from "../../components/catalog/MediaImage";
import { cryptoRandomUUID as uuid } from "../../lib/uuid";
import {
  ProducerCatalogResponseSchema,
  type Product,
} from "../../../shared/contracts/product";
import {
  StoreCoverSettingsSchema,
  StoreOwnerResponseSchema,
  type StoreOwner,
} from "../../../shared/contracts/producerStore";
import { MediaCarousel } from "../../components/catalog/MediaCarousel";
import { ProducerPortrait } from "../../components/catalog/ProductSlideCaption";
import { storeCoverSlides } from "../../components/catalog/storeCoverSlides";
import "../../components/catalog/storefrontMedia.css";
import "./storeMediaSettings.css";

export function StoreMediaSettings({
  store,
  disabled,
  onUpdated,
  onRecentAuth,
  onReload,
  onBusyChange,
}: {
  store: StoreOwner;
  disabled: boolean;
  onUpdated: (store: StoreOwner) => void;
  onRecentAuth: (retry: () => Promise<void>) => void;
  onReload: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState(store.coverMode),
    [name, setName] = useState(store.publicProducerName ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false),
    [products, setProducts] = useState<Product[]>([]),
    [productError, setProductError] = useState(false),
    [productAttempt, setProductAttempt] = useState(0);
  const current = useRef(store);
  current.current = store;
  const pending = useRef(false),
    commands = useRef(new Map<string, string>());
  const savedSettings = useRef(
    `${store.coverMode}|${store.publicProducerName ?? ""}`,
  );
  useEffect(() => {
    const signature = `${store.coverMode}|${store.publicProducerName ?? ""}`;
    if (signature !== savedSettings.current) {
      setMode(store.coverMode);
      setName(store.publicProducerName ?? "");
      savedSettings.current = signature;
    }
    setConflict(false);
  }, [store.coverMode, store.publicProducerName, store.revision]);
  useEffect(() => {
    const abort = new AbortController();
    let inFlight = false;
    async function load() {
      if (inFlight || abort.signal.aborted) return;
      inFlight = true;
      try {
        const result = ProducerCatalogResponseSchema.parse(
          await api("/v1/producer/products", { signal: abort.signal }),
        );
        if (!abort.signal.aborted) {
          setProducts(result.products.filter((p) => p.isPublished));
          setProductError(false);
        }
      } catch {
        if (!abort.signal.aborted) {
          setProducts([]);
          setProductError(true);
        }
      } finally {
        inFlight = false;
      }
    }
    void load();
    const refresh = () => {
      if (document.visibilityState !== "hidden") void load();
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => {
      abort.abort();
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [store.id, productAttempt]);
  function command(key: string) {
    if (!commands.current.has(key)) commands.current.set(key, uuid());
    return commands.current.get(key)!;
  }
  async function run(operation: () => Promise<StoreOwner>, message: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setNotice("");
    try {
      const saved = await operation();
      current.current = saved;
      onUpdated(saved);
      commands.current.clear();
      setNotice(message);
    } catch (failure) {
      const fault = failure as ApiFailure;
      if (fault.message === "RECENT_AUTH_REQUIRED") {
        onRecentAuth(() => run(operation, message));
      } else {
        setError(
          fault.message === "STORE_REVISION_CONFLICT"
            ? "A loja mudou em outro dispositivo. Recarregue antes de tentar novamente."
            : fault.message === "STORE_MEDIA_LIMIT"
              ? "A capa aceita até seis fotos. Remova uma antes de adicionar outra."
              : fault.message === "STORE_COMMAND_CONFLICT"
                ? "Esta tentativa mudou. Recarregue a loja antes de continuar."
                : fault.message === "STORE_IMAGE_INVALID"
                  ? "A imagem não pôde ser validada. Escolha uma foto JPEG, PNG ou WebP."
                  : fault.status
                    ? "Não foi possível salvar agora. Tente novamente."
                    : fault.message || "Não foi possível preparar a imagem.",
        );
        setConflict(
          fault.message === "STORE_REVISION_CONFLICT" ||
            fault.message === "STORE_COMMAND_CONFLICT",
        );
      }
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const input = StoreCoverSettingsSchema.safeParse({
      coverMode: mode,
      publicProducerName: name.trim() || null,
      expectedRevision: current.current.revision,
      commandId: command(
        `settings:${current.current.revision}:${mode}:${name.trim()}`,
      ),
    });
    if (!input.success) {
      setError(
        "Informe um nome público com pelo menos duas letras, ou deixe o campo vazio.",
      );
      return;
    }
    await run(
      async () =>
        StoreOwnerResponseSchema.parse(
          (
            await api<{ store: unknown }>(
              `/v1/producer/store/${store.id}/cover?media=1`,
              { method: "POST", body: JSON.stringify(input.data) },
            )
          ).store,
        ),
      "Nome público e capa salvos.",
    );
  }
  function upload(file: File, purpose: "avatar" | "cover") {
    const revision = current.current.revision;
    const id = command(
      `upload:${revision}:${purpose}:${file.name}:${file.size}:${file.lastModified}`,
    );
    return run(
      async () => {
        const image = await optimizeImage(file);
        const params = new URLSearchParams({
          media: "1",
          purpose,
          commandId: id,
          expectedRevision: String(revision),
        });
        return StoreOwnerResponseSchema.parse(
          (
            await api<{ store: unknown }>(
              `/v1/producer/store/${store.id}/media/upload?${params}`,
              {
                method: "POST",
                headers: { "Content-Type": image.type },
                body: image,
              },
            )
          ).store,
        );
      },
      purpose === "avatar"
        ? "Foto do produtor atualizada."
        : "Foto adicionada à capa.",
    );
  }
  function remove(mediaId: string) {
    if (!window.confirm("Excluir esta foto da capa?")) return;
    const input = {
      mediaId,
      expectedRevision: current.current.revision,
      commandId: command(`remove:${current.current.revision}:${mediaId}`),
    };
    return run(
      async () =>
        StoreOwnerResponseSchema.parse(
          (
            await api<{ store: unknown }>(
              `/v1/producer/store/${store.id}/media/remove?media=1`,
              { method: "POST", body: JSON.stringify(input) },
            )
          ).store,
        ),
      "Foto removida da capa.",
    );
  }
  const blocked = disabled || busy || conflict;
  const slides = storeCoverSlides(
    { ...store, coverMode: mode, publicProducerName: name.trim() || null },
    store.storeName,
    store.storeSlug,
    products,
    false,
  );
  const dirty =
    mode !== store.coverMode ||
    (name.trim() || null) !== store.publicProducerName;
  return (
    <div className="hvm-store-media-settings">
      <div className="hvm-store-media-editor">
        <form onSubmit={save}>
          <fieldset disabled={blocked}>
            <legend>Identidade e capa da vitrine</legend>
            <p>Mostre quem cultiva e escolha como sua loja será apresentada.</p>
            <label>
              Nome público do produtor
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNotice("");
                }}
                maxLength={128}
                placeholder={store.storeName}
                autoComplete="nickname"
              />
            </label>
            <small>
              Este nome será exibido aos visitantes. Se deixar vazio, usamos o
              nome da loja.
            </small>
            <div className="hvm-store-media-avatar">
              <ProducerPortrait
                publicPreview={false}
                url={store.avatarUrl}
                name={name || store.storeName}
              />
              <label className="secondary">
                <ImagePlus size={18} />{" "}
                {store.avatarUrl
                  ? "Trocar foto do produtor"
                  : "Adicionar foto do produtor"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Foto do produtor"
                  onChange={(event) => {
                    const f = event.target.files?.[0];
                    event.target.value = "";
                    if (f) void upload(f, "avatar");
                  }}
                />
              </label>
            </div>
            <fieldset className="hvm-cover-modes">
              <legend>O que aparece na capa?</legend>
              {(
                [
                  [
                    "images",
                    "Fotos enviadas",
                    "Suas paisagens, colheitas e sua produção.",
                    ImagePlus,
                  ],
                  [
                    "products",
                    "Produtos da loja",
                    "Fotos, preços e sua identidade em cada slide.",
                    Package,
                  ],
                  [
                    "mixed",
                    "Fotos e produtos",
                    "Alterne suas imagens e alimentos publicados.",
                    Layers,
                  ],
                ] as const
              ).map(([value, title, description, Icon]) => (
                <label key={value} className={mode === value ? "selected" : ""}>
                  <input
                    type="radio"
                    name="cover-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => {
                      setMode(value);
                      setNotice("");
                    }}
                  />
                  <Icon size={22} />
                  <span>
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <button className="primary" type="submit" disabled={!dirty}>
              {busy ? "Salvando…" : "Salvar capa e identidade"}
            </button>
          </fieldset>
        </form>
        <section
          className="hvm-store-cover-uploads"
          aria-label="Fotos enviadas para a capa"
        >
          <div>
            <h3>Suas fotos de capa</h3>
            <small>{store.coverImages.length} de 6 fotos</small>
          </div>
          <p>
            JPEG, PNG ou WebP de até 15 MB. Otimizamos a imagem antes de salvar.
          </p>
          <label
            className={`secondary hvm-cover-upload ${blocked || store.coverImages.length >= 6 ? "disabled" : ""}`}
          >
            <ImagePlus size={18} /> Adicionar foto de capa
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Adicionar foto de capa"
              disabled={blocked || store.coverImages.length >= 6}
              onChange={(event) => {
                const f = event.target.files?.[0];
                event.target.value = "";
                if (f) void upload(f, "cover");
              }}
            />
          </label>
          <div className="hvm-cover-thumbnails">
            {store.coverImages.map((image, index) => (
              <figure key={image.id}>
                <MediaImage
                  publicPreview={false}
                  src={image.url}
                  alt={`Foto de capa ${index + 1}`}
                  loading="lazy"
                  decoding="async"
                />
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Excluir foto de capa ${index + 1}`}
                  disabled={blocked}
                  onClick={() => void remove(image.id)}
                >
                  <Trash2 size={16} /> Excluir
                </button>
              </figure>
            ))}
          </div>
          {!store.coverImages.length && (
            <small>
              Adicione suas fotos ou escolha os produtos publicados para
              preencher a capa.
            </small>
          )}
        </section>
        {busy && (
          <p role="status" className="account-notice">
            Preparando e salvando…
          </p>
        )}
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="account-notice">
            {notice}
          </p>
        )}
        {conflict && (
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              setBusy(true);
              onBusyChange(true);
              try {
                await onReload();
                commands.current.clear();
                setConflict(false);
                setError("");
              } finally {
                setBusy(false);
                onBusyChange(false);
              }
            }}
          >
            Recarregar loja
          </button>
        )}
      </div>
      <section className="hvm-store-cover-preview" aria-label="Prévia da capa">
        <span className="eyebrow">Prévia da sua vitrine</span>
        {slides.length ? (
          <MediaCarousel
            publicPreview={false}
            className="hvm-store-cover"
            slides={slides.map(({ href: _href, ...slide }) => slide)}
            label="Prévia da capa da loja"
          />
        ) : (
          <div className="hvm-store-media-empty">
            <ImagePlus size={40} />
            <strong>A sua capa começa aqui</strong>
            <p>
              {mode === "products"
                ? "Publique produtos com fotos para preencher a capa."
                : "Envie uma foto para ver sua vitrine ganhar vida."}
            </p>
          </div>
        )}
        <p>Os visitantes veem a capa salva na vitrine pública.</p>
        {productError && mode !== "images" && (
          <div role="alert">
            <p>Não foi possível carregar os produtos para a prévia.</p>
            <button
              type="button"
              className="secondary"
              onClick={() => setProductAttempt((a) => a + 1)}
            >
              Recarregar produtos
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
