import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Mail, Phone, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import type { ShellSession } from "../../hooks/useSession";
import type {
  ContactChannel,
  ContactStatusResponse,
  ChallengeEmissionResult,
  ConfirmationResult,
} from "../../../shared/contracts/contactRecovery";
import { OtpInput } from "../../components/forms/OtpInput";
import "./auth.css";

const EMPTY_STATUS: ContactStatusResponse = {
  email: { verified: false, maskedDestination: null, hasActiveChallenge: false, cooldownRemainingSeconds: 0 },
  phone: { verified: false, maskedDestination: null, hasActiveChallenge: false, cooldownRemainingSeconds: 0 },
};

export function ContactConfirmationPage({
  session,
  onNavigate,
}: {
  session: ShellSession | null;
  onNavigate: (path: string) => void;
}) {
  const token = useMemo(() => new URLSearchParams(location.search).get("token"), []);
  const [status, setStatus] = useState<ContactStatusResponse>(EMPTY_STATUS);
  const [loading, setLoading] = useState(Boolean(session));
  const [busy, setBusy] = useState<ContactChannel | "token" | null>(token ? "token" : null);
  const [activeChannel, setActiveChannel] = useState<ContactChannel | null>(null);
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState("");
  const [tokenResult, setTokenResult] = useState<ConfirmationResult | null>(null);

  const loadStatus = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      setStatus(await api<ContactStatusResponse>("/v1/auth/contact/status"));
    } catch {
      setMessage("Não foi possível carregar o status dos contatos.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    api<ConfirmationResult>("/v1/auth/contact/confirm-token", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then((result) => {
        if (!active) return;
        setTokenResult(result);
        setMessage(
          result.status === "confirmed"
            ? "Contato confirmado com segurança."
            : "Este link não pode mais ser utilizado.",
        );
        void loadStatus();
      })
      .catch((error: Error) => {
        if (!active) return;
        setMessage(
          error.message === "NETWORK_UNAVAILABLE"
            ? "Sem conexão. Tente novamente."
            : "Este link expirou, já foi usado ou não é mais válido.",
        );
      })
      .finally(() => active && setBusy(null));
    return () => {
      active = false;
    };
  }, [loadStatus, token]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStatus((current) => ({
        email: {
          ...current.email,
          cooldownRemainingSeconds: Math.max(0, current.email.cooldownRemainingSeconds - 1),
        },
        phone: {
          ...current.phone,
          cooldownRemainingSeconds: Math.max(0, current.phone.cooldownRemainingSeconds - 1),
        },
      }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function issue(channel: ContactChannel) {
    setBusy(channel);
    setMessage("");
    try {
      const result = await api<ChallengeEmissionResult>("/v1/auth/contact/challenge", {
        method: "POST",
        body: JSON.stringify({ channel, commandId: crypto.randomUUID() }),
      });
      if (result.status === "issued") {
        setActiveChannel(channel);
        setOtp("");
        setMessage(
          channel === "email"
            ? "Enviamos um único e-mail com o código de 6 dígitos e o link seguro."
            : "Código enviado por SMS.",
        );
        setStatus((current) => ({
          ...current,
          [channel]: {
            ...current[channel],
            hasActiveChallenge: true,
            cooldownRemainingSeconds: result.cooldownSeconds,
            maskedDestination: result.maskedDestination,
          },
        }));
      } else if (result.status === "already_verified") {
        setMessage("Este contato já está confirmado.");
        await loadStatus();
      } else {
        setMessage("Não foi possível emitir o código agora.");
      }
    } catch (error) {
      const retry = Number((error as { status?: number }).status === 429);
      setMessage(retry ? "Aguarde o tempo indicado antes de solicitar um novo código." : "Falha ao solicitar confirmação.");
      await loadStatus();
    } finally {
      setBusy(null);
    }
  }

  async function confirmOtp(channel: ContactChannel) {
    if (!/^\d{6}$/.test(otp)) {
      setMessage("Digite os 6 dígitos do código.");
      return;
    }
    setBusy(channel);
    try {
      const result = await api<ConfirmationResult>("/v1/auth/contact/confirm-otp", {
        method: "POST",
        body: JSON.stringify({
          channel,
          otp,
          commandId: crypto.randomUUID(),
        }),
      });
      if (result.status === "confirmed") {
        setMessage("Contato confirmado com segurança.");
        setActiveChannel(null);
        setOtp("");
        await loadStatus();
      } else if (result.status === "invalid_code") {
        setMessage(`Código incorreto. Restam ${result.attemptsRemaining} tentativa(s).`);
      } else {
        setMessage("O desafio expirou ou não pode mais ser usado.");
      }
    } catch {
      setMessage("Não foi possível validar o código.");
    } finally {
      setBusy(null);
    }
  }

  if (token && busy === "token") {
    return (
      <section className="t04-page">
        <div className="t04-card t04-center">
          <span className="t04-icon"><ShieldCheck /></span>
          <h1>Confirmando seu contato</h1>
          <p>Validando o link seguro. Nenhum código é exposto no navegador ou no banco.</p>
          <div className="t04-spinner" aria-label="Carregando" />
        </div>
      </section>
    );
  }

  if (token && tokenResult?.status === "confirmed" && !session) {
    return (
      <section className="t04-page">
        <div className="t04-card t04-center">
          <span className="t04-icon success"><CheckCircle2 /></span>
          <h1>Contato confirmado</h1>
          <p>{message}</p>
          <button className="primary" onClick={() => onNavigate("/entrar")}>Ir para entrar</button>
        </div>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="t04-page">
        <div className="t04-card t04-center">
          <span className="t04-icon"><ShieldCheck /></span>
          <h1>Confirmação de contato</h1>
          <p>Entre na sua conta para solicitar ou validar um código de contato.</p>
          {message && <p className="t04-notice" role="status">{message}</p>}
          <button className="primary" onClick={() => onNavigate("/entrar")}>Entrar na conta</button>
        </div>
      </section>
    );
  }

  return (
    <section className="t04-page" aria-labelledby="contact-confirm-title">
      <header className="t04-heading">
        <span className="eyebrow">Segurança da conta</span>
        <h1 id="contact-confirm-title">Confirme seus contatos</h1>
        <p>O e-mail recebe, na mesma mensagem, um código de 6 dígitos e um link seguro. Cada desafio vale 30 minutos e pode ser usado uma única vez.</p>
      </header>

      {message && <p className="t04-notice" role="status">{message}</p>}
      {loading ? (
        <div className="t04-card t04-center"><div className="t04-spinner" aria-label="Carregando" /></div>
      ) : (
        <div className="t04-contact-grid">
          {(["email", "phone"] as const).map((channel) => {
            const info = status[channel];
            const Icon = channel === "email" ? Mail : Phone;
            const label = channel === "email" ? "E-mail" : "Telefone";
            return (
              <article className="t04-card t04-contact-card" key={channel}>
                <div className="t04-card-title">
                  <span className="t04-icon"><Icon /></span>
                  <div>
                    <h2>{label}</h2>
                    <p>{info.maskedDestination ?? "Destino não disponível"}</p>
                  </div>
                  <span className={info.verified ? "t04-status verified" : "t04-status"}>
                    {info.verified ? "Confirmado" : "Pendente"}
                  </span>
                </div>

                {info.verified ? (
                  <div className="t04-verified"><CheckCircle2 /> Contato protegido e confirmado.</div>
                ) : (
                  <>
                    <button
                      className="primary"
                      disabled={busy !== null || info.cooldownRemainingSeconds > 0}
                      onClick={() => void issue(channel)}
                    >
                      <RefreshCw size={17} />
                      {info.cooldownRemainingSeconds > 0
                        ? `Reenviar em ${info.cooldownRemainingSeconds}s`
                        : channel === "email" ? "Enviar código + link" : "Enviar código"}
                    </button>

                    {activeChannel === channel && (
                      <div className="t04-otp-panel">
                        <label>Código de 6 dígitos</label>
                        <OtpInput value={otp} onChange={setOtp} disabled={busy !== null} />
                        <button
                          className="t04-secondary"
                          disabled={busy !== null || otp.length !== 6}
                          onClick={() => void confirmOtp(channel)}
                        >
                          Confirmar código
                        </button>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
      <button className="text-button t04-back" onClick={() => onNavigate("/minha-conta")}>Voltar para minha conta</button>
    </section>
  );
}
