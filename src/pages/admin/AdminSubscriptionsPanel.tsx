import { useCallback, useEffect, useRef, useState } from "react";
import { useAutomaticQueryRefresh } from "../../hooks/useAutomaticQueryRefresh";
import { api, type ApiFailure } from "../../lib/api";
import { money } from "../../lib/commerce";
import {
  subscriptionMessage,
  subscriptionLabels,
} from "../../lib/subscriptions";
import type { ShellSession } from "../../hooks/useSession";
import { usePortalSession } from "../../components/notifications/NotificationProvider";
import {
  AdminCommandConfirmation,
  useAdminConfirmedCommand,
} from "./useAdminConfirmedCommand";
import type {
  SubscriptionPlan,
  SubscriptionView,
} from "../../../shared/contracts/subscription";
import type { SubscriptionCancellationQuote } from "../../../shared/contracts/subscriptionRefund";
import "../commerce/departmentExtensions.css";

type Item = {
  id: string;
  status: SubscriptionView["status"];
  revision: number;
  plan: SubscriptionPlan;
  holder: string;
  accountDeleted: boolean;
  paidAmountCents: number;
  currentPeriodEnd: string;
  createdAt: string;
};
export function AdminSubscriptionsPanel() {
  const session = usePortalSession();
  if (!session) return null;
  return (
    <ScopedAdminSubscriptionsPanel
      key={`${session.userId}:${session.activeRole}`}
      session={session}
    />
  );
}
function ScopedAdminSubscriptionsPanel({ session }: { session: ShellSession }) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [audience, setAudience] = useState("all"),
    [tick, setTick] = useState(0);
  const [result, setResult] = useState<{
      subscriptions: Item[];
      total: number;
    } | null>(null),
    [detail, setDetail] = useState<{
      subscription: SubscriptionView;
      cancellation: SubscriptionCancellationQuote;
    } | null>(null);
  const [note, setNote] = useState(""),
    [reading, setReading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const lifecycle = useRef<AbortController | null>(null);
  useEffect(() => {
    lifecycle.current = new AbortController();
    return () => {
      lifecycle.current?.abort();
    };
  }, []);
  function failed(e: unknown) {
    setError(subscriptionMessage(e));
    if ([401, 403].includes((e as ApiFailure).status ?? 0)) {
      setResult(null);
      setDetail(null);
    }
  }
  const command = useAdminConfirmedCommand(session.activeRole ?? null, failed);
  const busy = reading || command.busy,
    reauth = Boolean(command.confirmation);
  const flight = useRef(false),
    pending = useRef<{ key: string; id: string } | null>(null);
  const automaticRefresh = useCallback(() => setTick((v) => v + 1), []);
  useAutomaticQueryRefresh(automaticRefresh, !busy && !reauth);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    void api<{ subscriptions: Item[]; total: number }>(
      "/v1/admin/subscriptions?" +
        new URLSearchParams({ page: String(page), search, status, audience }),
      { signal: c.signal },
    )
      .then((v) => {
        if (!c.signal.aborted) setResult(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) failed(e);
      });
    return () => c.abort();
  }, [page, search, status, audience, tick, session?.userId]);
  async function open(id: string) {
    if (
      flight.current ||
      busy ||
      reauth ||
      !lifecycle.current ||
      lifecycle.current.signal.aborted
    )
      return;
    flight.current = true;
    setReading(true);
    setError("");
    try {
      const v = await api<{
        subscription: SubscriptionView;
        cancellation: SubscriptionCancellationQuote;
      }>(`/v1/admin/subscriptions/${id}`, {
        signal: AbortSignal.any([
          lifecycle.current.signal,
          AbortSignal.timeout(20000),
        ]),
      });
      if (lifecycle.current.signal.aborted) return;
      setDetail(v);
      setNote("");
    } catch (e) {
      if (!lifecycle.current.signal.aborted) failed(e);
    } finally {
      flight.current = false;
      if (!lifecycle.current.signal.aborted) setReading(false);
    }
  }
  async function cancel(form: HTMLFormElement) {
    if (!detail || flight.current || busy || reauth) return;
    const body = { expectedRevision: detail.cancellation.revision, note };
    const key = detail.subscription.id + JSON.stringify(body);
    if (pending.current?.key !== key)
      pending.current = { key, id: crypto.randomUUID() };
    const commandId = pending.current.id;
    const path = `/v1/admin/subscriptions/${detail.subscription.id}/cancel`;
    setError("");
    await command.run(async (signal) => {
      await api(path, {
        method: "POST",
        headers: { "X-Command-Id": commandId },
        body: JSON.stringify(body),
        signal,
      });
      if (signal.aborted) return;
      pending.current = null;
      setDetail(null);
      setTick((v) => v + 1);
      setNotice(
        "Assinatura cancelada. Solicitações elegíveis foram encaminhadas a Reembolsos; nenhum estorno foi simulado.",
      );
      form.dispatchEvent(new Event("hvm:form-saved", { bubbles: true }));
      window.dispatchEvent(new Event("hvm:departments-changed"));
    });
  }
  return (
    <section className="department-extension">
      <h2>Contratos e cancelamentos</h2>
      <p>
        Consulte assinaturas de consumidores e produtores. Cancelamentos
        interrompem novos ciclos; aprovação e confirmação financeira de
        devoluções são feitas em Reembolsos.
      </p>
      <div className="department-extension-filters">
        <label>
          Buscar contrato ou titular
          <input
            type="search"
            maxLength={80}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Estado
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">Todos</option>
            {Object.entries(subscriptionLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Público
          <select
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">Todos</option>
            <option value="consumer">Consumidor</option>
            <option value="producer">Produtor</option>
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <AdminCommandConfirmation
        confirmation={command.confirmation}
        onConfirmed={command.confirm}
        onCancel={command.cancel}
      />
      {detail && (
        <form
          data-hvm-update-busy="true"
          onSubmit={(e) => {
            e.preventDefault();
            void cancel(e.currentTarget);
          }}
        >
          <h3>{detail.subscription.plan.name}</h3>
          <p>{detail.cancellation.explanation}</p>
          <p>
            Confirmado: {money(detail.cancellation.paidAmountCents)} · Elegível
            para análise: {money(detail.cancellation.eligibleAmountCents)} ·
            Política {detail.cancellation.policy.version}
          </p>
          <p>{detail.cancellation.policy.additionalTerms}</p>
          {detail.subscription.cycles.map((c) => (
            <p key={c.id}>
              Ciclo {c.cycleIndex} · {money(c.amountCents)} · {c.status}
            </p>
          ))}
          {detail.subscription.status !== "cancelled" && (
            <>
              <label>
                Justificativa do cancelamento
                <textarea
                  minLength={10}
                  maxLength={2000}
                  required
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <button
                className="admin-primary"
                disabled={busy || reauth || note.trim().length < 10}
              >
                Confirmar cancelamento do contrato
              </button>
            </>
          )}
          <button
            className="admin-secondary"
            type="button"
            disabled={busy}
            onClick={() => setDetail(null)}
          >
            Fechar contrato
          </button>
        </form>
      )}
      {!result && !error && <p role="status">Carregando contratos…</p>}
      {result && (
        <>
          <p>{result.total} contratos encontrados</p>
          <div className="department-extension-grid">
            {result.subscriptions.map((s) => (
              <article key={s.id} className="department-extension-card">
                <h3>{s.plan.name}</h3>
                <p>
                  {s.holder} ·{" "}
                  {s.plan.targetAudience === "producer"
                    ? "Produtor"
                    : "Consumidor"}
                </p>
                <p>
                  {subscriptionLabels[s.status]} · {money(s.paidAmountCents)} em
                  ciclos pagos
                </p>
                <p>
                  Fim do período:{" "}
                  {new Date(s.currentPeriodEnd).toLocaleDateString("pt-BR")}
                </p>
                {s.accountDeleted ? (
                  <p>Conta excluída — registro contábil com acesso restrito.</p>
                ) : (
                  <button
                    className="admin-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => void open(s.id)}
                  >
                    Consultar contrato e cancelamento
                  </button>
                )}
              </article>
            ))}
          </div>
          {!result.total && (
            <p>
              Nenhuma assinatura neste filtro. Os planos podem ser preparados
              antes de conectar o provedor.
            </p>
          )}
          <div className="department-extension-actions">
            <button
              className="admin-secondary"
              disabled={page <= 1}
              onClick={() => setPage((v) => v - 1)}
            >
              Anterior
            </button>
            <span>Página {page}</span>
            <button
              className="admin-secondary"
              disabled={page * 20 >= result.total}
              onClick={() => setPage((v) => v + 1)}
            >
              Próxima
            </button>
          </div>
        </>
      )}
    </section>
  );
}
