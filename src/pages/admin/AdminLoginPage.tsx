import { useState } from "react";
import { KeyRound, Leaf, ShieldCheck } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import { OtpInput } from "../../components/forms/OtpInput";

type Props = {
  onNavigate: (to: string) => void;
  onSessionRefresh: () => Promise<void>;
};

type LoginResponse =
  | { status: "session_created"; role: string; sectors: string[] }
  | { status: "mfa_required"; mfaChallengeId: string; maskedDestination: string; expiresAt: string }
  | { status: string; retryAfterSeconds?: number };

export function AdminLoginPage({ onNavigate, onSessionRefresh }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<LoginResponse>("/v1/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (result.status === "session_created") {
        await onSessionRefresh();
        onNavigate("/admin/painel");
        return;
      }
      if (result.status === "mfa_required" && "mfaChallengeId" in result) {
        setChallengeId(result.mfaChallengeId);
        setDestination(result.maskedDestination);
        return;
      }
      setError("Não foi possível concluir o acesso administrativo.");
    } catch (caught) {
      const failure = caught as ApiFailure;
      setError(
        failure.status === 429
          ? "Muitas tentativas. Aguarde alguns minutos e tente novamente."
          : failure.status === 401
            ? "E-mail ou senha inválidos, ou acesso administrativo não autorizado."
            : "Serviço administrativo indisponível no momento.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId || otp.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ status: string }>("/v1/admin/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ challengeId, otp }),
      });
      if (result.status !== "verified") throw new Error("MFA_INVALID");
      await onSessionRefresh();
      onNavigate("/admin/painel");
    } catch {
      setError("Código inválido ou expirado. Solicite um novo acesso.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-login-page">
      <header className="admin-login-header">
        <button className="admin-back" onClick={() => onNavigate("/")}>← Voltar ao site</button>
        <div className="admin-login-brand">
          <span className="admin-brand-mark"><Leaf /></span>
          <strong>Horti<span>Vital</span>Mix</strong>
        </div>
      </header>
      <div className="admin-login-layout">
        <div className="admin-login-copy">
          <span className="admin-kicker"><ShieldCheck size={15}/> Área Administrativa</span>
          <h1>Gestão segura da plataforma.</h1>
          <p>
            Acesso reservado a administradores autorizados. Super administradores
            confirmam o acesso com um código adicional enviado pelo Supabase Auth.
          </p>
        </div>
        <div className="admin-login-card">
          {!challengeId ? (
            <form onSubmit={submitLogin}>
              <div className="admin-login-icon"><KeyRound /></div>
              <h2>Entrar na administração</h2>
              <p className="admin-muted">Use as credenciais do seu perfil administrativo.</p>
              {error && <div className="admin-alert admin-alert--error">{error}</div>}
              <label>E-mail
                <input type="email" autoComplete="username" value={email} onChange={(e)=>setEmail(e.target.value)} required />
              </label>
              <label>Senha
                <input type="password" autoComplete="current-password" value={password} onChange={(e)=>setPassword(e.target.value)} required />
              </label>
              <button className="admin-primary" disabled={busy}>
                {busy ? "Validando…" : "Entrar"}
              </button>
              <button type="button" className="admin-link" onClick={() => onNavigate("/admin/bootstrap")}>
                Primeiro acesso do Super administrador
              </button>
            </form>
          ) : (
            <form onSubmit={submitMfa}>
              <div className="admin-login-icon"><ShieldCheck /></div>
              <h2>Confirme o código de segurança</h2>
              <p className="admin-muted">Enviamos um código de 6 dígitos para {destination}.</p>
              {error && <div className="admin-alert admin-alert--error">{error}</div>}
              <OtpInput value={otp} onChange={setOtp} length={6} />
              <button className="admin-primary" disabled={busy || otp.length !== 6}>
                {busy ? "Verificando…" : "Confirmar acesso"}
              </button>
              <button type="button" className="admin-link" onClick={() => {
                setChallengeId(null); setOtp(""); setError("");
              }}>Voltar e solicitar outro código</button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
