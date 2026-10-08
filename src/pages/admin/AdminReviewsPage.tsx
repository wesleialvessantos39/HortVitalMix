import { PageLoading } from "../../components/PageLoading";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type ApiFailure } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import { reviewMessage } from "../../lib/reviews";
import {
  AdminReviewListSchema,
  ModerateReviewSchema,
  type AdminReview,
} from "../../../shared/contracts/review";
import { ReviewStars } from "../../components/reviews/ReviewStars";
import { AdminReauthentication } from "../../components/commerce/AdminReauthentication";
import { useSession } from "../../hooks/useSession";
import "../../components/reviews/reviews.css";

export default function AdminReviewsPage() {
  const { session } = useSession();
  const [state, setState] = useState<"published" | "moderated" | "all">(
    "published",
  );
  const [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<ReturnType<
    typeof AdminReviewListSchema.parse
  > | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<AdminReview | null>(null),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [reauth, setReauth] = useState(false);
  const flight = useRef(false),
    pending = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError("");
    api(`/v1/admin/reviews?state=${state}&page=${page}`, { signal: c.signal })
      .then((v) => {
        if (!c.signal.aborted) {
          const result = AdminReviewListSchema.parse(v);
          if (page > result.pages) setPage(result.pages);
          else setData(result);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(reviewMessage(e));
      });
    return () => c.abort();
  }, [state, page, attempt]);
  async function moderate(event: FormEvent) {
    event.preventDefault();
    if (!selected || flight.current || reauth) return;
    const input = ModerateReviewSchema.safeParse({ reason });
    if (!input.success) {
      setError("Explique o motivo da moderação com 10 a 500 caracteres.");
      return;
    }
    const key = selected.id + JSON.stringify(input.data);
    if (pending.current?.key !== key)
      pending.current = { key, id: cryptoRandomUUID() };
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/v1/admin/reviews/${selected.id}/moderate`, {
        method: "POST",
        headers: { "X-Command-Id": pending.current.id },
        body: JSON.stringify(input.data),
      });
      pending.current = null;
      setSelected(null);
      setReason("");
      setNotice(
        "Avaliação ocultada. O conteúdo e o motivo permanecem no histórico de moderação.",
      );
      setAttempt((v) => v + 1);
    } catch (e) {
      if ((e as ApiFailure).message === "ADMIN_REAUTHENTICATION_REQUIRED")
        setReauth(true);
      else if (
        (e as ApiFailure).status &&
        ((e as ApiFailure).status ?? 0) < 500
      )
        pending.current = null;
      setError(reviewMessage(e));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="review-admin">
      <header>
        <span className="eyebrow">Reputação auditada</span>
        <h1>Moderação de avaliações</h1>
        <p>
          Avaliações de compras entregues. A moderação oculta o conteúdo público
          e registra o motivo.
        </p>
      </header>
      <label className="review-filter">
        Exibir
        <select
          aria-label="Exibir avaliações"
          value={state}
          disabled={busy}
          onChange={(e) => {
            setState(e.target.value as typeof state);
            setPage(1);
            setSelected(null);
            setReason("");
          }}
        >
          <option value="published">Publicadas</option>
          <option value="moderated">Moderadas</option>
          <option value="all">Todas</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="review-error">
          {error}{" "}
          {!selected && (
            <button onClick={() => setAttempt((v) => v + 1)}>
              Tentar novamente
            </button>
          )}
        </p>
      )}
      {notice && (
        <p role="status" className="review-notice">
          {notice}
        </p>
      )}
      {reauth && session && (
        <AdminReauthentication
          session={session}
          onConfirmed={() => {
            setReauth(false);
            setError("");
          }}
        />
      )}
      {!data && !error && <PageLoading label="Carregando avaliações…" />}
      {selected && (
        <form
          onSubmit={moderate}
          className="review-admin-card review-moderation-form"
          aria-label="Moderar avaliação"
        >
          <h2>Ocultar avaliação do pedido #{selected.orderNumber}</h2>
          <p>{selected.storeName}</p>
          <ReviewStars rating={selected.rating} />
          {selected.comment && (
            <p className="review-comment">{selected.comment}</p>
          )}
          <label>
            Motivo da moderação
            <textarea
              autoFocus
              required
              minLength={10}
              maxLength={500}
              rows={4}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p>
            A avaliação deixará de compor a nota da loja. Seu conteúdo
            continuará disponível neste painel.
          </p>
          <div className="review-actions">
            <button className="admin-primary" disabled={busy || reauth}>
              {busy ? "Ocultando…" : "Confirmar moderação"}
            </button>
            <button
              type="button"
              className="admin-secondary"
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setReason("");
                setError("");
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {data && (
        <>
          <p>
            {data.total} {data.total === 1 ? "avaliação" : "avaliações"}
          </p>
          <div className="review-admin-list">
            {data.reviews.map((r) => (
              <article key={r.id} className="review-admin-card">
                <h2>{r.storeName}</h2>
                <p>
                  Pedido #{r.orderNumber} ·{" "}
                  {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                </p>
                <ReviewStars rating={r.rating} />
                {r.comment && <p className="review-comment">{r.comment}</p>}
                {r.isModerated ? (
                  <div className="review-moderation-record">
                    <strong>Moderada</strong>
                    <p className="review-comment">
                      Motivo: {r.moderationReason}
                    </p>
                    <p>
                      {r.moderatedAt &&
                        new Date(r.moderatedAt).toLocaleString("pt-BR")}
                      {r.moderatedBy
                        ? ` · Administrador: ${r.moderatedBy}`
                        : " · Conta do moderador removida"}
                    </p>
                  </div>
                ) : (
                  <button
                    className="admin-secondary"
                    disabled={busy}
                    onClick={() => {
                      setSelected(r);
                      setReason("");
                      setError("");
                      setNotice("");
                    }}
                  >
                    Moderar avaliação do pedido #{r.orderNumber}
                  </button>
                )}
              </article>
            ))}
          </div>
          {!data.reviews.length && <p>Nenhuma avaliação neste filtro.</p>}
          {data.pages > 1 && (
            <nav
              className="review-pagination"
              aria-label="Páginas de avaliações administrativas"
            >
              <button
                disabled={busy || page === 1}
                onClick={() => setPage((v) => v - 1)}
              >
                Anterior
              </button>
              <span>
                Página {page} de {data.pages}
              </span>
              <button
                disabled={busy || page >= data.pages}
                onClick={() => setPage((v) => v + 1)}
              >
                Próxima
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
