import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Minus,
  Plus,
  Salad,
  ShoppingBasket,
  Store,
  Trash2,
} from "lucide-react";
import { type Cart, CUT_TYPE_LABELS } from "../../../shared/contracts/cart";
import { formatProductPrice } from "../../../shared/contracts/product";
import { loadCart, useCartMutation, cartErrorMessage } from "../../lib/cart";
import { MediaImage } from "../../components/catalog/MediaImage";
import "./cart.css";

export default function CartPage({
  signedIn,
  onNavigate,
}: {
  signedIn: boolean;
  onNavigate: (path: string) => void;
}) {
  const [cart, setCart] = useState<Cart | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const command = useCartMutation(setCart);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const next = await loadCart(signal);
      if (!signal?.aborted) setCart(next);
    } catch (failure) {
      if (!signal?.aborted) setError(cartErrorMessage(failure));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const locked = command.busy || command.uncertain;
  useEffect(() => {
    if (loading || locked || !cart) return;
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const next = await loadCart(controller.signal);
        if (!controller.signal.aborted) {
          setCart(next);
          setError("");
        }
      } catch {
        /* Keep the last confirmed basket during a background outage. */
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loading, locked, !!cart]);
  return (
    <section className="hvm-cart">
      <button
        type="button"
        className="text-button"
        onClick={() => onNavigate("/produtos")}
      >
        <ArrowLeft size={18} /> Continuar escolhendo
      </button>
      <header>
        <span className="eyebrow">Da nossa região para sua mesa</span>
        <h1>Minha cesta</h1>
        <p>Suas escolhas organizadas por produtor, com os preços atuais.</p>
      </header>
      {loading ? (
        <p role="status">Carregando sua cesta…</p>
      ) : error ? (
        <div className="hvm-cart-notice" role="alert">
          <p>{error}</p>
          <button className="secondary" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      ) : (
        cart && (
          <>
            {!cart.stores.length ? (
              <div className="hvm-cart-empty">
                <ShoppingBasket size={48} />
                <h2>Sua cesta está esperando o frescor</h2>
                <p>
                  Escolha alimentos ou combine porções no Monte seu HortiMix.
                </p>
                <button
                  className="primary"
                  onClick={() => onNavigate("/produtos")}
                >
                  Explorar produtos
                </button>
              </div>
            ) : (
              <div className="hvm-cart-layout">
                <div className="hvm-cart-stores">
                  {cart.stores.map((store, storeIndex) => (
                    <section
                      className="hvm-cart-store"
                      key={store.storeId}
                      aria-label={`Cesta de ${store.storeName}`}
                    >
                      <div className="hvm-cart-store-heading">
                        <Store size={23} />
                        <h2>{store.storeName}</h2>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            onNavigate(
                              `/produtores/${encodeURIComponent(store.storeSlug)}`,
                            )
                          }
                        >
                          Ver loja
                        </button>
                      </div>
                      {store.items.map((item, index) => (
                        <article className="hvm-cart-item" key={item.id}>
                          <div className="hvm-cart-photo">
                            {item.imageUrl ? (
                              <MediaImage
                                src={item.imageUrl}
                                alt={item.title}
                                priority={storeIndex === 0 && index < 3}
                              />
                            ) : (
                              <Salad size={30} />
                            )}
                          </div>
                          <div className="hvm-cart-item-info">
                            <h3>{item.title}</h3>
                            <p>
                              {item.netWeightGrams} g por porção
                              {item.cutType
                                ? ` · ${CUT_TYPE_LABELS[item.cutType]}`
                                : ""}
                            </p>
                            <strong>
                              {formatProductPrice(item.unitPriceCents)} / porção
                            </strong>
                            {!item.available && (
                              <p className="hvm-cart-unavailable">
                                Indisponível agora. Remova ou escolha outro
                                produto.
                              </p>
                            )}
                          </div>
                          <div className="hvm-cart-item-controls">
                            <div
                              className="hvm-cart-quantity"
                              role="group"
                              aria-label={`Quantidade de ${item.title}${item.cutType ? ` em ${CUT_TYPE_LABELS[item.cutType]}` : ""}`}
                            >
                              <button
                                type="button"
                                disabled={locked || item.quantity <= 1}
                                aria-label={`Diminuir ${item.title}`}
                                onClick={() =>
                                  void command.send(
                                    `/v1/cart/items/${item.id}`,
                                    {
                                      quantity: item.quantity - 1,
                                      commandId: crypto.randomUUID(),
                                    },
                                    "PATCH",
                                  )
                                }
                              >
                                <Minus size={16} />
                              </button>
                              <span aria-live="polite">{item.quantity}</span>
                              <button
                                type="button"
                                disabled={
                                  locked ||
                                  item.quantity >= 99 ||
                                  !item.available
                                }
                                aria-label={`Aumentar ${item.title}`}
                                onClick={() =>
                                  void command.send(
                                    `/v1/cart/items/${item.id}`,
                                    {
                                      quantity: item.quantity + 1,
                                      commandId: crypto.randomUUID(),
                                    },
                                    "PATCH",
                                  )
                                }
                              >
                                <Plus size={16} />
                              </button>
                            </div>
                            <button
                              type="button"
                              className="text-button"
                              disabled={locked}
                              aria-label={`Remover ${item.title}${item.cutType ? ` em ${CUT_TYPE_LABELS[item.cutType]}` : ""}`}
                              onClick={() =>
                                void command.send(
                                  `/v1/cart/items/${item.id}/remove`,
                                  { commandId: crypto.randomUUID() },
                                )
                              }
                            >
                              <Trash2 size={16} /> Remover
                            </button>
                          </div>
                        </article>
                      ))}
                      <div
                        className={`hvm-cart-minimum ${store.meetsMinOrder ? "met" : ""}`}
                      >
                        <strong>
                          Subtotal: {formatProductPrice(store.subtotalCents)}
                        </strong>
                        <p>
                          {store.meetsMinOrder ? (
                            <>
                              <Check size={16} /> Pedido mínimo atingido
                            </>
                          ) : (
                            `Faltam ${formatProductPrice(store.minOrderCents - store.subtotalCents)} para o pedido mínimo desta loja.`
                          )}
                        </p>
                        <small>
                          Mínimo desta loja:{" "}
                          {formatProductPrice(store.minOrderCents)}
                        </small>
                      </div>
                    </section>
                  ))}
                </div>
                <aside className="hvm-cart-summary">
                  <h2>Sua seleção</h2>
                  <p>
                    {cart.itemCount} opção(ões) · {cart.stores.length}{" "}
                    produtor(es)
                  </p>
                  <strong>{formatProductPrice(cart.subtotalCents)}</strong>
                  <p>Total dos alimentos disponíveis. Frete não incluído.</p>
                  <button
                    className="primary"
                    disabled={locked || !cart.stores.every((s) => s.meetsMinOrder && s.items.every((i) => i.available))}
                    onClick={() => onNavigate("/checkout")}
                  >
                    Revisar pedido
                  </button>
                  <button
                    className="secondary"
                    onClick={() => onNavigate("/produtos")}
                  >
                    Escolher mais alimentos
                  </button>
                </aside>
              </div>
            )}
            {command.error && (
              <div className="hvm-cart-notice" role="alert">
                <p>{command.error}</p>
                {command.uncertain && (
                  <button
                    className="secondary"
                    disabled={command.busy}
                    onClick={() => void command.retry()}
                  >
                    Confirmar alteração
                  </button>
                )}
                {!command.uncertain && (
                  <button className="secondary" onClick={() => void load()}>
                    Atualizar cesta
                  </button>
                )}
              </div>
            )}
            {!signedIn && (
              <div className="hvm-cart-notice">
                <p>
                  Entre na sua conta para guardar a cesta e continuar em outros
                  aparelhos.
                </p>
                <button
                  className="text-button"
                  onClick={() => onNavigate("/entrar/consumidor")}
                >
                  Entrar na minha conta
                </button>
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
