import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AllocateDeliverySchema,
  DeliveryTrackingResponseSchema,
  DeliveryWindowsResponseSchema,
} from "../../../shared/contracts/deliveryLogistics";
import type { OrderSummary } from "../../../shared/contracts/order";
import { useOrderQuery } from "../../hooks/useOrderQuery";
import { api, type ApiFailure } from "../../lib/api";
import { deliveryMessage } from "../../lib/deliveryLogistics";
import "./deliveryLogistics.css";
export function DeliveryAllocationModal({
  order,
  userId,
  onClose,
}: {
  order: OrderSummary;
  userId: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    flight = useRef(false),
    pending = useRef<{ body: string; id: string } | null>(null);
  const [date, setDate] = useState(""),
    [windowId, setWindowId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const {
    data,
    error: readError,
    refresh,
  } = useOrderQuery(
    "/v1/producer/delivery-windows" + (date ? "?date=" + date : ""),
    userId,
    DeliveryWindowsResponseSchema,
  );
  const {
    data: tracking,
    error: trackingError,
    refresh: refreshTracking,
  } = useOrderQuery(
    `/v1/orders/${order.id}/delivery`,
    userId,
    DeliveryTrackingResponseSchema,
  );
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (flight.current || !data) return;
    const parsed = AllocateDeliverySchema.safeParse({
      windowId,
      scheduledDate: date || data.date,
      expectedRevision: order.revision,
    });
    if (!parsed.success) {
      setError("Escolha a data e uma janela com vaga.");
      return;
    }
    const body = JSON.stringify(parsed.data);
    if (pending.current && pending.current.body !== body) {
      setError(
        "Reenvie o agendamento anterior para confirmar o resultado antes de editar.",
      );
      return;
    }
    pending.current ??= { body, id: crypto.randomUUID() };
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/v1/producer/orders/${order.id}/delivery-allocation`, {
        method: "POST",
        headers: { "X-Command-Id": pending.current.id },
        body,
      });
      pending.current = null;
      onClose();
    } catch (e) {
      setError(deliveryMessage(e));
      const status = (e as ApiFailure).status ?? 0;
      if (status >= 400 && status < 500 && status !== 401 && status !== 429) {
        pending.current = null;
        refresh();
        refreshTracking();
      }
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  const chosen = date || data?.date || "",
    day = chosen ? new Date(chosen + "T12:00:00Z").getUTCDay() : -1,
    available =
      data?.windows.filter((w) => w.isActive && w.dayOfWeek === day) ?? [];
  return (
    <dialog
      ref={dialog}
      className="order-dialog logistics-dialog"
      onCancel={(e) => {
        if (busy || pending.current) e.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={save} className="logistics-form">
        <h2>Agendar entrega</h2>
        <p>{order.orderNumber}</p>
        {(error || readError || trackingError) && (
          <p role="alert" className="commerce-error">
            {error || readError || trackingError}
          </p>
        )}
        {tracking?.allocation ? (
          <p role="status">
            Entrega agendada para{" "}
            {tracking.allocation.scheduledDate.split("-").reverse().join("/")},{" "}
            {tracking.allocation.startTime}–{tracking.allocation.endTime} (
            {tracking.allocation.timezone}).
          </p>
        ) : (
          <>
            <label>
              Data da entrega
              <input
                type="date"
                value={chosen}
                min={data?.today}
                required
                disabled={busy || !!pending.current}
                onChange={(e) => {
                  setDate(e.target.value);
                  setWindowId("");
                }}
              />
            </label>
            <label>
              Janela disponível
              <select
                required
                value={windowId}
                disabled={!data || busy || !!pending.current}
                onChange={(e) => setWindowId(e.target.value)}
              >
                <option value="">Selecione um horário</option>
                {available.map((w) => (
                  <option
                    key={w.id}
                    value={w.id}
                    disabled={w.allocatedCount >= w.maxOrdersCapacity}
                  >
                    {w.startTime}–{w.endTime} ·{" "}
                    {w.allocatedCount >= w.maxOrdersCapacity
                      ? "Lotada"
                      : `${w.maxOrdersCapacity - w.allocatedCount} vagas`}
                  </option>
                ))}
              </select>
            </label>
            {data && !available.length && (
              <p>
                Nenhuma janela ativa nesse dia. Configure as janelas da loja ou
                escolha outra data.
              </p>
            )}
            <p>Horários em {data?.timezone ?? "…"}.</p>
            <button
              className="primary"
              disabled={busy || !data || !tracking || !windowId}
            >
              {busy
                ? "Agendando…"
                : pending.current
                  ? "Reenviar agendamento"
                  : "Reservar vaga"}
            </button>
          </>
        )}
        <button
          type="button"
          className="secondary"
          disabled={busy || !!pending.current}
          onClick={onClose}
        >
          Voltar
        </button>
      </form>
    </dialog>
  );
}
