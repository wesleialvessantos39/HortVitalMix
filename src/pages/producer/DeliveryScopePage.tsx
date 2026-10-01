import "./deliveryScope.css";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, MapPin, Truck } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import type { ShellSession } from "../../hooks/useSession";
import { useLocality } from "../../hooks/useLocality";
import {
  fetchDeliveryScope,
  saveDeliveryScope,
  type ProducerDeliveryScope,
} from "../../services/LocalityCatalogService";
import type { DeliveryScopeMode } from "../../../shared/contracts/locality";

type Props = {
  session: ShellSession;
  onNavigate: (to: string) => void;
};

const modes: Array<{
  value: DeliveryScopeMode;
  label: string;
  description: string;
}> = [
  {
    value: "property_municipality",
    label: "Somente no município do meu imóvel",
    description:
      "A entrega fica restrita ao município onde o imóvel rural está cadastrado.",
  },
  {
    value: "all",
    label: "Em todos os municípios atendidos",
    description:
      "Você entrega em todos os municípios cadastrados e ativos pela plataforma.",
  },
  {
    value: "custom",
    label: "Personalizado",
    description:
      "Escolha exatamente os municípios onde você consegue entregar.",
  },
];

function commandId() {
  return crypto.randomUUID();
}

export function DeliveryScopePage({ session, onNavigate }: Props) {
  const locality = useLocality();
  const [scope, setScope] = useState<ProducerDeliveryScope | null>(null);
  const [mode, setMode] = useState<DeliveryScopeMode>("property_municipality");
  const [chosen, setChosen] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [reauthOpen, setReauthOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [reauthError, setReauthError] = useState("");

  const hydrate = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await fetchDeliveryScope();
      if (signal?.aborted) return;
      setScope(result);
      setMode(result.mode);
      setChosen(result.municipalityIds);
      setError("");
    } catch (failure) {
      if (signal?.aborted) return;
      setError(
        (failure as ApiFailure).message === "PRODUCER_PROFILE_REQUIRED"
          ? "Esta área é exclusiva do perfil produtor."
          : "Não foi possível carregar seu escopo de entrega agora.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void hydrate(controller.signal);
    return () => controller.abort();
  }, [hydrate, session.userId]);

  function toggleMunicipality(id: string) {
    setChosen((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
    setNotice("");
  }

  async function persist(next: DeliveryScopeMode, municipalities: string[]) {
    if (!scope) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveDeliveryScope({
        mode: next,
        municipalityIds: next === "custom" ? municipalities : [],
        expectedRevision: scope.revision,
        commandId: commandId(),
      });
      setScope(saved);
      setMode(saved.mode);
      setChosen(saved.municipalityIds);
      setNotice("Escopo de entrega atualizado.");
      window.dispatchEvent(new CustomEvent("hortivitalmix:delivery-scope-changed"));
    } catch (failure) {
      const code = (failure as ApiFailure).message;
      if (code === "REAUTH_REQUIRED" || code === "ADMIN_REAUTHENTICATION_REQUIRED") {
        setReauthOpen(true);
        setNotice("");
      } else if (code === "REVISION_CONFLICT" || code === "LOCALITY_REVISION_CONFLICT") {
        setError("O escopo mudou em outro dispositivo. Recarregue antes de salvar.");
        await hydrate();
      } else if (code === "INVALID_MUNICIPALITY") {
        setError("Um dos municípios escolhidos não está mais ativo. Revise a seleção.");
      } else {
        setError("Não foi possível salvar o escopo de entrega agora.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "custom" && chosen.length === 0) {
      setError("Escolha pelo menos um município para a entrega personalizada.");
      return;
    }
    await persist(mode, chosen);
  }

  async function confirmPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) return;
    setReauthError("");
    try {
      const restored = await api<ShellSession>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: session.email,
          password,
          portalRole: "producer",
        }),
      });
      if (restored.userId !== session.userId)
        throw new Error("IDENTITY_MISMATCH");
      setPassword("");
      setReauthOpen(false);
      setNotice("Identidade confirmada. Clique em salvar novamente.");
    } catch {
      setReauthError("Não foi possível confirmar sua senha. Confira e tente novamente.");
    }
  }

  return (
    <section className="delivery-scope-page">
      <button
        className="text-button"
        type="button"
        onClick={() => onNavigate("/conta")}
      >
        <ArrowLeft size={15} /> Voltar para minha conta
      </button>
      <header>
        <span className="eyebrow">Área do produtor</span>
        <h1>Onde você entrega?</h1>
        <p>
          O escopo de entrega é revalidado a cada leitura: se o município for
          desativado, a entrega para ele é cortada sem apagar a sua escolha.
        </p>
      </header>

      {loading ? (
        <p role="status">Carregando seu escopo de entrega…</p>
      ) : error && !scope ? (
        <p role="alert" className="account-error">
          {error}
        </p>
      ) : (
        <form className="delivery-scope-form" onSubmit={submit}>
          {modes.map((option) => (
            <label
              key={option.value}
              className={
                mode === option.value
                  ? "delivery-scope-option is-selected"
                  : "delivery-scope-option"
              }
            >
              <input
                type="radio"
                name="deliveryScope"
                value={option.value}
                checked={mode === option.value}
                onChange={() => {
                  setMode(option.value);
                  setNotice("");
                  setError("");
                }}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {mode === option.value && <Check size={16} />}
            </label>
          ))}

          {mode === "custom" && (
            <fieldset className="delivery-scope-municipalities">
              <legend>Municípios atendidos</legend>
              {locality.municipalities.length === 0 ? (
                <p role="alert">
                  Nenhum município está ativo agora. Tente novamente em
                  instantes.
                </p>
              ) : (
                <ul>
                  {locality.municipalities.map((municipality) => (
                    <li key={municipality.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={chosen.includes(municipality.id)}
                          onChange={() => toggleMunicipality(municipality.id)}
                        />
                        <MapPin size={15} />
                        <span>
                          {municipality.name} – {municipality.state}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          )}

          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="account-notice">
              <Truck size={15} /> {notice}
            </p>
          )}

          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Salvar escopo de entrega"}
          </button>
        </form>
      )}

      {reauthOpen && (
        <form className="account-sheet" onSubmit={confirmPassword}>
          <label>
            Confirme sua senha para alterar o escopo de entrega
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {reauthError && (
            <p role="alert" className="account-error">
              {reauthError}
            </p>
          )}
          <button className="secondary" type="submit">
            Confirmar senha
          </button>
        </form>
      )}
    </section>
  );
}
