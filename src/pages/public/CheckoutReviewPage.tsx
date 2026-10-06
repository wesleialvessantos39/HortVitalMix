import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  MapPin,
  RefreshCw,
  Salad,
  ShieldCheck,
  Store,
  Truck,
} from "lucide-react";
import type { AddressAdvancedView } from "../../../shared/contracts/addressAdvanced";
import type { Cart } from "../../../shared/contracts/cart";
import { CUT_TYPE_LABELS } from "../../../shared/contracts/cart";
import type {
  CheckoutConfirmation,
  CheckoutContext,
  CheckoutQuote,
} from "../../../shared/contracts/checkout";
import { formatProductPrice } from "../../../shared/contracts/product";
import { api, type ApiFailure } from "../../lib/api";
import { loadCart } from "../../lib/cart";
import {
  checkoutConfirmation,
  checkoutContext,
  checkoutErrorMessage,
  checkoutQuote,
  clearPendingCheckout,
  confirmCheckout,
  createCheckoutQuote,
  newCheckoutCommand,
  readPendingCheckout,
  savePendingCheckout,
  type PendingCheckout,
} from "../../lib/checkout";
import { MediaImage } from "../../components/catalog/MediaImage";
import "./checkout.css";

type State = "loading" | "ready" | "empty" | "error" | "conflict";
const countdown = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
export default function CheckoutReviewPage({
  userId,
  onNavigate,
}: {
  userId: string | null;
  onNavigate: (path: string) => void;
}) {
  const [state, setState] = useState<State>("loading"),
    [cart, setCart] = useState<Cart | null>(null),
    [context, setContext] = useState<CheckoutContext | null>(null),
    [addresses, setAddresses] = useState<AddressAdvancedView[]>([]),
    [addressId, setAddressId] = useState(""),
    [quote, setQuote] = useState<CheckoutQuote | null>(null),
    [method, setMethod] = useState<"pix" | "credit_card">("pix"),
    [confirmed, setConfirmed] = useState<CheckoutConfirmation | null>(null),
    [pending, setPending] = useState<PendingCheckout | null>(null),
    [uncertain, setUncertain] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  const flight = useRef(false),
    clockOffset = useRef(0),
    alive = useRef(true),
    pendingRef = useRef<PendingCheckout | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Date.now() + clockOffset.current),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const rememberQuote = (next: CheckoutQuote) => {
    setQuote(next);
    setAddressId(next.deliveryAddressId ?? "");
    clockOffset.current = Date.parse(next.serverTime) - Date.now();
    setNow(Date.now() + clockOffset.current);
    history.replaceState({}, "", "/checkout?quote=" + next.id);
  };
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!userId) {
        setState("empty");
        return;
      }
      setState("loading");
      setError("");
      try {
        const [ctx, nextCart, list] = await Promise.all([
          checkoutContext(signal),
          loadCart(signal),
          api<{ addresses: AddressAdvancedView[] }>("/v1/account/addresses", {
            signal,
          }),
        ]);
        if (signal?.aborted || !alive.current) return;
        setContext(ctx);
        setCart(nextCart);
        setAddresses(list.addresses.filter((a) => a.isActive));
        clockOffset.current = Date.parse(ctx.serverTime) - Date.now();
        setNow(Date.now() + clockOffset.current);
        const saved = readPendingCheckout(userId);
        pendingRef.current = saved;
        setPending(saved);
        setUncertain(!!saved);
        let receipt = ctx.pendingConfirmation;
        if (!receipt && saved) {
          try {
            receipt = await checkoutConfirmation(saved.commandId, signal);
          } catch (e) {
            if ((e as ApiFailure).status !== 404) throw e;
          }
        }
        if (signal?.aborted || !alive.current) return;
        setConfirmed(receipt);
        const unresolved = !receipt ? saved : null;
        setPending(unresolved);
        pendingRef.current = unresolved;
        setUncertain(!!unresolved);
        const quoteId =
          receipt?.quoteId ??
          unresolved?.payload.quoteId ??
          new URLSearchParams(location.search).get("quote");
        if (quoteId) {
          const next = await checkoutQuote(quoteId, signal);
          if (signal?.aborted || !alive.current) return;
          rememberQuote(next);
        } else {
          setQuote(null);
          setAddressId(
            list.addresses.find((a) => a.isDefault && a.isActive)?.id ??
              list.addresses.find((a) => a.isActive)?.id ??
              "",
          );
        }
        if (receipt) setMethod(receipt.paymentMethod);
        setState(
          nextCart.stores.length || receipt || unresolved ? "ready" : "empty",
        );
      } catch (e) {
        if (signal?.aborted || !alive.current) return;
        setError(checkoutErrorMessage(e));
        setState("error");
      }
    },
    [userId],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  const remaining = quote ? Date.parse(quote.expiresAt) - now : 0;
  const expired = !!quote && remaining <= 0 && !confirmed;
  const locked = busy || uncertain || !!confirmed;
  const canQuote =
    addresses.some(
      (a) => a.id === addressId && a.latitude !== null && a.longitude !== null,
    ) &&
    !!cart?.stores.length &&
    cart.stores.every(
      (s) => s.meetsMinOrder && s.items.every((i) => i.available),
    );
  async function recalculate() {
    if (flight.current || !context || !canQuote || uncertain || confirmed)
      return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await createCheckoutQuote(context.cartId, addressId);
      if (!alive.current) return;
      rememberQuote(next);
      setState("ready");
      if (userId) clearPendingCheckout(userId);
      setPending(null);
      pendingRef.current = null;
    } catch (e) {
      if (alive.current) {
        setError(checkoutErrorMessage(e));
        setState((e as ApiFailure).status === 409 ? "conflict" : "error");
      }
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function submit() {
    if (
      flight.current ||
      !userId ||
      confirmed ||
      (!quote && !pendingRef.current)
    )
      return;
    if (!pendingRef.current && (expired || state === "conflict")) return;
    const command =
      pendingRef.current ??
      newCheckoutCommand({ quoteId: quote!.id, paymentMethod: method });
    pendingRef.current = command;
    setPending(command);
    savePendingCheckout(userId, command);
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await confirmCheckout(command);
      if (!alive.current) return;
      setConfirmed(receipt);
      setUncertain(false);
      setPending(null);
      pendingRef.current = null;
      setState("ready");
      if (!quote) {
        try {
          const restored = await checkoutQuote(receipt.quoteId);
          if (alive.current) rememberQuote(restored);
        } catch {
          // A missing review response cannot invalidate an already persisted receipt.
        }
      }
    } catch (e) {
      if (!alive.current) return;
      const status = (e as ApiFailure).status;
      const unknown = status === undefined || status < 400 || status >= 500;
      setUncertain(unknown);
      setError(checkoutErrorMessage(e));
      if (!unknown) {
        clearPendingCheckout(userId);
        setPending(null);
        pendingRef.current = null;
        setState(status === 409 || status === 410 ? "conflict" : "error");
      }
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function changeAddress(value: string) {
    setAddressId(value);
    setQuote(null);
    setError("");
    setState("ready");
    history.replaceState({}, "", "/checkout");
  }
  function newSelection() {
    if (!userId) return;
    clearPendingCheckout(userId);
    setConfirmed(null);
    setPending(null);
    setUncertain(false);
    pendingRef.current = null;
    history.replaceState({}, "", "/checkout");
    void load();
  }
  const stores = quote?.stores ?? cart?.stores ?? [];
  const reservationExpired =
    !!confirmed && Date.parse(confirmed.expiresAt) <= now;
  return (
    <section className="hvm-checkout" data-state={state}>
      <button className="text-button" onClick={() => onNavigate("/carrinho")}>
        <ArrowLeft size={18} /> Voltar à cesta
      </button>
      <header>
        <span className="eyebrow">Da nossa região para sua mesa</span>
        <h1>Revisar pedido</h1>
        <p>Confira os alimentos, o endereço e o frete de cada produtor.</p>
      </header>
      {!userId ? (
        <div className="hvm-checkout-empty">
          <ShieldCheck size={40} />
          <h2>Entre para revisar sua seleção</h2>
          <p>
            Sua cesta será preservada. Use sua conta para escolher o endereço de
            entrega.
          </p>
          <button
            className="primary"
            onClick={() => onNavigate("/entrar/consumidor")}
          >
            Entrar na minha conta
          </button>
        </div>
      ) : state === "loading" ? (
        <p role="status">Preparando a revisão do pedido…</p>
      ) : state === "empty" ? (
        <div className="hvm-checkout-empty">
          <Salad size={44} />
          <h2>Sua cesta está vazia</h2>
          <button className="primary" onClick={() => onNavigate("/produtos")}>
            Explorar produtos
          </button>
        </div>
      ) : (
        <>
          {(state === "conflict" || expired) && !uncertain && !confirmed && (
            <div className="hvm-checkout-notice" role="alert">
              <h2>
                Os valores do seu pedido mudaram, revise antes de confirmar
              </h2>
              <p>{expired ? "A cotação de 15 minutos expirou." : error}</p>
              <button
                className="secondary"
                disabled={busy || !canQuote}
                onClick={() => void recalculate()}
              >
                <RefreshCw size={17} /> Recalcular cotação
              </button>
              <button
                className="text-button"
                onClick={() => onNavigate("/carrinho")}
              >
                Revisar cesta
              </button>
            </div>
          )}
          {error && state !== "conflict" && !uncertain && (
            <div className="hvm-checkout-notice" role="alert">
              <p>{error}</p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void load()}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {uncertain && (
            <div className="hvm-checkout-notice" role="alert">
              <h2>Vamos recuperar sua confirmação</h2>
              <p>
                A resposta não chegou. A seleção e a mesma confirmação foram
                guardadas para repetir com segurança.
              </p>
              <button
                className="primary"
                disabled={busy || !pending}
                onClick={() => void submit()}
              >
                {busy ? "Recuperando…" : "Recuperar confirmação"}
              </button>
            </div>
          )}
          {confirmed && (
            <div className="hvm-checkout-confirmed" role="status">
              <CheckCircle2 size={32} />
              <div>
                <h2>
                  {reservationExpired
                    ? "Reserva encerrada"
                    : "Checkout confirmado"}
                </h2>
                <strong>Pagamento pendente</strong>
                <p>
                  Você confirmou os valores da seleção. Total:{" "}
                  {formatProductPrice(confirmed.totalCents)}.
                </p>
                <p>
                  {reservationExpired
                    ? "O prazo desta reserva terminou. Revise sua seleção para continuar."
                    : `Estoque reservado por mais ${countdown(Date.parse(confirmed.expiresAt) - now)}.`}
                </p>
                <small>Referência: {confirmed.paymentIntentId}</small>
                {reservationExpired && (
                  <button className="secondary" onClick={newSelection}>
                    Revisar nova seleção
                  </button>
                )}
              </div>
            </div>
          )}
          {!!stores.length && (
            <div className="hvm-checkout-layout">
              <div className="hvm-checkout-main">
                <section className="hvm-checkout-panel">
                  <h2>
                    <MapPin size={21} /> Endereço de entrega
                  </h2>
                  {confirmed ? (
                    <p>
                      {quote?.addressSnapshot.street},{" "}
                      {quote?.addressSnapshot.number} ·{" "}
                      {quote?.addressSnapshot.neighborhood}
                      <br />
                      {quote?.addressSnapshot.city} /{" "}
                      {quote?.addressSnapshot.state}
                    </p>
                  ) : (
                    <>
                      <label htmlFor="checkout-address">
                        Escolha um endereço da sua conta
                      </label>
                      <select
                        id="checkout-address"
                        value={addressId}
                        disabled={locked}
                        onChange={(e) => changeAddress(e.target.value)}
                      >
                        <option value="">Selecione um endereço</option>
                        {addresses.map((a) => (
                          <option
                            key={a.id}
                            value={a.id}
                            disabled={
                              a.latitude === null || a.longitude === null
                            }
                          >
                            {a.label} · {a.street}, {a.number} · {a.city}
                            {a.latitude === null || a.longitude === null
                              ? " · ajuste o ponto no mapa"
                              : ""}
                          </option>
                        ))}
                      </select>
                      {!addresses.length && (
                        <p>
                          Cadastre um endereço com ponto de entrega no mapa para
                          calcular o frete.
                        </p>
                      )}
                      <button
                        className="text-button"
                        disabled={locked}
                        onClick={() => onNavigate("/conta/enderecos")}
                      >
                        Gerenciar endereços
                      </button>
                      <button
                        className="secondary"
                        disabled={!canQuote || locked}
                        onClick={() => void recalculate()}
                      >
                        {busy
                          ? "Calculando…"
                          : quote
                            ? "Recalcular cotação"
                            : "Calcular frete e revisar"}
                      </button>
                    </>
                  )}
                  {quote && (
                    <p className="hvm-checkout-caption">
                      O endereço exibido nesta cotação foi registrado no momento
                      do cálculo.
                    </p>
                  )}
                </section>
                {stores.map((s, index) => (
                  <section
                    className="hvm-checkout-panel"
                    key={s.storeId}
                    aria-label={`Pedido de ${s.storeName}`}
                  >
                    <h2>
                      <Store size={21} />
                      {s.storeName}
                    </h2>
                    {s.items.map((i, j) => (
                      <article
                        className="hvm-checkout-item"
                        key={"cartItemId" in i ? i.cartItemId : i.id}
                      >
                        <div className="hvm-checkout-photo">
                          {i.imageUrl ? (
                            <MediaImage
                              src={i.imageUrl}
                              alt={i.title}
                              priority={index === 0 && j < 3}
                            />
                          ) : (
                            <Salad size={26} />
                          )}
                        </div>
                        <div>
                          <h3>{i.title}</h3>
                          <p>
                            {i.quantity} porção(ões) · {i.netWeightGrams} g cada
                            {i.cutType
                              ? " · " + CUT_TYPE_LABELS[i.cutType]
                              : ""}
                          </p>
                          <small>
                            {formatProductPrice(i.unitPriceCents)} por unidade
                          </small>
                        </div>
                        <strong>
                          {formatProductPrice(i.unitPriceCents * i.quantity)}
                        </strong>
                      </article>
                    ))}
                    <dl className="hvm-checkout-store-totals">
                      <div>
                        <dt>Alimentos</dt>
                        <dd>{formatProductPrice(s.subtotalCents)}</dd>
                      </div>
                      <div>
                        <dt>
                          <Truck size={16} /> Frete desta loja
                        </dt>
                        <dd>
                          {"deliveryFeeCents" in s
                            ? formatProductPrice(s.deliveryFeeCents)
                            : "A calcular"}
                        </dd>
                      </div>
                      <div>
                        <dt>Pedido mínimo</dt>
                        <dd>{formatProductPrice(s.minOrderCents)}</dd>
                      </div>
                    </dl>
                  </section>
                ))}
              </div>
              <aside className="hvm-checkout-summary">
                <h2>Resumo da seleção</h2>
                {quote ? (
                  <>
                    <span className="hvm-checkout-frozen">
                      <ShieldCheck size={17} /> Cotação congelada
                    </span>
                    <dl>
                      <div>
                        <dt>Alimentos</dt>
                        <dd>{formatProductPrice(quote.subtotalCents)}</dd>
                      </div>
                      <div>
                        <dt>Frete</dt>
                        <dd>{formatProductPrice(quote.deliveryFeeCents)}</dd>
                      </div>
                      <div>
                        <dt>Desconto</dt>
                        <dd>{formatProductPrice(quote.discountCents)}</dd>
                      </div>
                      <div className="hvm-checkout-total">
                        <dt>Total</dt>
                        <dd>{formatProductPrice(quote.totalCents)}</dd>
                      </div>
                    </dl>
                    {!confirmed && (
                      <p className="hvm-checkout-clock" role="timer">
                        <Clock3 size={18} /> Válida por {countdown(remaining)}
                      </p>
                    )}
                    {!confirmed && (
                      <>
                        <fieldset disabled={locked || expired}>
                          <legend>Forma de pagamento</legend>
                          <label>
                            <input
                              type="radio"
                              name="checkout-payment"
                              checked={method === "pix"}
                              onChange={() => setMethod("pix")}
                            />{" "}
                            Pix
                          </label>
                          <label>
                            <input
                              type="radio"
                              name="checkout-payment"
                              checked={method === "credit_card"}
                              onChange={() => setMethod("credit_card")}
                            />{" "}
                            Cartão de crédito
                          </label>
                        </fieldset>
                        <p>
                          A confirmação reserva os alimentos por 15 minutos. O
                          pagamento permanece pendente.
                        </p>
                        <button
                          className="primary"
                          disabled={
                            locked ||
                            expired ||
                            state !== "ready" ||
                            quote.isConsumed
                          }
                          onClick={() => void submit()}
                        >
                          {busy ? "Confirmando…" : "Confirmar Pedido"}
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <strong>
                      {formatProductPrice(cart?.subtotalCents ?? 0)}
                    </strong>
                    <p>
                      Alimentos na cesta. Calcule o frete para congelar os
                      valores antes de confirmar.
                    </p>
                    {!canQuote && (
                      <p>
                        Confira o endereço, a disponibilidade e o mínimo de cada
                        loja.
                      </p>
                    )}
                  </>
                )}
                <button
                  className="text-button"
                  onClick={() => onNavigate("/carrinho")}
                >
                  Ver minha cesta
                </button>
              </aside>
            </div>
          )}
        </>
      )}
    </section>
  );
}
