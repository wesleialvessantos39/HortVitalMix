import { useEffect, useState } from "react";
import { KeyRound, Leaf, ShieldCheck } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import { OtpInput } from "../../components/forms/OtpInput";

type Props = {
  onNavigate: (to: string) => void;
  onSessionRefresh: () => Promise<void>;
  intendedRole?: "platform_admin" | "platform_super_admin" | null;
};

type LoginResponse =
  | { status: "session_created"; role: string; sectors: string[] }
  | { status: "mfa_required"; mfaChallengeId: string; maskedDestination: string; expiresAt: string }
  | { status: string; retryAfterSeconds?: number };

export function AdminLoginPage({
  onNavigate,
  onSessionRefresh,
  intendedRole = null,
}: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  const roleTitle =
    intendedRole === "platform_admin"
      ? "Administrador"
      : intendedRole === "platform_super_admin"
        ? "Super administrador"
        : "administração";
  const roleCopy =
    intendedRole === "platform_admin"
      ? "Acesso reservado a administradores setoriais convidados. O escopo liberado depende dos setores atribuídos à conta."
      : intendedRole === "platform_super_admin"
        ? "Acesso superior protegido. Após validar a senha, o segundo fator por e-mail é obrigatório antes da criação da sessão."
        : "Acesso reservado a administradores autorizados. Super administradores confirmam o acesso com um código adicional enviado pelo Supabase Auth.";

  useEffect(() => {
    if (!showHelp) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowHelp(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHelp]);

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
        <button
          className="admin-back"
          onClick={() => onNavigate(intendedRole ? "/administracao" : "/")}
        >
          {intendedRole ? "← Voltar para Administração" : "← Voltar ao site"}
        </button>
        <div className="admin-login-brand">
          <span className="admin-brand-mark"><Leaf /></span>
          <strong>Horti<span>Vital</span>Mix</strong>
        </div>
      </header>
      <div className="admin-login-layout">
        <div className="admin-login-copy">
          <span className="admin-kicker">
            <ShieldCheck size={15}/>
            {intendedRole === "platform_admin"
              ? "Administração setorial"
              : intendedRole === "platform_super_admin"
                ? "Acesso superior"
                : "Área Administrativa"}
          </span>
          <h1>
            {intendedRole
              ? `Entrar como ${roleTitle}.`
              : "Gestão segura da plataforma."}
          </h1>
          <p>{roleCopy}</p>
        </div>
        <div className="admin-login-card">
          {!challengeId ? (
            <form onSubmit={submitLogin}>
              <div className="admin-login-icon"><KeyRound /></div>
              <h2>
                {intendedRole
                  ? `Entrar como ${roleTitle}`
                  : "Entrar na administração"}
              </h2>
              <p className="admin-muted">
                Use as credenciais do seu perfil administrativo.{" "}
                <button type="button" className="admin-login-help-link" onClick={() => setShowHelp(true)}>
                  Saiba mais
                </button>
              </p>
              {error && <div className="admin-alert admin-alert--error">{error}</div>}
              <label>E-mail
                <input type="email" autoComplete="username" value={email} onChange={(e)=>setEmail(e.target.value)} required />
              </label>
              <label>Senha
                <input type="password" autoComplete="current-password" value={password} onChange={(e)=>setPassword(e.target.value)} required />
              </label>
              <button className="admin-primary" disabled={busy}>
                {busy
                  ? "Validando…"
                  : intendedRole
                    ? `Entrar como ${roleTitle}`
                    : "Entrar"}
              </button>
              {intendedRole !== "platform_admin" && (
                <button
                  type="button"
                  className="admin-link"
                  onClick={() => onNavigate("/admin/bootstrap")}
                >
                  Primeiro acesso do Super administrador
                </button>
              )}
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
      {showHelp && (
        <div className="admin-help-backdrop" onClick={() => setShowHelp(false)}>
          <div
            className="admin-help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="admin-help-title">Como obter acesso administrativo</h2>
            <ol>
              <li><strong>Primeiro Super administrador:</strong> nasce uma única vez pelo bootstrap protegido e por e-mail autorizado somente no servidor.</li>
              <li><strong>Demais administradores:</strong> entram apenas por convite emitido por um Super administrador.</li>
              <li><strong>Administrador setorial:</strong> opera somente nos setores atribuídos ao convite.</li>
              <li><strong>Super administrador:</strong> confirma obrigatoriamente cada acesso com MFA por e-mail via Supabase Auth.</li>
            </ol>
            <button type="button" className="admin-primary" onClick={() => setShowHelp(false)}>Fechar</button>
          </div>
        </div>
      )}
    </section>
  );
}
