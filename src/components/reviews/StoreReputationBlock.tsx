import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  StoreReviewsSchema,
  type StoreReviews,
} from "../../../shared/contracts/review";
import { ReviewStars } from "./ReviewStars";
import "./reviews.css";
export function StoreReputationBlock({ storeSlug }: { storeSlug: string }) {
  const [data, setData] = useState<StoreReviews | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setError(false);
    setData(null);
    void api(
      `/v1/stores/${encodeURIComponent(storeSlug)}/reviews?page=${page}`,
      { signal: c.signal },
    )
      .then((raw) => {
        const v = StoreReviewsSchema.parse(raw);
        if (!c.signal.aborted) {
          if (page > v.pages) setPage(v.pages);
          else setData(v);
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setError(true);
      });
    return () => c.abort();
  }, [storeSlug, page, attempt]);
  return (
    <section
      className="review-reputation"
      aria-label="Avaliações verificadas da loja"
    >
      <h2>Avaliações de quem recebeu</h2>
      {error ? (
        <div>
          <p>Não foi possível carregar as avaliações agora.</p>
          <button
            className="secondary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Tentar carregar avaliações
          </button>
        </div>
      ) : !data ? (
        <p role="status">Carregando avaliações…</p>
      ) : (
        <>
          {data.reputation.totalReviews > 0 ? (
            <div className="review-summary">
              <ReviewStars rating={data.reputation.averageRating} />
              <strong>
                {data.reputation.averageRating.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                de 5
              </strong>
              <span>
                {data.reputation.totalReviews}{" "}
                {data.reputation.totalReviews === 1
                  ? "avaliação verificada"
                  : "avaliações verificadas"}
              </span>
            </div>
          ) : (
            <p>Ainda não há avaliações verificadas para esta loja.</p>
          )}
          <p className="review-muted">
            Somente quem recebeu um pedido pode avaliar. Avaliações retiradas
            pela moderação não entram na nota.
          </p>
          <ul className="review-list">
            {data.reviews.map((r) => (
              <li key={r.id}>
                <div className="review-meta">
                  <ReviewStars rating={r.rating} />
                  <span>Compra verificada</span>
                  <time dateTime={r.createdAt}>
                    {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                  </time>
                </div>
                {r.comment && <p className="review-comment">{r.comment}</p>}
              </li>
            ))}
          </ul>
          {data.pages > 1 && (
            <nav className="review-actions" aria-label="Páginas de avaliações">
              <button
                className="secondary"
                disabled={page <= 1}
                onClick={() => setPage((n) => n - 1)}
              >
                Anteriores
              </button>
              <span>
                Página {page} de {data.pages}
              </span>
              <button
                className="secondary"
                disabled={page >= data.pages}
                onClick={() => setPage((n) => n + 1)}
              >
                Próximas
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
