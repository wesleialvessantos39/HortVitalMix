import {
  Check,
  Clock3,
  Leaf,
  PackageCheck,
  RefreshCw,
  Truck,
} from "lucide-react";
import { useState } from "react";
import {
  OrderListResponseSchema,
  OrderResponseSchema,
  ORDER_STATUS_LABELS,
  type OrderDetail,
  type OrderStatus,
} from "../../../shared/contracts/order";
import { useOrderQuery } from "../../hooks/useOrderQuery";
import { money, date, statusLabels } from "../../lib/commerce";
import "../commerce/commerce.css";
import "./orders.css";

const steps: OrderStatus[] = [
  "confirmed",
  "in_preparation",
  "ready_for_dispatch",
  "out_for_delivery",
  "delivered",
];
const icons = [Check, Leaf, PackageCheck, Truck, Check];
function Timeline({ order }: { order: OrderDetail }) {
  const reached = new Set(order.events.map((event) => event.toStatus));
  return (
    <article className="commerce-card">
      <h2>Da horta até você</h2>
      <ol className="order-timeline" aria-label="Etapas do pedido">
        {steps.map((status, index) => {
          const Icon = icons[index],
            event = order.events.find((value) => value.toStatus === status);
          return (
            <li
              key={status}
              className={reached.has(status) ? "reached" : "waiting"}
              aria-current={order.status === status ? "step" : undefined}
            >
              <span className="order-step-icon">
                <Icon size={19} aria-hidden="true" />
              </span>
              <span>
                <strong>{ORDER_STATUS_LABELS[status]}</strong>
                <small>
                  {event
                    ? date(event.occurredAt)
                    : order.status === "cancelled"
                      ? "Etapa não alcançada"
                      : "Aguardando esta etapa"}
                </small>
              </span>
            </li>
          );
        })}
      </ol>
    </article>
  );
}
function Detail({
  id,
  userId,
  onNavigate,
}: {
  id: string;
  userId: string;
  onNavigate: (path: string) => void;
}) {
  const {
    data: order,
    error,
    refresh,
  } = useOrderQuery("/v1/orders/" + id, userId, OrderResponseSchema);
  return (
    <>
      <div className="commerce-actions">
        <button className="text-button" onClick={() => onNavigate("/pedidos")}>
          ← Meus pedidos
        </button>
        <button className="secondary" onClick={refresh}>
          <RefreshCw size={16} aria-hidden="true" /> Atualizar
        </button>
      </div>
      {error && (
        <p role="alert" className="commerce-error">
          {error}
        </p>
      )}
      {!order && !error && <p role="status">Carregando o acompanhamento…</p>}
      {order && (
        <>
          <div className="order-heading">
            <div>
              <span className={`commerce-tag order-status-${order.status}`}>
                {ORDER_STATUS_LABELS[order.status]}
              </span>
              <h1>{order.orderNumber}</h1>
              <p>
                {order.storeName} · {date(order.createdAt)}
              </p>
            </div>
            <strong className="order-total">{money(order.totalCents)}</strong>
          </div>
          {order.status === "cancelled" && (
            <aside className="order-cancellation" role="status">
              <h2>Pedido cancelado</h2>
              <p className="commerce-prewrap">{order.cancellationReason}</p>
              <p>
                {order.refundState === "refunded"
                  ? "O reembolso foi confirmado."
                  : "O valor permanece protegido. Acompanhe a solicitação de reembolso."}
              </p>
              <button
                className="secondary"
                onClick={() => onNavigate("/reembolsos?orderId=" + order.id)}
              >
                Acompanhar reembolso
              </button>
            </aside>
          )}
          {order.commercialStatus === "refunded" &&
            order.status !== "cancelled" && (
              <p className="order-cancellation">
                O reembolso desta compra foi confirmado. O histórico do preparo
                permanece disponível.
              </p>
            )}
          <div className="order-detail-grid">
            <div>
              <Timeline order={order} />
              <article className="commerce-card">
                <h2>Histórico do pedido</h2>
                <ol className="order-history">
                  {order.events.map((event) => (
                    <li key={event.id}>
                      <Clock3 size={17} aria-hidden="true" />
                      <div>
                        <strong>{ORDER_STATUS_LABELS[event.toStatus]}</strong>
                        <small>
                          {date(event.occurredAt)} ·{" "}
                          {event.actorRole === "payment_gateway"
                            ? "Confirmação do pagamento"
                            : "Produtor da loja"}
                        </small>
                        {event.notes && (
                          <p className="commerce-prewrap">{event.notes}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </article>
            </div>
            <div>
              <article className="commerce-card">
                <h2>Produtos do seu pedido</h2>
                <ul className="commerce-items order-items">
                  {order.items.map((item) => (
                    <li key={item.id}>
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.quantity} × {money(item.unitPriceCents)} ·{" "}
                          {item.netWeightGrams} g / {item.unitType}
                        </small>
                        <small>
                          {item.packaging.replaceAll("_", " ")}
                          {item.cutType
                            ? " · " + item.cutType.replaceAll("_", " ")
                            : ""}
                        </small>
                      </span>
                      <strong>{money(item.totalPriceCents)}</strong>
                    </li>
                  ))}
                </ul>
                <dl className="order-amounts">
                  <div>
                    <dt>Produtos</dt>
                    <dd>{money(order.subtotalCents)}</dd>
                  </div>
                  <div>
                    <dt>Entrega</dt>
                    <dd>{money(order.deliveryFeeCents)}</dd>
                  </div>
                  <div className="order-final-amount">
                    <dt>Total pago</dt>
                    <dd>{money(order.totalCents)}</dd>
                  </div>
                </dl>
              </article>
              {order.address && (
                <article className="commerce-card">
                  <h2>Endereço da entrega</h2>
                  <p>
                    {order.address.street}, {order.address.number}
                    {order.address.complement
                      ? " · " + order.address.complement
                      : ""}
                    <br />
                    {order.address.neighborhood} · {order.address.city}/
                    {order.address.state}
                    <br />
                    CEP {order.address.cep}
                  </p>
                  {order.address.deliveryNotes && (
                    <p className="commerce-prewrap">
                      {order.address.deliveryNotes}
                    </p>
                  )}
                </article>
              )}
              <article className="commerce-card">
                <h2>Comprovante e proteção</h2>
                {order.receivedAt && (
                  <p>Recebimento confirmado em {date(order.receivedAt)}.</p>
                )}
                <p>
                  {statusLabels[order.refundState ?? "held"] ??
                    "Valor protegido"}
                </p>
                <button
                  className="secondary"
                  onClick={() => onNavigate("/compras")}
                >
                  Ver minhas compras
                </button>
              </article>
            </div>
          </div>
        </>
      )}
    </>
  );
}
function List({
  userId,
  onNavigate,
}: {
  userId: string;
  onNavigate: (path: string) => void;
}) {
  const [page, setPage] = useState(1);
  const { data, error, refresh } = useOrderQuery(
    "/v1/orders?page=" + page,
    userId,
    OrderListResponseSchema,
  );
  return (
    <>
      <div className="order-heading">
        <div>
          <span className="order-eyebrow">
            <Leaf size={16} aria-hidden="true" /> Frescor a caminho
          </span>
          <h1>Meus pedidos</h1>
          <p>Acompanhe cada etapa do preparo até a entrega.</p>
        </div>
        <button className="secondary" onClick={refresh}>
          <RefreshCw size={16} aria-hidden="true" /> Atualizar
        </button>
      </div>
      <button className="text-button" onClick={() => onNavigate("/compras")}>
        Pagamentos, vendas presenciais e comprovantes
      </button>
      {error && (
        <p role="alert" className="commerce-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Carregando seus pedidos…</p>}
      {data && !data.orders.length && (
        <article className="commerce-card order-empty">
          <Leaf aria-hidden="true" />
          <h2>Sua próxima colheita começa aqui</h2>
          <p>Seus pedidos online aparecem após a confirmação do pagamento.</p>
          <button className="primary" onClick={() => onNavigate("/produtos")}>
            Explorar produtos
          </button>
        </article>
      )}
      {data && (
        <div className="order-customer-list">
          {data.orders.map((order) => (
            <article className="commerce-card order-card" key={order.id}>
              <span className={`commerce-tag order-status-${order.status}`}>
                {ORDER_STATUS_LABELS[order.status]}
              </span>
              <h2>{order.orderNumber}</h2>
              <p>{order.storeName}</p>
              <p>
                {order.itemCount}{" "}
                {order.itemCount === 1 ? "unidade" : "unidades"} ·{" "}
                <strong>{money(order.totalCents)}</strong>
              </p>
              <small>{date(order.createdAt)}</small>
              <div className="commerce-actions">
                <button
                  className="primary"
                  onClick={() => onNavigate("/pedidos/" + order.id)}
                >
                  Acompanhar pedido
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {data && data.pages > 1 && (
        <nav className="commerce-actions" aria-label="Paginação dos pedidos">
          <button
            className="secondary"
            disabled={data.page <= 1}
            onClick={() => setPage(data.page - 1)}
          >
            Anterior
          </button>
          <span>
            Página {data.page} de {data.pages}
          </span>
          <button
            className="secondary"
            disabled={data.page >= data.pages}
            onClick={() => setPage(data.page + 1)}
          >
            Próxima
          </button>
        </nav>
      )}
    </>
  );
}
export default function OrderTrackingPage({
  id,
  userId,
  onNavigate,
}: {
  id?: string;
  userId: string | null;
  onNavigate: (path: string) => void;
}) {
  return (
    <section className="hvm-commerce hvm-orders">
      {!userId ? (
        <>
          <h1>{id ? "Acompanhar pedido" : "Meus pedidos"}</h1>
          <article className="commerce-card">
            <p>Entre na sua conta para acompanhar seus pedidos.</p>
            <button
              className="primary"
              onClick={() => onNavigate("/entrar/consumidor")}
            >
              Entrar
            </button>
          </article>
        </>
      ) : id ? (
        <Detail id={id} userId={userId} onNavigate={onNavigate} />
      ) : (
        <List userId={userId} onNavigate={onNavigate} />
      )}
    </section>
  );
}
