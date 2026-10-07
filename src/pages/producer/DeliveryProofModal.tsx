import { useEffect, useRef, useState, type FormEvent } from "react";
import { DeliveryProofSchema } from "../../../shared/contracts/deliveryLogistics";
import {
  OrderResponseSchema,
  type OrderSummary,
} from "../../../shared/contracts/order";
import { api, type ApiFailure } from "../../lib/api";
import { deliveryMessage } from "../../lib/deliveryLogistics";
import { enqueueCommand,offlineTransport } from "../../lib/offlineDb";
import "./deliveryLogistics.css";
export function DeliveryProofModal({
  order,
  onClose,
  onSaved,
  userId,
}: {
  order: OrderSummary;
  onClose: () => void;
  onSaved: (queued?:boolean) => void;
  userId: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    flight = useRef(false),
    pending = useRef<{ body: string; id: string } | null>(null);
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [coords, setCoords] = useState<{
      latitude: number;
      longitude: number;
    } | null>(null),
    [locating, setLocating] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flight.current) return;
    const fd = new FormData(event.currentTarget),
      digits = String(fd.get("digits") ?? "").trim(),
      notes = String(fd.get("notes") ?? "").trim();
    const value = DeliveryProofSchema.safeParse({
      expectedRevision: order.revision,
      receivedByName: String(fd.get("name") ?? ""),
      ...(digits ? { receiverDocumentLastDigits: digits } : {}),
      ...(notes ? { notes } : {}),
      ...coords,
    });
    if (!value.success) {
      setError(
        "Informe o nome de quem recebeu, com pelo menos 2 caracteres. O documento opcional aceita somente 3 dígitos.",
      );
      return;
    }
    const body = JSON.stringify(value.data);
    if (pending.current && pending.current.body !== body) {
      setError(
        "Reenvie os dados anteriores para confirmar o resultado antes de editar.",
      );
      return;
    }
    pending.current ??= { body, id: crypto.randomUUID() };
    flight.current = true;
    setBusy(true);
    setError("");
    async function queue() {
      await enqueueCommand(userId,{commandId:pending.current!.id,commandType:"delivery.proof",baseRevision:order.revision,payload:{orderId:order.id,proof:value.data!}});
      pending.current=null;onSaved(true);
    }
    try {
      if(!navigator.onLine){await queue();return;}
      OrderResponseSchema.parse(
        await api(`/v1/producer/orders/${order.id}/delivery-proof`, {
          method: "POST",
          headers: { "X-Command-Id": pending.current.id },
          body,
        }),
      );
      pending.current = null;
      onSaved();
    } catch (e) {
      if(offlineTransport(e)){try{await queue();}catch{setError("Não foi possível salvar a confirmação neste aparelho. Seus dados permanecem no formulário.");}return;}
      setError(deliveryMessage(e));
      const status = (e as ApiFailure).status ?? 0;
      if (status >= 400 && status < 500 && status !== 401 && status !== 429)
        pending.current = null;
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  function locate() {
    if (!navigator.geolocation) {
      setError("A localização não está disponível neste dispositivo.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCoords({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
        });
        setLocating(false);
      },
      () => {
        setError(
          "Localização não obtida. Você pode confirmar a entrega sem coordenadas.",
        );
        setLocating(false);
      },
      { timeout: 8000, maximumAge: 60000 },
    );
  }
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
        <h2>Confirmar entrega</h2>
        <p>{order.orderNumber} · Registre quem recebeu o pedido.</p>
        {error && (
          <p role="alert" className="commerce-error">
            {error}
          </p>
        )}
        <label>
          Nome de quem recebeu
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            minLength={2}
            maxLength={128}
            required
            autoFocus
          />
        </label>
        <label>
          Últimos 3 dígitos do documento (opcional)
          <input
            name="digits"
            inputMode="numeric"
            pattern="[0-9]{3}"
            maxLength={3}
          />
        </label>
        <label>
          Observações (opcional)
          <textarea name="notes" maxLength={500} />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={busy || locating || !!pending.current}
          onClick={locate}
        >
          {locating
            ? "Obtendo localização…"
            : coords
              ? "Localização incluída"
              : "Incluir localização atual (opcional)"}
        </button>
        <div className="commerce-actions">
          <button
            className="primary"
            disabled={busy || locating || name.trim().length < 2}
          >
            {busy
              ? "Confirmando…"
              : pending.current
                ? "Reenviar confirmação"
                : "Confirmar entrega"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || !!pending.current}
            onClick={onClose}
          >
            Voltar
          </button>
        </div>
      </form>
    </dialog>
  );
}
