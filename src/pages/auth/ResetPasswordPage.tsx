import { useMemo, useState } from "react";
import { CheckCircle2, KeyRound, ShieldAlert } from "lucide-react";
import { api } from "../../lib/api";
import { StrongPasswordSchema, type PortalRole } from "../../../shared/contracts/auth";
import type { PasswordResetResult } from "../../../shared/contracts/contactRecovery";
import { PasswordInput } from "../../components/forms/PasswordInput";
import { PasswordStrengthMeter } from "../../components/forms/PasswordStrengthMeter";
import "./auth.css";

const VALID_ROLES = new Set<string>(["consumer","producer","platform_admin","platform_super_admin"]);

function loginPath(role: PortalRole) {
  if (role === "consumer") return "/entrar/consumidor";
  if (role === "producer") return "/entrar/produtor";
  if (role === "platform_admin") return "/entrar/administrador";
  return "/entrar/super-administrador";
}

export function ResetPasswordPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const context = useMemo(() => {
    const search = new URLSearchParams(location.search);
    const role = search.get("portal");
    return {
      token: search.get("token") ?? "",
      flowToken: search.get("flow") ?? "",
      portalRole: VALID_ROLES.has(role ?? "") ? role as PortalRole : null,
    };
  }, []);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState("");

  const contextValid =
    context.token.length >= 32 &&
    context.flowToken.length >= 32 &&
    Boolean(context.portalRole);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!contextValid || !context.portalRole) return;
    if (password !== confirmation) {
      setMessage("As senhas não coincidem.");
      return;
    }
    const validation = StrongPasswordSchema.safeParse(password);
    if (!validation.success) {
      setMessage(validation.error.issues[0]?.message ?? "Senha inválida.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await api<PasswordResetResult>("/v1/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({
          token: context.token,
          flowToken: context.flowToken,
          portalRole: context.portalRole,
          newPassword: password,
        }),
      });
      if (result.status === "success") {
        setSuccess(true);
        setMessage("Senha redefinida. Todas as sessões anteriores foram encerradas.");
      } else {
        setMessage("O link expirou, já foi utilizado ou não corresponde a este perfil.");
      }
    } catch {
      setMessage("Não foi possível redefinir a senha. Solicite um novo link.");
    } finally {
      setBusy(false);
    }
  }

  if (!contextValid) {
    return (
      <section className="t04-page">
        <div className="t04-card t04-center t04-auth-card">
          <span className="t04-icon warning"><ShieldAlert /></span>
          <h1>Link de recuperação inválido</h1>
          <p>Este endereço não possui todos os dados de segurança necessários. Solicite um novo link pelo perfil correto.</p>
          <button className="primary" onClick={() => onNavigate("/recuperar-senha")}>Solicitar novo link</button>
        </div>
      </section>
    );
  }

  if (success && context.portalRole) {
    return (
      <section className="t04-page">
        <div className="t04-card t04-center t04-auth-card">
          <span className="t04-icon success"><CheckCircle2 /></span>
          <h1>Senha atualizada</h1>
          <p role="status">{message}</p>
          <button className="primary" onClick={() => onNavigate(loginPath(context.portalRole!))}>Entrar novamente</button>
        </div>
      </section>
    );
  }

  return (
    <section className="t04-page">
      <div className="t04-card t04-auth-card">
        <span className="t04-icon"><KeyRound /></span>
        <span className="eyebrow">Segurança da conta</span>
        <h1>Crie uma nova senha</h1>
        <p>Após a redefinição, todas as sessões ativas dessa identidade serão revogadas.</p>
        <form className="t04-form" onSubmit={submit}>
          <PasswordInput
            label="Nova senha"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          <PasswordStrengthMeter value={password} />
          <PasswordInput
            name="confirmPassword"
            label="Confirmar nova senha"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
          />
          {message && <p className="t04-notice" role="status">{message}</p>}
          <button className="primary" disabled={busy}>{busy ? "Salvando…" : "Salvar nova senha"}</button>
        </form>
      </div>
    </section>
  );
}
