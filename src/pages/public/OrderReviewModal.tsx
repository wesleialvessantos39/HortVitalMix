import { useEffect, useRef, useState, type FormEvent } from "react";
import { Star } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import { reviewMessage } from "../../lib/reviews";
import {
  CreateReviewSchema,
  ReviewEligibilitySchema,
  OwnerReviewSchema,
  type ReviewEligibility,
  type OwnerReview,
} from "../../../shared/contracts/review";
import { ReviewStars } from "../../components/reviews/ReviewStars";
import "../../components/reviews/reviews.css";
export default function OrderReviewModal({
  orderId,
  onClose,
  onCreated,
}: {
  orderId: string;
  onClose: () => void;
  onCreated: (r: OwnerReview) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    pending = useRef<{ key: string; id: string } | null>(null),
    flight = useRef(false);
  const [rating, setRating] = useState(0),
    [comment, setComment] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const d = dialog.current,
      previous = document.activeElement as HTMLElement | null;
    d?.showModal();
    return () => {
      d?.close();
      previous?.focus();
    };
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (flight.current) return;
    const checked = CreateReviewSchema.safeParse({ orderId, rating, comment });
    if (!checked.success) {
      setError(
        "Escolha uma nota entre 1 e 5. O comentário deve ter até 1000 caracteres.",
      );
      return;
    }
    const payload = JSON.stringify(checked.data);
    if (pending.current?.key !== payload)
      pending.current = { key: payload, id: cryptoRandomUUID() };
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const r = OwnerReviewSchema.parse(
        await api("/v1/reviews", {
          method: "POST",
          headers: { "X-Command-Id": pending.current.id },
          body: payload,
        }),
      );
      pending.current = null;
      onCreated(r);
    } catch (e) {
      const status = (e as ApiFailure).status;
      if (status && status >= 400 && status < 500) pending.current = null;
      setError(reviewMessage(e));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="review-dialog"
      aria-labelledby="order-review-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={save}>
        <h2 id="order-review-title">Avaliar sua compra</h2>
        <p>
          Conte como foi receber os produtos desta loja. Sua nota e comentário
          serão públicos.
        </p>
        {error && (
          <p role="alert" className="review-error">
            {error}
          </p>
        )}
        <fieldset disabled={busy}>
          <legend>Sua nota</legend>
          <div className="review-rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n}>
                <input
                  type="radio"
                  name="review-rating"
                  value={n}
                  checked={rating === n}
                  onChange={() => setRating(n)}
                  required
                  aria-label={`${n} ${n === 1 ? "estrela" : "estrelas"}`}
                />
                <span>
                  <Star
                    aria-hidden="true"
                    fill={n <= rating ? "currentColor" : "none"}
                  />
                  {n}
                </span>
              </label>
            ))}
          </div>
          <label className="review-field">
            Comentário opcional
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              rows={4}
            />
          </label>
          <small>
            {comment.length}/1000 caracteres. Evite dados pessoais no
            comentário.
          </small>
        </fieldset>
        <div className="review-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Voltar
          </button>
          <button className="primary" disabled={busy || rating === 0}>
            {busy ? "Enviando avaliação…" : "Publicar avaliação"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function OrderReviewPanel({ orderId }: { orderId: string }) {
  const [state, setState] = useState<ReviewEligibility | null>(null),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setState(null);
    setError("");
    void api(`/v1/orders/${orderId}/review`, { signal: c.signal })
      .then((raw) => {
        const v = ReviewEligibilitySchema.parse(raw);
        if (!c.signal.aborted) setState(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(reviewMessage(e));
      });
    return () => c.abort();
  }, [orderId, attempt]);
  return (
    <article className="commerce-card review-owner">
      <h2>Sua avaliação</h2>
      {error ? (
        <div>
          <p role="alert" className="review-error">
            {error}
          </p>
          <button
            className="secondary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Consultar avaliação novamente
          </button>
        </div>
      ) : !state ? (
        <p role="status">Consultando sua avaliação…</p>
      ) : state.review ? (
        <>
          <ReviewStars rating={state.review.rating} />
          {state.review.comment && (
            <p className="review-comment">{state.review.comment}</p>
          )}
          <p role="status">
            {state.review.isModerated
              ? "Avaliação registrada e retirada da exibição pública pela moderação."
              : "Obrigado! Sua avaliação de compra verificada foi registrada."}
          </p>
        </>
      ) : state.canReview ? (
        <>
          <p>
            Seu pedido foi entregue. Compartilhe sua experiência com esta loja.
          </p>
          <button className="primary" onClick={() => setOpen(true)}>
            Avaliar compra
          </button>
        </>
      ) : (
        <p>A avaliação deste pedido ainda não está disponível.</p>
      )}
      {open && (
        <OrderReviewModal
          orderId={orderId}
          onClose={() => setOpen(false)}
          onCreated={(r) => {
            setOpen(false);
            setState({
              orderId,
              canReview: false,
              reason: "already_reviewed",
              review: r,
            });
          }}
        />
      )}
    </article>
  );
}
