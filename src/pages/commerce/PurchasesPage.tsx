import { useEffect, useRef, useState } from "react";
import type { OrderView, PosSale } from "../../../shared/contracts/commerce";
import { api } from "../../lib/api";
import {
  commerceMessage,
  commerceMutation,
  money,
  date,
  statusLabels,
} from "../../lib/commerce";
import { RefundPolicy } from "../../components/commerce/RefundPolicy";
import "./commerce.css";
type Purchases = {
  orders: OrderView[];
  sales: PosSale[];
  payments: Array<{
    id: string;
    method: string;
    amountCents: number;
    expiresAt: string;
  }>;
};
export default function PurchasesPage({
  userId,
  onNavigate,
}: {
  userId: string | null;
  onNavigate: (path: string) => void;
}) {
  const [result, setResult] = useState<Purchases | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState(() => {
      try {
        return sessionStorage.getItem("hvm:pos-review") ?? "";
      } catch {
        return "";
      }
    });
  const flight = useRef(false);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    void api<Purchases>("/v1/commerce/purchases", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(commerceMessage(e));
      });
    return () => controller.abort();
  }, [userId]);
  async function received(order: OrderView) {
    if (
      !userId ||
      flight.current ||
      !window.confirm(
        "Você recebeu todos os produtos desta compra? Essa confirmação inicia os prazos de proteção exibidos no comprovante.",
      )
    )
      return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      await commerceMutation(
        "/v1/commerce/orders/" + order.id + "/received",
        {},
        userId,
      );
      setResult(await api<Purchases>("/v1/commerce/purchases"));
    } catch (e) {
      setError(commerceMessage(e));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="hvm-commerce">
      <h1>Minhas compras</h1>
      <div className="commerce-section-links">
        <button
          className="text-button"
          onClick={() => onNavigate("/reembolsos")}
        >
          Meus reembolsos
        </button>
        <button
          className="text-button"
          onClick={() => onNavigate("/denuncias")}
        >
          Minhas denúncias
        </button>
      </div>
      {error && (
        <p role="alert" className="commerce-error">
          {error}
        </p>
      )}
      {!userId ? (
        <article className="commerce-card">
          <p>Entre para consultar suas compras e solicitações.</p>
          <button
            className="primary"
            onClick={() => onNavigate("/entrar/consumidor")}
          >
            Entrar
          </button>
        </article>
      ) : (
        <>
          <article className="commerce-card">
            <h2>Revisar uma venda presencial</h2>
            <label>
              Código ou link enviado pelo produtor
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Cole o código ou o link da revisão"
              />
            </label>
            <button
              className="secondary"
              onClick={() => {
                const match = code
                  .trim()
                  .match(/(?:^|\/)([a-f0-9]{32})(?:$|[?#])/);
                if (match) onNavigate("/pos/venda/" + match[1]);
                else
                  setError(
                    "Confira o código de revisão enviado pelo produtor.",
                  );
              }}
            >
              Abrir revisão
            </button>
          </article>
          {!result && !error && <p role="status">Carregando suas compras…</p>}
          {result && (
            <>
              {!!result.payments.length && (
                <article className="commerce-card">
                  <h2>Revisões com pagamento pendente</h2>
                  <ul className="commerce-items">
                    {result.payments.map((payment) => (
                      <li key={payment.id}>
                        <span>
                          <strong>{money(payment.amountCents)}</strong>
                          <small>
                            Reserva válida até {date(payment.expiresAt)}
                          </small>
                        </span>
                        <button
                          className="secondary"
                          onClick={() =>
                            onNavigate("/pagamentos/" + payment.id)
                          }
                        >
                          Ver pagamento
                        </button>
                      </li>
                    ))}
                  </ul>
                </article>
              )}
              {!result.orders.length && (
                <article className="commerce-card">
                  <h2>Seu histórico de compras</h2>
                  <p>
                    As compras aparecerão aqui após um pagamento confirmado.
                    Vendas preparadas ficam separadas para revisão.
                  </p>
                </article>
              )}
              {result.orders.map((order) => (
                <article className="commerce-card" key={order.id}>
                  <span className="commerce-tag">
                    {statusLabels[order.status]}
                  </span>
                  <h2>
                    {order.orderNumber} · {order.storeName}
                  </h2>
                  <p>
                    {date(order.createdAt)} ·{" "}
                    {order.source === "online"
                      ? "Compra online"
                      : "Compra presencial"}
                  </p>
                  <ul className="commerce-items">
                    {order.items.map((item) => (
                      <li key={item.productId}>
                        <span>
                          {item.quantity} × {item.title}
                        </span>
                        <strong>{money(item.totalPriceCents)}</strong>
                        <button
                          className="text-button"
                          onClick={() =>
                            onNavigate(
                              `/denuncias?targetType=product&targetId=${item.productId}&orderId=${order.id}`,
                            )
                          }
                        >
                          Denunciar produto
                        </button>
                      </li>
                    ))}
                  </ul>
                  <h3>Total {money(order.totalCents)}</h3>
                  <div className="commerce-actions">
                    {!order.receivedAt && order.status !== "refunded" && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void received(order)}
                      >
                        Recebi meus produtos
                      </button>
                    )}
                    <button
                      className="secondary"
                      disabled={order.status === "refunded"}
                      onClick={() =>
                        onNavigate("/reembolsos?orderId=" + order.id)
                      }
                    >
                      Solicitar reembolso
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        onNavigate(`/denuncias?orderId=${order.id}`)
                      }
                    >
                      Denunciar um problema
                    </button>
                  </div>
                  <RefundPolicy
                    policy={order.policy}
                    withdrawalDeadline={order.withdrawalDeadline}
                    problemDeadline={order.problemDeadline}
                    onNavigate={onNavigate}
                  />
                </article>
              ))}
              {!!result.sales.length && (
                <article className="commerce-card">
                  <h2>Revisões presenciais</h2>
                  <ul className="commerce-items">
                    {result.sales.map((sale) => (
                      <li key={sale.id}>
                        <span>
                          {sale.storeName} · {money(sale.totalCents)}
                          <small>{statusLabels[sale.status]}</small>
                        </span>
                        <button
                          className="text-button"
                          onClick={() => onNavigate("/pos/venda/" + sale.code)}
                        >
                          Abrir revisão
                        </button>
                      </li>
                    ))}
                  </ul>
                </article>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
