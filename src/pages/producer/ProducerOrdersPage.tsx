import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Leaf,
  PackageCheck,
  RefreshCw,
  Truck,
} from "lucide-react";
import {
  OrderListResponseSchema,
  OrderStatusEnum,
  ORDER_STATUS_LABELS,
  type OrderStatus,
  type OrderSummary,
} from "../../../shared/contracts/order";
import { useOrderQuery } from "../../hooks/useOrderQuery";
import {
  clearPendingTransition,
  orderMessage,
  prepareTransition,
  readPendingTransition,
  sendOrderTransition,
  type PendingTransition,
} from "../../lib/orders";
import { money, date } from "../../lib/commerce";
import type { ApiFailure } from "../../lib/api";
import "../commerce/commerce.css";
import "../public/orders.css";
import { DeliveryProofModal } from "./DeliveryProofModal";
import { DeliveryAllocationModal } from "./DeliveryAllocationModal";
const actionLabels: Partial<Record<OrderStatus, string>> = {
  in_preparation: "Iniciar preparo",
  ready_for_dispatch: "Marcar como pronto",
  out_for_delivery: "Saiu para entrega",
  delivered: "Confirmar entrega",
};
export default function ProducerOrdersPage({
  userId,
  onNavigate,
}: {
  userId: string;
  onNavigate: (path: string) => void;
}) {
  const [filter, setFilter] = useState<OrderStatus | "all">("all"),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [pending, setPending] = useState<PendingTransition | null>(() =>
      readPendingTransition(userId),
    ),
    [cancelling, setCancelling] = useState<OrderSummary | null>(null),
    [reason, setReason] = useState(""),
    [proofOrder,setProofOrder]=useState<OrderSummary|null>(null),
    [allocationOrder,setAllocationOrder]=useState<OrderSummary|null>(null);
  const flight = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  const {
    data,
    error: readError,
    refresh,
  } = useOrderQuery(
    `/v1/producer/orders?page=${page}&status=${filter}${new URLSearchParams(location.search).get("orderId")?"&orderId="+encodeURIComponent(new URLSearchParams(location.search).get("orderId")!):""}`,
    userId,
    OrderListResponseSchema,
  );
  useEffect(() => {
    if (cancelling) dialog.current?.showModal();
    else dialog.current?.close();
  }, [cancelling]);
  async function send(command: PendingTransition) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    setPending(command);
    try {
      const order = await sendOrderTransition(userId, command);
      setPending(null);
      setCancelling(null);
      setReason("");
      setSuccess(
        `${order.orderNumber}: ${ORDER_STATUS_LABELS[order.status].toLowerCase()}.`,
      );
      refresh();
    } catch (e) {
      setError(orderMessage(e));
      setCancelling(null);
      const status = (e as ApiFailure).status ?? 0;
      if (status >= 400 && status < 500 && status !== 401 && status !== 429) {
        clearPendingTransition(userId);
        setPending(null);
        setCancelling(null);
        refresh();
      }
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  function advance(order: OrderSummary, toStatus: OrderStatus) {
    if (flight.current || pending) return;
    if (toStatus === "delivered") { setProofOrder(order); return; }
    void send(
      prepareTransition(userId, order.id, {
        expectedRevision: order.revision,
        toStatus,
      }),
    );
  }
  function cancel(event: FormEvent) {
    event.preventDefault();
    if (!cancelling || flight.current || pending) return;
    void send(
      prepareTransition(userId, cancelling.id, {
        expectedRevision: cancelling.revision,
        toStatus: "cancelled",
        notes: reason.trim(),
      }),
    );
  }
  return (
    <section className="hvm-commerce hvm-orders">
      <div className="order-heading">
        <div>
          <span className="order-eyebrow">
            <Leaf size={16} aria-hidden="true" /> Da sua horta à mesa
          </span>
          <h1>Pedidos da minha loja</h1>
          <p>
            Acompanhe o preparo e avance cada pedido conforme o trabalho é
            concluído.
          </p>
        </div>
        <button className="secondary" onClick={refresh} disabled={busy}>
          <RefreshCw size={17} aria-hidden="true" /> Atualizar
        </button>
      </div>
      <button className="secondary" onClick={()=>onNavigate("/produtor/vendas")}>Minhas vendas</button>
      {new URLSearchParams(location.search).has("orderId")&&<button className="text-button" onClick={()=>onNavigate("/produtor/pedidos")}>Ver todos os pedidos da loja</button>}
      <nav className="commerce-section-links" aria-label="Gestão da loja">
        <button
          className="text-button"
          onClick={() => onNavigate("/produtor/loja")}
        >
          Minha loja
        </button>
        <button
          className="text-button"
          onClick={() => onNavigate("/produtor/caixa")}
        >
          Caixa do produtor
        </button>
      </nav>
      <button className="text-button" onClick={()=>onNavigate("/produtor/loja/janelas")}>Janelas de entrega</button>
      <div className="order-statistics">
        <article>
          <PackageCheck aria-hidden="true" />
          <span>
            <strong>
              {(data?.counts.confirmed ?? 0) +
                (data?.counts.in_preparation ?? 0)}
            </strong>{" "}
            A preparar
          </span>
        </article>
        <article>
          <Truck aria-hidden="true" />
          <span>
            <strong>
              {(data?.counts.ready_for_dispatch ?? 0) +
                (data?.counts.out_for_delivery ?? 0)}
            </strong>{" "}
            Em entrega
          </span>
        </article>
        <article>
          <CheckCircle2 aria-hidden="true" />
          <span>
            <strong>{data?.counts.delivered ?? 0}</strong> Entregues
          </span>
        </article>
      </div>
      <div
        className="order-filters"
        role="group"
        aria-label="Filtrar pedidos por etapa"
      >
        {(["all", ...OrderStatusEnum.options] as const).map((status) => (
          <button
            key={status}
            className="secondary"
            aria-pressed={filter === status}
            disabled={busy}
            onClick={() => {
              setFilter(status);
              setPage(1);
            }}
          >
            {status === "all" ? "Todos" : ORDER_STATUS_LABELS[status]}
            {status !== "all" && data ? ` (${data.counts[status]})` : ""}
          </button>
        ))}
      </div>
      {(error || readError) && (
        <p role="alert" className="commerce-error">
          {error || readError}
        </p>
      )}
      {success && (
        <p role="status" className="order-success">
          {success}
        </p>
      )}
      {pending && (
        <aside className="commerce-card">
          <p>
            Há uma atualização aguardando confirmação. Reenvie para conferir o
            resultado.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void send(pending)}
          >
            {busy ? "Conferindo…" : "Reenviar atualização pendente"}
          </button>
        </aside>
      )}
      {!data && !readError && <p role="status">Carregando pedidos…</p>}
      {data && !data.orders.length && (
        <article className="commerce-card order-empty">
          <Leaf aria-hidden="true" />
          <h2>Nenhum pedido nesta etapa</h2>
          <p>Os pedidos online aparecem após a confirmação do pagamento.</p>
          {filter !== "all" && (
            <button
              className="secondary"
              onClick={() => {
                setFilter("all");
                setPage(1);
              }}
            >
              Ver todos os pedidos
            </button>
          )}
        </article>
      )}
      {!!data?.orders.length && (
        <div className="order-board">
          {OrderStatusEnum.options
            .filter((status) =>
              data.orders.some((order) => order.status === status),
            )
            .map((status) => (
              <section
                className="order-column"
                key={status}
                aria-label={ORDER_STATUS_LABELS[status]}
              >
                <h2>{ORDER_STATUS_LABELS[status]}</h2>
                {data.orders
                  .filter((order) => order.status === status)
                  .map((order) => {
                    const next = order.allowedTransitions.find(
                      (value) => value !== "cancelled",
                    );
                    return (
                      <article
                        className="commerce-card order-card"
                        key={order.id}
                      >
                        <span
                          className={`commerce-tag order-status-${order.status}`}
                        >
                          {ORDER_STATUS_LABELS[order.status]}
                        </span>
                        <h3>{order.orderNumber}</h3>
                        <p>
                          {order.itemCount}{" "}
                          {order.itemCount === 1 ? "unidade" : "unidades"} ·{" "}
                          <strong>{money(order.totalCents)}</strong>
                        </p>
                        <small>{date(order.createdAt)}</small>
                        {order.commercialStatus === "refunded" && (
                          <p>Reembolso confirmado. Preparo encerrado.</p>
                        )}
                        {order.cancellationReason && (
                          <p className="commerce-prewrap">
                            {order.cancellationReason}
                          </p>
                        )}
                        <div className="commerce-actions">
                          {next && (
                            <button
                              className="primary"
                              disabled={busy || !!pending}
                              onClick={() => advance(order, next)}
                            >
                              {actionLabels[next]}
                              <ArrowRight size={16} aria-hidden="true" />
                            </button>
                          )}
                          <button
                            className="secondary"
                            onClick={() => onNavigate("/pedidos/" + order.id)}
                          >
                            Ver pedido
                          </button>
                          {order.status==="ready_for_dispatch"&&<button className="secondary" disabled={busy||!!pending} onClick={()=>setAllocationOrder(order)}>Agendar entrega</button>}
                  {order.allowedTransitions.includes("cancelled") && (
                            <button
                              className="text-button order-danger"
                              disabled={busy || !!pending}
                              onClick={() => {
                                setReason("");
                                setCancelling(order);
                              }}
                            >
                              Cancelar pedido
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
              </section>
            ))}
        </div>
      )}
      {data && data.pages > 1 && (
        <nav className="commerce-actions" aria-label="Paginação dos pedidos">
          <button
            className="secondary"
            disabled={data.page <= 1 || busy}
            onClick={() => setPage(data.page - 1)}
          >
            Anterior
          </button>
          <span>
            Página {data.page} de {data.pages}
          </span>
          <button
            className="secondary"
            disabled={data.page >= data.pages || busy}
            onClick={() => setPage(data.page + 1)}
          >
            Próxima
          </button>
        </nav>
      )}
      <dialog
        ref={dialog}
        className="order-cancel-dialog"
        aria-labelledby="order-cancel-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setCancelling(null);
        }}
      >
        <form onSubmit={cancel}>
          <h2 id="order-cancel-title">Cancelar {cancelling?.orderNumber}</h2>
          <p>
            Os produtos retornam ao estoque. O valor permanece protegido
            enquanto o reembolso é analisado.
          </p>
          <label>
            Motivo do cancelamento
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={10}
              maxLength={500}
              required
              disabled={busy}
            />
          </label>
          <small>{reason.trim().length}/500 caracteres</small>
          <div className="commerce-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setCancelling(null)}
            >
              Voltar
            </button>
            <button
              className="primary"
              type="submit"
              disabled={busy || !!pending || reason.trim().length < 10}
            >
              {busy ? "Cancelando…" : "Confirmar cancelamento"}
            </button>
          </div>
        </form>
      </dialog>
      {proofOrder&&<DeliveryProofModal key={proofOrder.id} order={proofOrder} onClose={()=>setProofOrder(null)} onSaved={()=>{setProofOrder(null);setSuccess("Entrega confirmada com prova de recebimento.");refresh();}}/>}
      {allocationOrder&&<DeliveryAllocationModal key={allocationOrder.id} userId={userId} order={allocationOrder} onClose={()=>{setAllocationOrder(null);refresh();}}/>}
    </section>
  );
}
