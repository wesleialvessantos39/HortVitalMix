import { Star } from "lucide-react";
export function ReviewStars({ rating }: { rating: number }) {
  return (
    <span
      className="review-stars"
      role="img"
      aria-label={`${rating.toLocaleString("pt-BR")} de 5 estrelas`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={19}
          aria-hidden="true"
          fill={n <= Math.round(rating) ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}
