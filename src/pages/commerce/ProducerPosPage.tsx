import { useEffect, useRef, useState } from "react";
import { CreditCard, QrCode, ShoppingBasket } from "lucide-react";
import type { PosSale, OrderView } from "../../../shared/contracts/commerce";
import { api } from "../../lib/api";
import {
  commerceMessage,
  commerceMutation,
  money,
  statusLabels,
  date,
} from "../../lib/commerce";
import { RefundPolicy } from "../../components/commerce/RefundPolicy";
import "./commerce.css";
type PosContext = {
  store: { id: string; name: string };
  products: Array<{
    id: string;
    title: string;
    unitType: string;
    priceCents: number;
    availableQuantity: number;
  }>;
  sales: PosSale[];
  orders: OrderView[];
  balance: { heldCents: number; disputedCents: number; refundedCents: number };
  gatewayAvailable: boolean;
};
export default function ProducerPosPage({
  userId,
  onNavigate,
}: {
  userId: string;
  onNavigate: (path: string) => void;
}) {
  const [context, setContext] = useState<PosContext | null>(null),
    [quantities, setQuantities] = useState<Record<string, number>>({}),
    [method, setMethod] = useState<"pix" | "credit_card" | "debit_card">("pix"),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [prepared, setPrepared] = useState<PosSale | null>(null);
  const flight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<PosContext>("/v1/producer/pos", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setContext(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(commerceMessage(e));
      });
    return () => controller.abort();
  }, [userId]);
  const total =
    context?.products.reduce(
      (sum, product) =>
        sum + (quantities[product.id] ?? 0) * product.priceCents,
      0,
    ) ?? 0;
  async function prepare() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const sale = await commerceMutation<PosSale>(
        "/v1/producer/pos/sales",
        {
          items: Object.entries(quantities)
            .filter(([, quantity]) => quantity > 0)
            .map(([productId, quantity]) => ({ productId, quantity })),
          paymentMethod: method,
          paymentChannel: method === "pix" ? "system_pix" : "terminal",
        },
        userId,
      );
      setPrepared(sale);
      setQuantities({});
      setContext(await api<PosContext>("/v1/producer/pos"));
      setNotice(
        "Venda preparada. Compartilhe a revisão com o cliente. Ela ainda não foi paga.",
      );
    } catch (e) {
      setError(commerceMessage(e));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function cancel(sale: PosSale) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      await commerceMutation(
        "/v1/producer/pos/sales/" + sale.id + "/cancel",
        {},
        userId,
      );
      setContext(await api<PosContext>("/v1/producer/pos"));
      if (prepared?.id === sale.id) setPrepared(null);
    } catch (e) {
      setError(commerceMessage(e));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function copy(sale: PosSale) {
    try {
      await navigator.clipboard.writeText(
        location.origin + "/pos/venda/" + sale.code,
      );
      setNotice("Link da revisão copiado.");
    } catch {
      setNotice("Copie o link exibido na venda.");
    }
  }
  return (
    <section className="hvm-commerce">
      <button className="text-button" onClick={() => onNavigate("/conta")}>
        ← Minha conta
      </button>
      <h1>Caixa do produtor</h1>
      <p>
        Monte a compra presencial, escolha o meio de recebimento e compartilhe a
        revisão com o cliente.
      </p>
      {error && (
        <p role="alert" className="commerce-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="commerce-success">
          {notice}
        </p>
      )}
      {!context && !error && <p role="status">Abrindo seu caixa…</p>}
      {context && (
        <>
          <div className="commerce-card">
            <h2>{context.store.name}</h2>
            <span className="commerce-tag">
              {context.gatewayAvailable
                ? "Conta conectada"
                : "Conta e maquininha em preparação"}
            </span>
            <p>
              O dinheiro ficará na conta central, com retenção e proteção da
              compra. Dinheiro em espécie não é aceito.
            </p>
            <div className="commerce-balances">
              <div>
                <span>Saldo retido</span>
                <strong>{money(context.balance.heldCents)}</strong>
              </div>
              <div>
                <span>Bloqueado por disputa</span>
                <strong>{money(context.balance.disputedCents)}</strong>
              </div>
              <div>
                <span>Reembolsado</span>
                <strong>{money(context.balance.refundedCents)}</strong>
              </div>
            </div>
            <p className="commerce-form-help">
              Os saldos refletem pagamentos confirmados pelo provedor. A
              preparação da venda não reserva nem baixa o estoque.
            </p>
          </div>
          <div className="commerce-grid">
            <article className="commerce-card">
              <h2>
                <ShoppingBasket size={21} /> Produtos da venda
              </h2>
              <label>
                Buscar no seu catálogo
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nome do produto"
                />
              </label>
              <ul className="commerce-items">
                {context.products
                  .filter((product) =>
                    product.title
                      .toLocaleLowerCase("pt-BR")
                      .includes(search.toLocaleLowerCase("pt-BR")),
                  )
                  .map((product) => (
                    <li key={product.id}>
                      <span>
                        <strong>{product.title}</strong>
                        <small>
                          {money(product.priceCents)} / {product.unitType} ·{" "}
                          {product.availableQuantity} disponíveis
                        </small>
                      </span>
                      <label>
                        Quantidade
                        <input
                          type="number"
                          min="0"
                          max={Math.min(99, product.availableQuantity)}
                          step="1"
                          value={quantities[product.id] ?? 0}
                          disabled={busy || !product.availableQuantity}
                          aria-label={"Quantidade de " + product.title}
                          onChange={(e) =>
                            setQuantities((current) => ({
                              ...current,
                              [product.id]: Math.max(
                                0,
                                Math.min(
                                  99,
                                  product.availableQuantity,
                                  Math.trunc(Number(e.target.value)),
                                ),
                              ),
                            }))
                          }
                        />
                      </label>
                    </li>
                  ))}
              </ul>
              {!context.products.length && (
                <p>
                  Publique seus produtos e registre estoque para montar a
                  primeira venda.
                </p>
              )}
            </article>
            <article className="commerce-card">
              <h2>Recebimento</h2>
              <fieldset disabled={busy}>
                <legend>Forma de pagamento</legend>
                {(
                  [
                    ["pix", "Pix do sistema"],
                    ["credit_card", "Cartão de crédito · maquininha"],
                    ["debit_card", "Cartão de débito · maquininha"],
                  ] as const
                ).map(([value, label]) => (
                  <label className="commerce-checkbox" key={value}>
                    <input
                      type="radio"
                      name="pos-method"
                      value={value}
                      checked={method === value}
                      onChange={() => setMethod(value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              <p>
                {method === "pix" ? (
                  <QrCode size={19} />
                ) : (
                  <CreditCard size={19} />
                )}{" "}
                {method === "pix"
                  ? "A cobrança será gerada pelo sistema após a conta ser ativada."
                  : "O cartão será passado na maquininha vinculada à conta da plataforma."}
              </p>
              <p className="commerce-note">
                Até conectar a conta, prepare a venda para revisão. A
                confirmação financeira dependerá do provedor e não poderá ser
                marcada manualmente.
              </p>
              <h2>Total {money(total)}</h2>
              <button
                className="primary"
                disabled={busy || total <= 0}
                onClick={() => void prepare()}
              >
                {busy ? "Preparando…" : "Preparar venda presencial"}
              </button>
              {prepared && (
                <div className="commerce-message">
                  <h3>Revisão para o cliente</h3>
                  <p className="commerce-reference">
                    {location.origin}/pos/venda/{prepared.code}
                  </p>
                  <p>
                    Validade: {date(prepared.expiresAt)} ·{" "}
                    {money(prepared.totalCents)}
                  </p>
                  <div className="commerce-actions">
                    <button
                      className="secondary"
                      onClick={() => void copy(prepared)}
                    >
                      Copiar link
                    </button>
                    <button
                      className="text-button"
                      onClick={() => onNavigate("/pos/venda/" + prepared.code)}
                    >
                      Abrir revisão
                    </button>
                  </div>
                </div>
              )}
            </article>
          </div>
          <article className="commerce-card">
            <h2>Vendas preparadas</h2>
            {!context.sales.length ? (
              <p>Suas vendas presenciais aparecerão aqui.</p>
            ) : (
              <ul className="commerce-items">
                {context.sales.map((sale) => (
                  <li key={sale.id}>
                    <span>
                      <strong>
                        {money(sale.totalCents)} · {statusLabels[sale.status]}
                      </strong>
                      <small>
                        {sale.items
                          .map((item) => `${item.quantity} × ${item.title}`)
                          .join(", ")}
                      </small>
                      <small>Validade: {date(sale.expiresAt)}</small>
                    </span>
                    <div className="commerce-actions">
                      <button
                        className="secondary"
                        onClick={() => void copy(sale)}
                      >
                        Copiar revisão
                      </button>
                      {["draft", "accepted"].includes(sale.status) && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void cancel(sale)}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
          {!!context.orders.length && (
            <article className="commerce-card">
              <h2>Compras confirmadas na sua loja</h2>
              <ul className="commerce-items">
                {context.orders.map((order) => (
                  <li key={order.id}>
                    <span>
                      <strong>
                        {order.orderNumber} · {money(order.totalCents)}
                      </strong>
                      <small>
                        {statusLabels[order.holdState]} ·{" "}
                        {statusLabels[order.status]}
                      </small>
                    </span>
                    <button
                      className="text-button"
                      onClick={() =>
                        onNavigate(
                          `/denuncias?targetType=customer&targetId=${order.customerUserId}&orderId=${order.id}`,
                        )
                      }
                    >
                      Denunciar problema com cliente
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          )}
          <RefundPolicy onNavigate={onNavigate} />
        </>
      )}
    </section>
  );
}
