import { useState, type FormEvent } from "react";
import { KeyRound, Leaf, ShoppingBag, Sprout, Plus } from "lucide-react";
import { PasswordInput } from "../../components/forms/PasswordInput";
import { api, type ApiFailure } from "../../lib/api";
import type { ShellSession } from "../../hooks/useSession";
import "../admin/admin.css";

export function PublicLoginPage({ role, onNavigate, onSessionAdopt }: {
  role: "consumer" | "producer";
  onNavigate: (path: string) => void;
  onSessionAdopt: (session: ShellSession) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const producer = role === "producer";
  const label = producer ? "Produtor" : "Consumidor";
  const Icon = producer ? Sprout : ShoppingBag;
  const params = new URLSearchParams(location.search);
  const notice = params.get("roleAdded") === "1" ? "Novo perfil adicionado à sua conta. Você já pode entrar." : params.get("registered") === "1" ? "Cadastro realizado. Confira a confirmação enviada ao seu e-mail." : "";
  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const session = await api<ShellSession>("/v1/auth/login", {
        method: "POST", body: JSON.stringify({ email: email.trim(), password, portalRole: role }),
      });
      onSessionAdopt(session);
      onNavigate("/conta");
    } catch (failure) {
      const e = failure as ApiFailure;
      const messages: Record<string, string> = {
        INVALID_CREDENTIALS: "E-mail ou senha incorretos.",
        EMAIL_CONFIRMATION_REQUIRED: "Confirme seu e-mail antes de entrar. Use a opção de confirmação abaixo.",
        ROLE_NOT_ALLOWED_FOR_PORTAL: "Esta conta não possui o perfil selecionado. Confira o tipo de acesso.",
        ACCOUNT_UNAVAILABLE: "Esta conta está indisponível. Entre em contato com o suporte.",
      };
      setError(messages[e.message] ?? (e.status === 429 ? "Aguarde alguns instantes antes de tentar novamente." : "Não foi possível entrar agora. Confira sua conexão e tente novamente."));
    } finally { setBusy(false); }
  }
  return <section className="admin-login-page public-login-page">
    <header className="admin-login-header">
      <button className="admin-back" onClick={() => onNavigate("/entrar")}>← Escolher outro perfil</button>
      <button className="admin-login-brand" aria-label="HortiVitalMix — início" onClick={() => onNavigate("/")}>
        <span className="admin-brand-mark"><Leaf /></span><strong>Horti<span>Vital</span>Mix</strong>
      </button>
    </header>
    <div className="admin-login-layout">
      <div className="admin-login-copy">
        <span className="admin-kicker"><Icon size={15}/>{producer ? "Portal do produtor" : "Portal do consumidor"}</span>
        <h1>Entrar como {label}.</h1>
        <p>{producer ? "Acesse sua conta de produtor e mantenha seus dados organizados para participar do HortiVitalMix." : "Acesse sua conta para cuidar dos seus dados e dos locais onde prefere receber suas compras."}</p>
      </div>
      <div className="admin-login-card">
        <form onSubmit={login}>
          <div className="admin-login-icon"><KeyRound /></div>
          <h2>Entrar como {label}</h2>
          <p className="admin-muted">Use o e-mail confirmado e a senha do seu perfil de {label.toLowerCase()}.</p>
          {error && <div className="admin-alert admin-alert--error" role="alert">{error}</div>}
          {notice && <div className="admin-alert" role="status">{notice}</div>}
          <label>E-mail<input name="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <PasswordInput value={password} onChange={setPassword}/>
          <button className="admin-primary" disabled={busy}>{busy ? "Validando…" : "Entrar"}</button>
          <button type="button" className="admin-link" onClick={() => onNavigate(`/recuperar-senha?portal=${role}`)}>Esqueci minha senha</button>
          <button type="button" className="admin-link" onClick={() => onNavigate(`/confirmar-contato?portal=${role}`)}>Reenviar confirmação</button>
          <button type="button" className="admin-secondary" onClick={() => onNavigate(producer ? "/cadastro/produtor" : "/cadastro/consumidor")}><Plus size={17}/>Criar cadastro de {label.toLowerCase()}</button>
        </form>
      </div>
    </div>
  </section>;
}
