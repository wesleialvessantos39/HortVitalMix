import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { commerceMessage } from "../../lib/commerce";
import type { SubscriptionRefundPolicy } from "../../../shared/contracts/subscriptionRefund";
import type { ShellSession } from "../../hooks/useSession";
import { usePortalSession } from "../../components/notifications/NotificationProvider";
import {
  AdminCommandConfirmation,
  useAdminConfirmedCommand,
} from "../admin/useAdminConfirmedCommand";
import "./departmentExtensions.css";

export function SubscriptionRefundPolicyEditor() {
  const session = usePortalSession();
  if (!session) return null;
  return (
    <ScopedSubscriptionRefundPolicyEditor
      key={`${session.userId}:${session.activeRole}`}
      session={session}
    />
  );
}
function ScopedSubscriptionRefundPolicyEditor({
  session,
}: {
  session: ShellSession;
}) {
  const [policy, setPolicy] = useState<SubscriptionRefundPolicy | null>(null),
    [history, setHistory] = useState<
      Array<{ policy: SubscriptionRefundPolicy; created_at: string }>
    >([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pending = useRef<{ key: string; id: string } | null>(null);
  const command = useAdminConfirmedCommand(session.activeRole ?? null, (e) =>
    setError(commerceMessage(e)),
  );
  const busy = command.busy,
    reauth = Boolean(command.confirmation);
  async function load(signal?: AbortSignal) {
    const value = await api<{
      policy: SubscriptionRefundPolicy;
      history: typeof history;
    }>("/v1/admin/subscription-refund-policy", { signal });
    if (!signal?.aborted) {
      setPolicy(value.policy);
      setHistory(value.history);
    }
  }
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal).catch((e) => {
      if (!c.signal.aborted) setError(commerceMessage(e));
    });
    return () => c.abort();
  }, [session?.userId]);
  async function save(form: HTMLFormElement) {
    if (!policy || busy || reauth) return;
    const { version, ...fields } = policy,
      body = { expectedVersion: version, policy: fields },
      key = JSON.stringify(body);
    if (pending.current?.key !== key)
      pending.current = { key, id: crypto.randomUUID() };
    const commandId = pending.current.id;
    setError("");
    await command.run(async (signal) => {
      await api("/v1/admin/subscription-refund-policy", {
        method: "POST",
        headers: { "X-Command-Id": commandId },
        body: JSON.stringify(body),
        signal,
      });
      if (signal.aborted) return;
      pending.current = null;
      await load(signal);
      if (signal.aborted) return;
      form.dispatchEvent(new Event("hvm:form-saved", { bubbles: true }));
      setNotice(
        "Nova versão publicada. Assinaturas existentes conservam a política contratada.",
      );
    });
  }
  return (
    <section className="department-extension">
      <h2>Política de cancelamento e reembolso de assinaturas</h2>
      <p>
        Separada das devoluções de produtos. Consumidor e produtor podem
        cancelar; direitos obrigatórios não podem ser reduzidos pela
        configuração.
      </p>
      {error && (
        <p role="alert" className="commerce-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <AdminCommandConfirmation
        confirmation={command.confirmation}
        onConfirmed={command.confirm}
        onCancel={command.cancel}
      />
      {policy && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(e.currentTarget);
          }}
        >
          <p>Versão atual: {policy.version}</p>
          <label>
            Prazo de arrependimento da contratação a distância (dias, quando
            aplicável)
            <input
              type="number"
              min={7}
              max={60}
              required
              value={policy.withdrawalDays}
              onChange={(e) =>
                setPolicy({ ...policy, withdrawalDays: Number(e.target.value) })
              }
            />
          </label>
          <label className="department-extension-check">
            <input
              type="checkbox"
              checked={policy.prorateUnused}
              onChange={(e) =>
                setPolicy({ ...policy, prorateUnused: e.target.checked })
              }
            />{" "}
            Prever devolução proporcional do período pago não utilizado depois
            do prazo de arrependimento
          </label>
          <label>
            Condições adicionais
            <textarea
              maxLength={4000}
              value={policy.additionalTerms}
              onChange={(e) =>
                setPolicy({ ...policy, additionalTerms: e.target.value })
              }
            />
          </label>
          <p>
            CDC, art. 49: sete dias em contratação a distância quando aplicável.
            Problemas de serviço, pagamento duplicado e outros direitos exigem
            análise própria; renovação não reinicia automaticamente o prazo
            inicial. A configuração não substitui revisão jurídica.
          </p>
          <button className="primary" disabled={busy || reauth}>
            Publicar nova versão da política de assinaturas
          </button>
        </form>
      )}
      <details>
        <summary>Histórico de versões</summary>
        {history.map((h) => (
          <article key={h.policy.version}>
            <strong>Versão {h.policy.version}</strong>
            <p>
              {h.policy.withdrawalDays} dias ·{" "}
              {h.policy.prorateUnused ? "Com" : "Sem"} devolução proporcional
              comercial.
            </p>
            <p>{h.policy.additionalTerms}</p>
            <time>{new Date(h.created_at).toLocaleString("pt-BR")}</time>
          </article>
        ))}
      </details>
    </section>
  );
}
