import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { commerceMessage } from "../../lib/commerce";
import {
  AdminCommandConfirmation,
  useAdminConfirmedCommand,
} from "./useAdminConfirmedCommand";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import "../commerce/departmentExtensions.css";
export type ModerationTarget = {
  id: string;
  title: string;
  type: "product" | "store";
  revision: number;
  hidden: boolean;
};
export function CatalogModerationPanel({
  target,
  access,
  onClose,
  onSaved,
}: {
  target: ModerationTarget;
  access: AdminVerifySessionResponse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [history, setHistory] = useState<
      Array<{ action: string; reason: string; created_at: string }>
    >([]);
  const pending = useRef<{ key: string; id: string } | null>(null),
    command = useAdminConfirmedCommand(access.role, (e) =>
      setError(commerceMessage(e)),
    );
  useEffect(() => {
    const c = new AbortController();
    setReason("");
    setHistory([]);
    void api<{ history: typeof history }>(
      `/v1/admin/catalog/history/${target.id}?type=${target.type}`,
      { signal: c.signal },
    )
      .then((v) => {
        if (!c.signal.aborted) setHistory(v.history);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(commerceMessage(e));
      });
    return () => c.abort();
  }, [target.id, target.type]);
  function save(form: HTMLFormElement) {
    const body = {
      targetType: target.type,
      targetId: target.id,
      action: target.hidden ? "release" : "hide",
      expectedRevision: target.revision,
      reason,
    };
    const key = JSON.stringify(body);
    if (pending.current?.key !== key)
      pending.current = { key, id: crypto.randomUUID() };
    const id = pending.current.id;
    void command.run(async (signal) => {
      await api("/v1/admin/catalog/moderation", {
        method: "POST",
        headers: { "X-Command-Id": id },
        body: JSON.stringify(body),
        signal,
      });
      pending.current = null;
      form.dispatchEvent(new Event("hvm:form-saved", { bubbles: true }));
      onSaved();
      onClose();
      window.dispatchEvent(new Event("hvm:departments-changed"));
    });
  }
  return (
    <section className="department-extension">
      <form
        data-hvm-update-busy="true"
        onSubmit={(e) => {
          e.preventDefault();
          save(e.currentTarget);
        }}
      >
        <h2>Moderação de {target.title}</h2>
        <p>
          {target.hidden
            ? "Liberar remove a restrição administrativa. A publicação de produto continua sob responsabilidade do produtor."
            : "Ocultar retira este item da vitrine. Preços, estoque, pedidos e identidade do produtor são preservados."}
        </p>
        <label>
          Justificativa
          <textarea
            required
            minLength={10}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="department-extension-actions">
          <button className="admin-primary" disabled={command.busy}>
            {target.hidden ? "Liberar restrição" : "Ocultar da vitrine"}
          </button>
          <button
            className="admin-secondary"
            type="button"
            disabled={command.busy}
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
      </form>
      <details>
        <summary>Histórico de decisões</summary>
        {history.length ? (
          history.map((h, i) => (
            <p key={i}>
              {h.action === "hide" ? "Ocultado" : "Liberado"} ·{" "}
              {new Date(h.created_at).toLocaleString("pt-BR")} · {h.reason}
            </p>
          ))
        ) : (
          <p>Sem decisão administrativa anterior.</p>
        )}
      </details>
      <AdminCommandConfirmation
        confirmation={command.confirmation}
        onConfirmed={command.confirm}
        onCancel={command.cancel}
      />
    </section>
  );
}
