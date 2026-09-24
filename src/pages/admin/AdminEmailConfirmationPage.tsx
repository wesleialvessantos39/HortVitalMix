import { useEffect, useMemo, useState } from "react";
import { Leaf, MailCheck, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { OtpInput } from "../../components/forms/OtpInput";

export function AdminEmailConfirmationPage({
  onNavigate,
}: {
  onNavigate: (to: string) => void;
}) {
  const initial = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      email: params.get("email") ?? "",
      sent: params.get("sent") === "1",
      destination: params.get("dest") ?? "",
      retryAfter: Number(params.get("retry") ?? 0) || 0,
    };
  }, []);
  const [email, setEmail] = useState(initial.email);
  const [otp, setOtp] = useState("");
  const [destination, setDestination] = useState(initial.destination);
  const [sent, setSent] = useState(initial.sent);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retryAfter, setRetryAfter] = useState(initial.retryAfter);
  const [notice, setNotice] = useState(
    initial.sent
      ? "Código de confirmação enviado. Confira sua caixa de entrada e a pasta de spam."
      : initial.email
        ? "Envie o código de confirmação para validar este e-mail administrativo."
        : "",
  );

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(
      () => setRetryAfter((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  async function requestCode() {
    if (!email.trim()) {
      setNotice("Informe o e-mail administrativo.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{
        status: string;
        maskedDestination?: string;
        retryAfterSeconds?: number;
      }>("/v1/admin/auth/email-confirmation/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      if (result.status === "already_verified") {
        setVerified(true);
        setNotice("Este e-mail administrativo já está confirmado.");
        return;
      }
      if (result.status === "cooldown") {
        setDestination(result.maskedDestination ?? email);
        setRetryAfter(result.retryAfterSeconds ?? 60);
        if (sent) {
          setNotice(
            "Use o código de confirmação mais recente recebido. O reenvio ficará disponível após o contador.",
          );
        } else {
          setSent(false);
          setNotice(
            "O provedor de e-mail está em intervalo de segurança. Aguarde o contador e então solicite o código de confirmação.",
          );
        }
        return;
      }
      setDestination(result.maskedDestination ?? email);
      setSent(true);
      setRetryAfter(60);
      setNotice("Código de confirmação enviado. Confira também a pasta de spam.");
    } catch {
      setNotice("Não foi possível enviar o código agora. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (otp.length !== 6) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{ status: string }>(
        "/v1/admin/auth/email-confirmation/verify",
        {
          method: "POST",
          body: JSON.stringify({ email, otp }),
        },
      );
      if (
        result.status === "verified" ||
        result.status === "already_verified"
      ) {
        setVerified(true);
        setNotice("E-mail administrativo confirmado com sucesso.");
        return;
      }
      setNotice("Código inválido ou expirado.");
    } catch {
      setNotice("Código inválido ou expirado. Solicite um novo código.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-login-page">
      <header className="admin-login-header">
        <button
          className="admin-back"
          onClick={() => onNavigate("/entrar/super-administrador")}
        >
          ← Acesso administrativo
        </button>
        <div className="admin-login-brand">
          <span className="admin-brand-mark"><Leaf /></span>
          <strong>Horti<span>Vital</span>Mix</strong>
        </div>
      </header>

      <div className="admin-bootstrap-wrap">
        <div className="admin-login-card admin-login-card--wide">
          <div className="admin-login-icon"><MailCheck /></div>
          <span className="admin-kicker">Confirmação administrativa</span>
          <h1>Confirme seu e-mail</h1>
          <p className="admin-muted">
            A confirmação do e-mail administrativo é separada do cadastro
            público de Consumidor ou Produtor.
          </p>

          {notice && (
            <div
              className={
                verified
                  ? "admin-alert admin-alert--success"
                  : "admin-alert"
              }
              role="status"
            >
              {notice}
            </div>
          )}

          {verified ? (
            <button
              className="admin-primary"
              onClick={() => onNavigate("/entrar/super-administrador")}
            >
              Ir para o acesso administrativo
            </button>
          ) : (
            <>
              <label>
                E-mail administrativo
                <input
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.currentTarget.value);
                    setSent(false);
                    setOtp("");
                  }}
                  autoComplete="email"
                  required
                />
              </label>

              {!sent ? (
                <button
                  className="admin-primary"
                  type="button"
                  disabled={busy || retryAfter > 0}
                  onClick={() => void requestCode()}
                >
                  {busy
                    ? "Enviando…"
                    : retryAfter > 0
                      ? `Novo envio em ${retryAfter}s`
                      : "Enviar código de confirmação"}
                </button>
              ) : (
                <form onSubmit={verifyCode}>
                  <p className="admin-muted">
                    Digite o código de 6 dígitos enviado para {destination}.
                  </p>
                  <OtpInput value={otp} onChange={setOtp} length={6} />
                  <button
                    className="admin-primary"
                    disabled={busy || otp.length !== 6}
                  >
                    {busy ? "Confirmando…" : "Confirmar e-mail"}
                  </button>
                  <button
                    className="admin-link"
                    type="button"
                    disabled={busy || retryAfter > 0}
                    onClick={() => void requestCode()}
                  >
                    <RefreshCw size={14} />{" "}
                    {retryAfter > 0
                      ? `Reenviar em ${retryAfter}s`
                      : "Reenviar código"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
