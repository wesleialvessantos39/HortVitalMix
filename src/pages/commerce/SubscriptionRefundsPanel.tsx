import { useCallback, useEffect, useRef, useState } from "react";
import { useAutomaticQueryRefresh } from "../../hooks/useAutomaticQueryRefresh";
import { api, type ApiFailure } from "../../lib/api";
import { money, commerceMessage, statusLabels } from "../../lib/commerce";
import type { SubscriptionRefundView } from "../../../shared/contracts/subscriptionRefund";
import type { ShellSession } from "../../hooks/useSession";
import { usePortalSession } from "../../components/notifications/NotificationProvider";
import {
  AdminCommandConfirmation,
  useAdminConfirmedCommand,
} from "../admin/useAdminConfirmedCommand";
import "./departmentExtensions.css";

type Result = {
  refunds: SubscriptionRefundView[];
  pages: number;
  total: number;
  gatewayAvailable: boolean;
};
export function SubscriptionRefundsPanel({
  administrative = false,
}: {
  administrative?: boolean;
}) {
  const session = usePortalSession();
  if (!session) return null;
  return (
    <ScopedSubscriptionRefundsPanel
      key={`${session.userId}:${session.activeRole}:${administrative}`}
      session={session}
      administrative={administrative}
    />
  );
}
function ScopedSubscriptionRefundsPanel({
  session,
  administrative,
}: {
  session: ShellSession;
  administrative: boolean;
}) {
  const [data, setData] = useState<Result | null>(null),
    [error, setError] = useState("");
  const [status, setStatus] = useState("all"),
    [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<SubscriptionRefundView | null>(null),
    [note, setNote] = useState(""),
    [amount, setAmount] = useState("");
  const [publicBusy, setPublicBusy] = useState(false);
  const lifecycle = useRef<AbortController | null>(null);
  useEffect(() => {
    lifecycle.current = new AbortController();
    return () => {
      lifecycle.current?.abort();
    };
  }, []);
  const command = useAdminConfirmedCommand(session.activeRole ?? null, (e) => {
    setError(commerceMessage(e));
    if ([401, 403].includes((e as ApiFailure).status ?? 0)) {
      setData(null);
      setSelected(null);
    }
  });
  const busy = publicBusy || command.busy,
    reauth = Boolean(command.confirmation);
  const pending = useRef<{ key: string; id: string } | null>(null),
    flight = useRef(false);
  const prefix = administrative
    ? "/v1/admin/subscription-refunds"
    : "/v1/subscription-refunds";
  const automaticRefresh = useCallback(() => setAttempt((v) => v + 1), []);
  useAutomaticQueryRefresh(automaticRefresh, !busy && !reauth);
  useEffect(() => {
    const refresh = () => setAttempt((v) => v + 1);
    window.addEventListener("hvm:subscription-refunds-changed", refresh);
    return () =>
      window.removeEventListener("hvm:subscription-refunds-changed", refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api<Result>(`${prefix}?status=${status}&page=${page}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(commerceMessage(e));
          if ([401, 403].includes((e as ApiFailure).status ?? 0)) {
            setData(null);
            setSelected(null);
          }
        }
      });
    return () => controller.abort();
  }, [prefix, status, page, attempt, session?.userId]);
  async function action(action: string) {
    if (!selected || flight.current || busy || reauth) return;
    if (action !== "process" && note.trim().length < 10) {
      setError("Descreva a ação com pelo menos 10 caracteres.");
      return;
    }
    const parsedAmount = Math.round(Number(amount.replace(",", ".")) * 100);
    if (
      action === "approved" &&
      (!/^\d+(?:[.,]\d{1,2})?$/.test(amount) ||
        parsedAmount < 1 ||
        parsedAmount > selected.requestedAmountCents)
    ) {
      setError("O valor aprovado deve respeitar o valor solicitado.");
      return;
    }
    const body =
      action === "message"
        ? { note }
        : action === "process"
          ? {}
          : {
              expectedRevision: selected.revision,
              decision: action,
              note,
              ...(action === "approved" ? { amountCents: parsedAmount } : {}),
            };
    const path = `${prefix}/${selected.id}/${action === "message" ? "messages" : action === "process" ? "process" : "decision"}`;
    const key = path + JSON.stringify(body);
    if (pending.current?.key !== key)
      pending.current = { key, id: crypto.randomUUID() };
    setError("");
    const commandId = pending.current.id;
    const execute = async (signal: AbortSignal) => {
      await api(path, {
        method: "POST",
        headers: { "X-Command-Id": commandId },
        body: JSON.stringify(body),
        signal,
      });
      if (signal.aborted) return;
      pending.current = null;
      setSelected(null);
      setNote("");
      setAttempt((v) => v + 1);
      window.dispatchEvent(new Event("hvm:departments-changed"));
    };
    if (administrative) {
      await command.run(execute);
      return;
    }
    if (!lifecycle.current || lifecycle.current.signal.aborted) return;
    flight.current = true;
    setPublicBusy(true);
    try {
      await execute(
        AbortSignal.any([lifecycle.current.signal, AbortSignal.timeout(20000)]),
      );
    } catch (e) {
      if (!lifecycle.current.signal.aborted) setError(commerceMessage(e));
    } finally {
      flight.current = false;
      if (!lifecycle.current.signal.aborted) setPublicBusy(false);
    }
  }
  return (
    <section
      className="department-extension"
      aria-labelledby="subscription-refunds-title"
    >
      <header>
        <div>
          <h2 id="subscription-refunds-title">Reembolsos de assinaturas</h2>
          <p>
            Cancelamentos e problemas de serviço dos planos de consumidor e
            produtor.
          </p>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => setAttempt((v) => v + 1)}
        >
          Atualizar consulta
        </button>
      </header>
      <label>
        Situação
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
            setSelected(null);
          }}
        >
          <option value="all">Todas</option>
          {[
            "requested",
            "under_review",
            "approved",
            "processing",
            "refunded",
            "rejected",
          ].map((s) => (
            <option key={s} value={s}>
              {statusLabels[s]}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="commerce-error">
          {error}
        </p>
      )}
      <AdminCommandConfirmation
        confirmation={command.confirmation}
        onConfirmed={command.confirm}
        onCancel={command.cancel}
      />
      {data ? (
        <>
          <p>
            {data.total} solicitações.{" "}
            {!data.gatewayAvailable &&
              "Sem conta de recebimento conectada: análise disponível; estorno aguarda integração."}
          </p>
          <div className="department-extension-grid">
            {data.refunds.map((r) => (
              <article key={r.id}>
                <h3>{r.planName}</h3>
                <p>
                  {r.audience === "producer"
                    ? "Plano de produtor"
                    : "Plano de consumidor"}{" "}
                  · {statusLabels[r.status]}
                </p>
                <p>
                  Solicitado: {money(r.requestedAmountCents)}
                  {r.approvedAmountCents !== null &&
                    ` · Aprovado: ${money(r.approvedAmountCents)}`}
                </p>
                <p>{r.reason}</p>
                <p>Política contratada: versão {r.policy.version}</p>
                <details>
                  <summary>Histórico e atendimento</summary>
                  {r.history.map((h, i) => (
                    <div key={i}>
                      <time>
                        {new Date(h.createdAt).toLocaleString("pt-BR")}
                      </time>
                      <p>
                        {statusLabels[h.action] ??
                          (h.action === "admin_message" ? "Equipe" : "Titular")}
                        : {h.note}
                      </p>
                    </div>
                  ))}
                </details>
                {!["refunded", "rejected"].includes(r.status) && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setSelected(r);
                      setNote("");
                      setAmount((r.requestedAmountCents / 100).toFixed(2));
                    }}
                  >
                    Abrir atendimento
                  </button>
                )}
              </article>
            ))}
          </div>
          {!data.refunds.length && (
            <p role="status">Nenhuma solicitação neste filtro.</p>
          )}
          <nav aria-label="Páginas de reembolsos de assinaturas">
            <button
              className="secondary"
              disabled={page <= 1 || busy}
              onClick={() => setPage((v) => v - 1)}
            >
              Anterior
            </button>
            <span>
              {page} de {data.pages}
            </span>
            <button
              className="secondary"
              disabled={page >= data.pages || busy}
              onClick={() => setPage((v) => v + 1)}
            >
              Próxima
            </button>
          </nav>
        </>
      ) : (
        !error && <p role="status">Consultando solicitações…</p>
      )}
      {selected && (
        <form
          data-hvm-update-busy="true"
          onSubmit={(e) => {
            e.preventDefault();
            void action("message");
          }}
        >
          <h3>Atendimento de {selected.planName}</h3>
          <label>
            Mensagem ou justificativa
            <textarea
              value={note}
              minLength={10}
              maxLength={2000}
              required
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="department-extension-actions">
            <button className="secondary" disabled={busy || reauth}>
              Enviar mensagem
            </button>
            {administrative &&
              ["requested", "under_review"].includes(selected.status) && (
                <>
                  <label>
                    Valor aprovado (R$)
                    <input
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || reauth}
                    onClick={() => void action("under_review")}
                  >
                    Colocar em análise
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || reauth}
                    onClick={() => void action("approved")}
                  >
                    Aprovar valor
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || reauth}
                    onClick={() => void action("rejected")}
                  >
                    Recusar com justificativa
                  </button>
                </>
              )}
            {administrative &&
              ["approved", "processing"].includes(selected.status) && (
                <button
                  className="primary"
                  type="button"
                  disabled={busy || reauth || !data?.gatewayAvailable}
                  onClick={() => void action("process")}
                >
                  Processar estorno no meio de pagamento
                </button>
              )}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Fechar atendimento
            </button>
          </div>
          <p>
            Aprovação não confirma devolução. O histórico só indica estorno
            quando confirmado pelo meio de pagamento.
          </p>
        </form>
      )}
    </section>
  );
}
