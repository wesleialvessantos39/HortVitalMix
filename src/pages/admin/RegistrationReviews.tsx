import { PageLoading } from "../../components/PageLoading";
import { useEffect, useState } from "react";
import { api, type ApiFailure } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
type Review = {
  id: string;
  user_id: string;
  full_name: string;
  email_normalized: string;
  reasons: string[];
  created_at: string;
  requested_role?: string;
};
export function RegistrationReviews({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Review[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Review | null>(null),
    [decision, setDecision] = useState("approved"),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setLoading(true);
    void api<{ reviews: Review[] }>("/v1/admin/registration-reviews")
      .then((r) => {
        if (!Array.isArray(r.reviews)) throw new Error("INVALID_RESPONSE");
        if (current) {
          setRows(r.reviews);
          setError("");
        }
      })
      .catch(() => {
        if (current)
          setError(
            "Não foi possível carregar as solicitações. Use Atualizar para tentar novamente.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [refreshKey]);
  async function submit() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/v1/admin/registration-reviews/" + selected.id + "/decision", {
        method: "POST",
        body: JSON.stringify({ decision, note, commandId: cryptoRandomUUID() }),
      });
      setSelected(null);
      onChanged();
    } catch (err) {
      const e = err as ApiFailure;
      setError(
        e.message === "IDENTITY_ALREADY_IN_USE"
          ? "Já existe outro cadastro vigente com este CPF ou e-mail. Verifique as identidades antes de aprovar."
          : e.status === 401
            ? "Entre novamente para confirmar esta operação."
            : "A decisão não pôde ser concluída. Atualize a lista e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="admin-card admin-review-queue"
      aria-labelledby="review-heading"
    >
      <h2 id="review-heading">Cadastros aguardando validação</h2>
      <p className="admin-muted">
        Correspondências com contas excluídas exigem análise humana. Nome igual
        pode pertencer a outra pessoa; confirme a identidade antes de decidir.
      </p>
      {error && (
        <p role="alert" className="admin-alert admin-alert--error">
          {error}
        </p>
      )}
      {loading && rows.length === 0 ? (
        <PageLoading label="Carregando solicitações…" />
      ) : rows.length === 0 ? (
        <p className="admin-muted">Nenhuma solicitação pendente.</p>
      ) : (
        <div className="admin-review-list">
          {rows.map((r) => (
            <article key={r.id} className="admin-review-item">
              <div>
                <strong>{r.full_name}</strong>
                <span>{r.email_normalized}</span>
                <small>
                  Correspondência:{" "}
                  {r.reasons
                    .map((x) => (x === "cpf" ? "CPF" : "nome"))
                    .join(" e ")}{" "}
                  · {new Date(r.created_at).toLocaleString("pt-BR")}
                </small>
              </div>
              <button
                className="admin-secondary"
                disabled={busy}
                onClick={() => {
                  setSelected(r);
                  setDecision("approved");
                  setNote("");
                }}
              >
                Analisar cadastro
              </button>
            </article>
          ))}
        </div>
      )}
      {selected && (
        <form
          className="admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h3>Validar {selected.full_name}</h3>
          <label>
            Decisão
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            >
              <option value="approved">Aprovar acesso</option>
              <option value="rejected">Rejeitar solicitação</option>
            </select>
          </label>
          <label>
            Justificativa da análise
            <textarea
              required
              minLength={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="admin-button-row">
            <button className="admin-primary" disabled={busy}>
              Confirmar decisão
            </button>
            <button
              type="button"
              className="admin-secondary"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
