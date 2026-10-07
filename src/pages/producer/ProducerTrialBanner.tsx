import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { TrialView } from "../../../shared/contracts/subscription";
import "../public/subscriptions.css";
export function ProducerTrialBanner({
  userId,
  onNavigate,
}: {
  userId: string;
  onNavigate: (path: string) => void;
}) {
  const [trial, setTrial] = useState<TrialView | null>(null),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const c = new AbortController();
    void api<{ trial: TrialView | null }>("/v1/producer/trial", {
      signal: c.signal,
    })
      .then((v) => {
        if (!c.signal.aborted) setTrial(v.trial);
      })
      .catch(() => {});
    return () => c.abort();
  }, [userId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  if (!trial || trial.isConverted) return null;
  const remaining = Math.max(0, Date.parse(trial.endsAt) - now),
    days = Math.ceil(remaining / 86400000);
  return (
    <aside
      className="subscription-trial"
      aria-label="Período gratuito do produtor"
    >
      <div>
        <strong>
          {days
            ? `${days} ${days === 1 ? "dia restante" : "dias restantes"} no seu período gratuito`
            : "Seu período gratuito terminou"}
        </strong>
        <p>
          Trial único de 30 dias, até{" "}
          {new Date(trial.endsAt).toLocaleDateString("pt-BR")}. Conheça os
          planos para continuar no clube.
        </p>
      </div>
      <button
        className="secondary"
        onClick={() => onNavigate("/produtor/assinaturas")}
      >
        Ver planos do produtor
      </button>
    </aside>
  );
}
