import { useEffect, useState } from "react";
import { KeyRound, Leaf, ShieldCheck } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import { getBootstrapStatus } from "../../lib/adminBootstrapTransport";
import { primeAdminAccess } from "../../lib/adminAccessHandoff";
import { PasswordInput } from "../../components/forms/PasswordInput";

type Props = {
  onNavigate: (to: string) => void;
  intendedRole?: "platform_admin" | "platform_super_admin" | null;
};

type LoginResponse =
  | { status: "session_created"; role: string; sectors: string[] }
  | { status: "email_confirmation_required"; maskedDestination: string }
  | { status: string; retryAfterSeconds?: number };

export function AdminLoginPage({
  onNavigate,
  intendedRole = null,
}: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);

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
        ? "Use seu e-mail confirmado e a senha do Super administrador."
        : "Entre com o e-mail confirmado e a senha do seu perfil administrativo.";

  useEffect(() => {
    if (intendedRole === "platform_admin") {
      setBootstrapOpen(false);
      return;
    }
    let cancelled = false;
    getBootstrapStatus()
      .then((result) => {
        if (!cancelled) setBootstrapOpen(result.status === "open");
      })
      .catch(() => {
        if (!cancelled) setBootstrapOpen(false);
      });
    return () => { cancelled = true; };
  }, [intendedRole]);

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
        body: JSON.stringify({
          email,
          password,
          ...(intendedRole ? { portalRole: intendedRole } : {}),
        }),
      });
      if (result.status === "session_created") {
        window.dispatchEvent(new Event("hvm:session-changed"));
        // A sessão administrativa é validada pelo AdminAccessGate. Não use o
        // endpoint público /v1/auth/session aqui: credenciais administrativas
        // podem representar uma pessoa cujo user_id público é diferente.
        if ("role" in result && (result.role === "platform_admin" || result.role === "platform_super_admin") && "sectors" in result) {
          primeAdminAccess({authorized:true,role:result.role,sectors:result.sectors as import("../../../shared/contracts/adminGovernance").AdminSectorCode[],requiresReauth:false});
        }
        onNavigate("/admin/painel");
        return;
      }
      if (
        result.status === "email_confirmation_required" &&
        "maskedDestination" in result
      ) {
        onNavigate(
          "/admin/confirmar-email?email=" +
            encodeURIComponent(email.trim().toLowerCase()) +
            (intendedRole ? "&portal=" + encodeURIComponent(intendedRole) : ""),
        );
        return;
      }
      setError("Não foi possível concluir o acesso administrativo.");
    } catch (caught) {
      const failure = caught as ApiFailure;
      setError(failure.status === 429
        ? "Muitas tentativas. Aguarde alguns minutos e tente novamente."
        : [401,403,409].includes(failure.status ?? 0)
          ? "Dados inválidos ou cadastro não autorizado."
          : "Não foi possível entrar agora. Tente novamente em alguns instantes.");
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
              <PasswordInput
                label="Senha"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
              />
              <button className="admin-primary" disabled={busy}>
                {busy
                  ? "Validando…"
                  : intendedRole
                    ? `Entrar como ${roleTitle}`
                    : "Entrar"}
              </button>
              <button
                type="button"
                className="admin-link"
                onClick={() =>
                  onNavigate(
                    intendedRole
                      ? `/recuperar-senha?portal=${intendedRole}`
                      : "/recuperar-senha",
                  )
                }
              >
                Esqueci minha senha
              </button>
              <button
                type="button"
                className="admin-link"
                onClick={() =>
                  onNavigate(
                    "/admin/confirmar-email" +
                      (email.trim() || intendedRole
                        ? "?" +
                          [
                            email.trim()
                              ? "email=" + encodeURIComponent(email.trim().toLowerCase())
                              : "",
                            intendedRole
                              ? "portal=" + encodeURIComponent(intendedRole)
                              : "",
                          ]
                            .filter(Boolean)
                            .join("&")
                        : ""),
                  )
                }
              >
                Confirmar ou reenviar confirmação do e-mail
              </button>
              {intendedRole !== "platform_admin" && bootstrapOpen && (
                <button
                  type="button"
                  className="admin-link"
                  onClick={() => onNavigate("/admin/bootstrap")}
                >
                  Primeiro acesso do Super administrador
                </button>
              )}
            </form>

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
              <li><strong>Primeiro Super administrador:</strong> é cadastrado uma única vez com o e-mail autorizado.</li>
              <li><strong>Demais administradores:</strong> entram apenas por convite emitido por um Super administrador.</li>
              <li><strong>Administrador setorial:</strong> opera somente nos setores atribuídos ao convite.</li>
              <li><strong>Super administrador:</strong> entra com seu e-mail confirmado e sua senha.</li>
            </ol>
            <button type="button" className="admin-primary" onClick={() => setShowHelp(false)}>Fechar</button>
          </div>
        </div>
      )}
    </section>
  );
}
