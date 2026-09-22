import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, ShieldAlert, Sprout } from "lucide-react";
import { api } from "../../lib/api";
import type { ShellSession } from "../../hooks/useSession";
import { NewPasswordSchema, PortalRoleSchema, type PortalRole } from "../../../shared/contracts/auth";
import { PasswordInput } from "../../components/forms/PasswordInput";
import { PasswordStrengthMeter } from "../../components/forms/PasswordStrengthMeter";
import "./auth.css";

function queryContext() {
  const params = new URLSearchParams(location.search);
  const role = PortalRoleSchema.safeParse(params.get("portal"));
  return {
    role: role.success ? role.data : null,
    flowToken: params.get("flow") ?? "",
  };
}

function loginPath(role: PortalRole) {
  if (role === "consumer") return "/entrar/consumidor";
  if (role === "producer") return "/entrar/produtor";
  if (role === "platform_admin") return "/entrar/administrador";
  return "/entrar/super-administrador";
}

export function ResetPasswordPage({
  session,
  onNavigate,
  onSessionAdopt,
  onSessionRefresh,
}: {
  session: ShellSession | null;
  onNavigate: (path: string) => void;
  onSessionAdopt: (session: ShellSession | null) => void;
  onSessionRefresh: () => Promise<void>;
}) {
  const context = useMemo(queryContext, []);
  const [ready, setReady] = useState(Boolean(session && context.role && context.flowToken));
  const [checking, setChecking] = useState(!ready);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (ready) return;
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const type = hash.get("type");

    if (!context.role || context.flowToken.length < 32 || !accessToken || !refreshToken || type !== "recovery") {
      setChecking(false);
      return;
    }

    void api<ShellSession & { status?: string }>("/v1/auth/import-session", {
      method: "POST",
      body: JSON.stringify({
        accessToken,
        refreshToken,
        portalRole: context.role,
      }),
    })
      .then(async (imported) => {
        onSessionAdopt(imported);
        history.replaceState({}, "", location.pathname + location.search);
        await onSessionRefresh();
        setReady(true);
        setNotice("Acesso de recuperação validado. Agora defina sua nova senha.");
      })
      .catch(() => setNotice("O link expirou ou já foi utilizado. Solicite um novo."))
      .finally(() => setChecking(false));
  }, [context.flowToken, context.role, onSessionAdopt, onSessionRefresh, ready]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || !context.role) return;
    if (password !== confirmation) {
      setNotice("As senhas não coincidem.");
      return;
    }
    const parsed = NewPasswordSchema.safeParse({ password });
    if (!parsed.success) {
      setNotice(parsed.error.issues.map((item) => item.message).join(". "));
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      await api("/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          password,
          portalRole: context.role,
          flowToken: context.flowToken,
        }),
      });
      onSessionAdopt(null);
      setDone(true);
      setNotice("Senha atualizada com sucesso. Todas as sessões anteriores foram encerradas.");
    } catch {
      setNotice("Não foi possível redefinir a senha. Solicite um novo link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="t04-security-layout" aria-labelledby="t04-reset-title">
      <aside className="t04-security-aside">
        <div className="t04-brand-mark"><Sprout /></div>
        <span className="t04-kicker">Nova senha</span>
        <h2>Uma nova chave para o seu acesso.</h2>
        <p>Depois da troca, a sessão atual é encerrada e o próximo acesso usa somente a nova senha.</p>
        <div className="t04-steps">
          <span><b>1</b> Link de recuperação</span>
          <span><b>2</b> Nova senha forte</span>
          <span><b>3</b> Novo login seguro</span>
        </div>
      </aside>

      <div className="t04-security-card">
        <div className={done ? "t04-title-icon success" : "t04-title-icon"}>
          {done ? <CheckCircle2 /> : <KeyRound />}
        </div>
        <span className="eyebrow">Segurança da conta</span>
        <h1 id="t04-reset-title">{done ? "Senha atualizada" : "Definir nova senha"}</h1>

        {checking ? (
          <div className="t04-loading"><span className="t04-spinner" /><p>Validando o link seguro…</p></div>
        ) : done ? (
          <>
            <div className="t04-banner success" role="status">{notice}</div>
            <button className="t04-primary" onClick={() => onNavigate(loginPath(context.role!))}>
              Entrar novamente
            </button>
          </>
        ) : !ready ? (
          <>
            <div className="t04-invalid">
              <ShieldAlert />
              <div>
                <strong>Link inválido ou expirado</strong>
                <p>{notice || "Solicite um novo e-mail de recuperação pelo perfil correto."}</p>
              </div>
            </div>
            <button
              className="t04-primary"
              onClick={() => onNavigate(context.role ? `/recuperar-senha?portal=${context.role}` : "/recuperar-senha")}
            >
              Solicitar novo link
            </button>
          </>
        ) : (
          <>
            <p className="t04-lead">Escolha uma senha forte. O sistema manterá as mesmas regras de segurança já homologadas.</p>
            {notice && <div className="t04-banner" role="status">{notice}</div>}
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
              <button className="t04-primary" disabled={busy}>
                {busy ? "Salvando…" : "Salvar nova senha"}
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
