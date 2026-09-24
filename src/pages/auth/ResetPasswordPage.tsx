import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, ShieldAlert, Sprout } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import type { ShellSession } from "../../hooks/useSession";
import {
  NewPasswordSchema,
  PortalRoleSchema,
  type PortalRole,
} from "../../../shared/contracts/auth";
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
  onNavigate,
  onSessionAdopt,
}: {
  session: ShellSession | null;
  onNavigate: (path: string) => void;
  onSessionAdopt: (session: ShellSession | null) => void;
  onSessionRefresh: () => Promise<void>;
}) {
  const context = useMemo(queryContext, []);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [validationAttempt, setValidationAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setRetryable(false);
    if (!context.role || context.flowToken.length < 32) {
      setChecking(false);
      return;
    }

    // Fragmentos de sessão do Supabase não são mais requisito para a
    // recuperação. O flow HortiVitalMix é aleatório, curto, single-use e
    // armazenado somente como digest no servidor.
    if (location.hash) history.replaceState({}, "", location.pathname + location.search);

    void api<{ status: string }>("/v1/auth/password/recovery/validate", {
      method: "POST",
      body: JSON.stringify({
        portalRole: context.role,
        flowToken: context.flowToken,
      }),
    })
      .then((result) => {
        if (cancelled) return;
        if (result.status === "valid") {
          setReady(true);
          setNotice("Link validado. Defina agora sua nova senha.");
        }
      })
      .catch((error: ApiFailure) => {
        if (cancelled) return;
        const invalid = error.status === 410 || error.message === "RECOVERY_CONTEXT_INVALID";
        setRetryable(!invalid);
        setNotice(invalid
          ? "Este link já foi utilizado, foi substituído por um e-mail mais novo ou expirou."
          : "Não foi possível consultar o link agora. Tente validar novamente; não é necessário pedir outro e-mail." +
            (error.requestId ? ` Código de atendimento: ${error.requestId}.` : ""));
      })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [context.flowToken, context.role, validationAttempt]);

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
      setReady(false);
      setNotice(
        "Senha atualizada com sucesso. As sessões anteriores foram revogadas.",
      );
    } catch (error) {
      const failure = error as ApiFailure;
      setNotice(failure.status === 410 || failure.message === "RECOVERY_CONTEXT_ALREADY_USED"
        ? "Este link não está mais disponível. Solicite outro e-mail de recuperação."
        : failure.message === "PASSWORD_UPDATE_REJECTED"
          ? "A nova senha não foi aceita. Confira os requisitos e use uma senha diferente da atual."
          : "Não foi possível concluir a troca agora. Tente novamente." +
            (failure.requestId ? ` Código de atendimento: ${failure.requestId}.` : ""));
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
        <p>
          O link possui um contexto de recuperação próprio e não depende de
          uma sessão anterior do navegador.
        </p>
        <div className="t04-steps">
          <span><b>1</b> Link seguro</span>
          <span><b>2</b> Nova senha forte</span>
          <span><b>3</b> Novo login seguro</span>
        </div>
      </aside>

      <div className="t04-security-card">
        <div className={done ? "t04-title-icon success" : "t04-title-icon"}>
          {done ? <CheckCircle2 /> : <KeyRound />}
        </div>
        <span className="eyebrow">Segurança da conta</span>
        <h1 id="t04-reset-title">
          {done ? "Senha atualizada" : "Definir nova senha"}
        </h1>

        {checking ? (
          <div className="t04-loading">
            <span className="t04-spinner" />
            <p>Validando o link seguro…</p>
          </div>
        ) : done ? (
          <>
            <div className="t04-banner success" role="status">{notice}</div>
            <button
              className="t04-primary"
              onClick={() => onNavigate(loginPath(context.role!))}
            >
              Entrar novamente
            </button>
          </>
        ) : !ready ? (
          <>
            <div className="t04-invalid">
              <ShieldAlert />
              <div>
                <strong>{retryable ? "Validação temporariamente indisponível" : "Link indisponível"}</strong>
                <p>
                  {notice ||
                    "Solicite um novo e-mail de recuperação pelo perfil correto."}
                </p>
              </div>
            </div>
            <button
              className="t04-primary"
              onClick={() =>
                retryable ? setValidationAttempt((value) => value + 1) : onNavigate(
                  context.role
                    ? `/recuperar-senha?portal=${context.role}`
                    : "/recuperar-senha",
                )
              }
            >
              {retryable ? "Validar novamente" : "Solicitar novo link"}
            </button>
          </>
        ) : (
          <>
            <p className="t04-lead">
              Escolha uma senha forte. A redefinição encerra as sessões
              anteriores da conta.
            </p>
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
