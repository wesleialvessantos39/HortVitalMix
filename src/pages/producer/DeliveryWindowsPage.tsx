import { PageLoading } from "../../components/PageLoading";
import { useRef, useState, type FormEvent } from "react";
import {
  DeliveryWindowSchema,
  DeliveryWindowUpdateSchema,
  DeliveryWindowsResponseSchema,
  type DeliveryWindow,
} from "../../../shared/contracts/deliveryLogistics";
import { useOrderQuery } from "../../hooks/useOrderQuery";
import { api, type ApiFailure } from "../../lib/api";
import { deliveryMessage, weekdays } from "../../lib/deliveryLogistics";
import "../commerce/commerce.css";
import "./deliveryLogistics.css";
export default function DeliveryWindowsPage({
  userId,
  onNavigate,
}: {
  userId: string;
  onNavigate: (path: string) => void;
}) {
  const [date, setDate] = useState(""),
    [editing, setEditing] = useState<DeliveryWindow | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const pending = useRef<{ body: string; path: string; id: string } | null>(
      null,
    ),
    flight = useRef(false);
  const {
    data,
    error: readError,
    refresh,
  } = useOrderQuery(
    "/v1/producer/delivery-windows" + (date ? "?date=" + date : ""),
    userId,
    DeliveryWindowsResponseSchema,
  );
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flight.current) return;
    const form = event.currentTarget,
      fd = new FormData(form),
      input = {
        dayOfWeek: Number(fd.get("dayOfWeek")),
        startTime: String(fd.get("startTime")),
        endTime: String(fd.get("endTime")),
        maxOrdersCapacity: Number(fd.get("maxOrdersCapacity")),
        isActive: fd.get("isActive") === "on",
        ...(editing ? { expectedRevision: editing.revision } : {}),
      };
    const parsed = (
      editing ? DeliveryWindowUpdateSchema : DeliveryWindowSchema
    ).safeParse(input);
    if (!parsed.success) {
      setError(
        "Informe um horário final depois do início e uma capacidade positiva de pedidos.",
      );
      return;
    }
    const body = JSON.stringify(parsed.data),
      path =
        "/v1/producer/delivery-windows" + (editing ? "/" + editing.id : "");
    if (
      pending.current &&
      (pending.current.body !== body || pending.current.path !== path)
    ) {
      setError(
        "Reenvie os dados da tentativa anterior antes de editar a ação.",
      );
      return;
    }
    pending.current ??= { body, path, id: crypto.randomUUID() };
    flight.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api(path, {
        method: editing ? "PATCH" : "POST",
        headers: { "X-Command-Id": pending.current.id },
        body,
      });
      pending.current = null;
      setSuccess(editing ? "Janela atualizada." : "Janela criada.");
      setEditing(null);
      form.reset();
      refresh();
    } catch (e) {
      setError(deliveryMessage(e));
      const status = (e as ApiFailure).status ?? 0;
      if (status >= 400 && status < 500 && status !== 429 && status !== 401)
        pending.current = null;
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="hvm-commerce hvm-logistics">
      <button
        className="text-button"
        onClick={() => onNavigate("/produtor/pedidos")}
      >
        ← Pedidos da minha loja
      </button>
      <h1>Janelas de entrega</h1>
      <p>
        Defina os horários da semana e o limite de pedidos por dia. As vagas são
        reservadas ao agendar um pedido pronto.
      </p>
      {(error || readError) && (
        <p role="alert" className="commerce-error">
          {error || readError}
        </p>
      )}
      {success && <p role="status">{success}</p>}
      <div className="logistics-grid">
        <form
          key={editing?.id ?? "new"}
          className="commerce-card logistics-form"
          onSubmit={save}
        >
          <h2>{editing ? "Editar janela" : "Nova janela"}</h2>
          <label>
            Dia da semana
            <select
              name="dayOfWeek"
              defaultValue={editing?.dayOfWeek ?? 1}
              required
            >
              {weekdays.map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label>
            Início
            <input
              name="startTime"
              type="time"
              defaultValue={editing?.startTime ?? "08:00"}
              required
            />
          </label>
          <label>
            Fim
            <input
              name="endTime"
              type="time"
              defaultValue={editing?.endTime ?? "12:00"}
              required
            />
          </label>
          <label>
            Capacidade por data
            <input
              name="maxOrdersCapacity"
              type="number"
              min="1"
              max="2147483647"
              defaultValue={editing?.maxOrdersCapacity ?? 15}
              required
            />
          </label>
          <label className="logistics-check">
            <input
              name="isActive"
              type="checkbox"
              defaultChecked={editing?.isActive ?? true}
            />
            Ativa para novos agendamentos
          </label>
          <button className="primary" disabled={busy}>
            {busy
              ? "Salvando…"
              : pending.current
                ? "Reenviar janela"
                : "Salvar janela"}
          </button>
          {editing && (
            <button
              type="button"
              className="secondary"
              disabled={busy || !!pending.current}
              onClick={() => setEditing(null)}
            >
              Cancelar edição
            </button>
          )}
        </form>
        <div>
          <label className="logistics-date">
            Consultar vagas na data
            <input
              type="date"
              value={date || data?.date || ""}
              min={data?.today}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {data && <p>Horários em {data.timezone}.</p>}
          {!data && !readError && <PageLoading label="Carregando janelas…" compact />}
          {data &&
            weekdays.map((day, i) => (
              <article className="commerce-card" key={day}>
                <h2>{day}</h2>
                {!data.windows.some((w) => w.dayOfWeek === i) && (
                  <p>Sem janelas cadastradas.</p>
                )}
                {data.windows
                  .filter((w) => w.dayOfWeek === i)
                  .map((w) => (
                    <div className="logistics-window" key={w.id}>
                      <span>
                        <strong>
                          {w.startTime}–{w.endTime}
                        </strong>
                        <small>
                          {w.isActive ? "Ativa" : "Pausada"} · Capacidade:{" "}
                          {w.maxOrdersCapacity}
                        </small>
                        {new Date(data.date + "T12:00:00Z").getUTCDay() ===
                          i && (
                          <small>
                            {w.allocatedCount >= w.maxOrdersCapacity
                              ? "Lotada"
                              : `${w.maxOrdersCapacity - w.allocatedCount} vagas livres`}{" "}
                            · {w.allocatedCount} reservadas em{" "}
                            {data.date.split("-").reverse().join("/")}
                          </small>
                        )}
                      </span>
                      <button
                        className="secondary"
                        disabled={busy || !!pending.current}
                        onClick={() => {
                          setEditing(w);
                          setError("");
                        }}
                      >
                        Editar janela
                      </button>
                    </div>
                  ))}
              </article>
            ))}
        </div>
      </div>
    </section>
  );
}
