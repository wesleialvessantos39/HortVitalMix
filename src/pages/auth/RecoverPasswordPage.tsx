import { useMemo, useState } from "react";
import { KeyRound, Mail, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import type { PortalRole } from "../../../shared/contracts/auth";
import type { PasswordRecoveryRequestResult } from "../../../shared/contracts/contactRecovery";
import "./auth.css";

const ROLES: Array<{ role: PortalRole; label: string }> = [
  { role: "consumer", label: "Consumidor" },
  { role: "producer", label: "Produtor" },
  { role: "platform_admin", label: "Administrador" },
  { role: "platform_super_admin", label: "Super administrador" },
];

function isPortalRole(value: string | null): value is PortalRole {
  return ROLES.some(({ role }) => role === value);
}

export function RecoverPasswordPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const initial = useMemo(() => {
    const value = new URLSearchParams(location.search).get("portal");
    return isPortalRole(value) ? value : null;
  }, []);
  const [role, setRole] = useState<PortalRole | null>(initial);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!role) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api<PasswordRecoveryRequestResult>("/v1/auth/password/recovery", {
        method: "POST",
        body: JSON.stringify({
          email,
          portalRole: role,
          commandId: crypto.randomUUID(),
        }),
      });
      if (result.status === "accepted") {
        setSent(true);
        setMessage(result.message);
      } else {
        setMessage("Aguarde alguns minutos antes de tentar novamente.");
      }
    } catch (error) {
      setMessage(
        (error as { status?: number }).status === 429
          ? "Muitas solicitações recentes. Tente novamente mais tarde."
          : "Não foi possível processar a solicitação agora.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="t04-page">
      <div className="t04-card t04-auth-card">
        <span className="t04-icon"><KeyRound /></span>
        <span className="eyebrow">Segurança da conta</span>
        <h1>Recuperar senha</h1>
        <p>A recuperação permanece vinculada ao perfil de origem. Por segurança, a resposta não informa se o e-mail existe.</p>

        {!role ? (
          <div className="t04-role-grid" aria-label="Escolha o perfil">
            {ROLES.map((item) => (
              <button className="t04-role-option" key={item.role} onClick={() => setRole(item.role)}>
                <ShieldCheck size={18} />
                {item.label}
              </button>
            ))}
          </div>
        ) : sent ? (
          <div className="t04-result">
            <Mail />
            <h2>Confira seu e-mail</h2>
            <p role="status">{message}</p>
            <button className="t04-secondary" onClick={() => setSent(false)}>Enviar novamente</button>
          </div>
        ) : (
          <form onSubmit={submit} className="t04-form">
            <div className="t04-context">Perfil: <strong>{ROLES.find((item) => item.role === role)?.label}</strong></div>
            <label>
              E-mail
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                required
                maxLength={255}
              />
            </label>
            {message && <p className="t04-notice" role="status">{message}</p>}
            <button className="primary" disabled={busy}>{busy ? "Enviando…" : "Enviar link de recuperação"}</button>
            <button type="button" className="text-button" onClick={() => setRole(null)}>Trocar perfil</button>
          </form>
        )}
        <button className="text-button t04-back" onClick={() => onNavigate("/entrar")}>Voltar para entrar</button>
      </div>
    </section>
  );
}
