import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { commerceMessage } from "../../lib/commerce";
export function RequestSubscriptionRefund({
  subscriptionId,
}: {
  subscriptionId: string;
}) {
  const [open, setOpen] = useState(false),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const command = useRef<{ key: string; id: string } | null>(null),
    flight = useRef(false);
  return (
    <div className="subscription-notice">
      <button
        type="button"
        className="secondary"
        disabled={busy}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Solicitar análise de reembolso desta assinatura
      </button>
      {open && (
        <form
          data-hvm-update-busy="true"
          onSubmit={(e) => {
            e.preventDefault();
            if (flight.current) return;
            const form = e.currentTarget,
              body = { subscriptionId, note },
              key = JSON.stringify(body);
            if (command.current?.key !== key)
              command.current = { key, id: crypto.randomUUID() };
            flight.current = true;
            setBusy(true);
            setError("");
            void api("/v1/subscription-refunds", {
              method: "POST",
              headers: { "X-Command-Id": command.current.id },
              body: JSON.stringify(body),
            })
              .then(() => {
                command.current = null;
                setOpen(false);
                setNote("");
                form.dispatchEvent(
                  new Event("hvm:form-saved", { bubbles: true }),
                );
                window.dispatchEvent(
                  new Event("hvm:subscription-refunds-changed"),
                );
              })
              .catch((e) => setError(commerceMessage(e)))
              .finally(() => {
                flight.current = false;
                setBusy(false);
              });
          }}
        >
          <p>
            Descreva o problema mesmo após o prazo inicial. A equipe analisará
            os direitos aplicáveis e os pagamentos confirmados; enviar uma
            solicitação não garante estorno.
          </p>
          <label>
            Motivo e detalhes
            <textarea
              required
              minLength={10}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button
            className="primary"
            disabled={busy || note.trim().length < 10}
          >
            Enviar solicitação para análise
          </button>
        </form>
      )}
    </div>
  );
}
