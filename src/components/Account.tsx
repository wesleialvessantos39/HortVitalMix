import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import {
  RegisterConsumerSchema,
  RegisterProducerSchema,
} from "../../shared/contracts/auth";

type Session = { userId: string; email: string; roles: string[] };
type Mode =
  | "login"
  | "consumer"
  | "producer"
  | "recovery"
  | "confirmation"
  | "magic"
  | "reset";

function modeFromPath(path: string): Mode {
  if (path === "/recuperar-senha") return "recovery";
  if (path === "/redefinir-senha") return "reset";
  if (path === "/confirmar-contato") return "confirmation";
  return "login";
}

export function Account({ path = "/conta" }: { path?: string }) {
  const [mode, setMode] = useState<Mode>(() => modeFromPath(path));
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [securityFlow, setSecurityFlow] = useState(false);

  useEffect(() => {
    setMode(modeFromPath(path));
  }, [path]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const type = hash.get("type");

      if (accessToken && refreshToken) {
        try {
          await api("/v1/auth/import-session", {
            method: "POST",
            body: JSON.stringify({ accessToken, refreshToken }),
          });

          history.replaceState(
            {},
            "",
            location.pathname + location.search,
          );

          if (!cancelled && (type === "recovery" || path === "/redefinir-senha")) {
            setMode("reset");
            setNotice("Acesso de recuperação validado. Defina sua nova senha.");
            return;
          }
        } catch {
          if (!cancelled) {
            setNotice(
              "O link de segurança expirou ou já foi utilizado. Solicite um novo.",
            );
          }
        }
      }

      try {
        const current = await api<Session>("/v1/auth/session");
        if (!cancelled) setSession(current);
      } catch {
        // Estado sem sessão é esperado na tela pública de acesso.
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [path]);

  function changeMode(next: Mode) {
    setMode(next);
    setNotice("");
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice("");
    const form = Object.fromEntries(new FormData(e.currentTarget));

    if (mode === "consumer" || mode === "producer") {
      const parsed = (
        mode === "producer" ? RegisterProducerSchema : RegisterConsumerSchema
      ).safeParse(form);

      if (!parsed.success) {
        setNotice(parsed.error.issues.map((issue) => issue.message).join(". "));
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "login") {
        await api("/v1/auth/login", {
          method: "POST",
          body: JSON.stringify(form),
        });
        setSession(await api<Session>("/v1/auth/session"));
        return;
      }

      if (mode === "consumer" || mode === "producer") {
        const result = await api<{
          confirmationRequired: boolean;
          confirmationDispatchAccepted: boolean;
        }>("/v1/auth/register-" + mode, {
          method: "POST",
          body: JSON.stringify(form),
        });

        setNotice(
          result.confirmationDispatchAccepted
            ? "Cadastro realizado. Enviamos a confirmação para o seu e-mail."
            : "Cadastro realizado, mas o e-mail não pôde ser enviado agora. Use “Reenviar confirmação”.",
        );
        setMode("login");
        return;
      }

      if (mode === "recovery") {
        await api("/v1/auth/request-password-reset", {
          method: "POST",
          body: JSON.stringify({ email: form.email }),
        });
        setNotice(
          "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.",
        );
        return;
      }

      if (mode === "confirmation") {
        await api("/v1/auth/resend-confirmation", {
          method: "POST",
          body: JSON.stringify({ email: form.email }),
        });
        setNotice(
          "Se houver um cadastro pendente, uma nova confirmação será enviada.",
        );
        return;
      }

      if (mode === "magic") {
        await api("/v1/auth/magic-link", {
          method: "POST",
          body: JSON.stringify({ email: form.email }),
        });
        setNotice(
          "Se a conta estiver disponível, enviaremos um link ou código de acesso seguro.",
        );
        return;
      }

      if (mode === "reset") {
        await api("/v1/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ password: form.password }),
        });
        setSession(null);
        setMode("login");
        setNotice("Senha atualizada. Entre novamente com a nova senha.");
      }
    } catch (error) {
      const code = (error as Error).message;
      setNotice(
        code === "INVALID_CREDENTIALS"
          ? "E-mail ou senha inválidos."
          : code === "EMAIL_CONFIRMATION_REQUIRED"
            ? "Confirme seu e-mail antes de entrar. Se necessário, reenvie a confirmação."
            : code === "IDENTITY_CONFLICT"
              ? "Os dados de identificação já estão em uso."
              : code === "ACCOUNT_UNAVAILABLE"
                ? "Sua conta não está disponível para acesso."
                : code === "PASSWORD_UPDATE_REJECTED"
                  ? "Não foi possível aceitar a nova senha. Solicite um novo link de recuperação."
                  : "Não foi possível concluir agora. Tente novamente mais tarde.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestSecurityCode() {
    setBusy(true);
    setNotice("");
    try {
      await api("/v1/auth/reauthenticate", { method: "POST" });
      setSecurityFlow(true);
      setNotice("Enviamos um código de segurança para confirmar sua identidade.");
    } catch {
      setNotice("Não foi possível enviar o código de segurança agora.");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    const form = Object.fromEntries(new FormData(e.currentTarget));

    try {
      await api("/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          password: form.password,
          nonce: form.nonce,
        }),
      });
      setSession(null);
      setSecurityFlow(false);
      setMode("login");
      setNotice("Senha alterada. Entre novamente para continuar.");
    } catch (error) {
      setNotice(
        (error as Error).message === "SECURITY_CODE_REJECTED"
          ? "Código inválido ou expirado. Solicite um novo código."
          : "Não foi possível alterar a senha agora.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (session)
    return (
      <section className="account card">
        <span className="eyebrow">Acesso seguro</span>
        <h1>Minha conta</h1>
        <p>{session.email}</p>
        <p>
          Acesso:{" "}
          {session.roles
            .map(
              (role) =>
                ({
                  consumer: "Consumidor",
                  producer: "Produtor",
                  platform_admin: "Administrador",
                  platform_super_admin: "Superadministrador",
                })[role] ?? role,
            )
            .join(", ")}
        </p>

        {securityFlow ? (
          <form className="security-form" onSubmit={changePassword}>
            <h2>Alterar senha</h2>
            <p>
              Digite o código recebido e escolha uma nova senha com pelo menos
              12 caracteres.
            </p>
            <label>
              Código de segurança
              <input
                name="nonce"
                inputMode="numeric"
                autoComplete="one-time-code"
                minLength={6}
                maxLength={8}
                required
              />
            </label>
            <label>
              Nova senha
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <button className="primary" disabled={busy} type="submit">
              {busy ? "Aguarde…" : "Confirmar nova senha"}
            </button>
            <button
              className="text-button helper-action"
              type="button"
              disabled={busy}
              onClick={requestSecurityCode}
            >
              Enviar novo código
            </button>
          </form>
        ) : (
          <button
            className="secondary account-action"
            disabled={busy}
            type="button"
            onClick={requestSecurityCode}
          >
            Alterar senha com código de segurança
          </button>
        )}

        <button
          className="primary account-action"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/v1/auth/logout", { method: "POST" });
              setSession(null);
            } catch {
              setNotice("Não foi possível encerrar a sessão. Tente novamente.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Sair da conta
        </button>
        {notice && <p role="status" className="form-notice">{notice}</p>}
      </section>
    );

  const auxiliary =
    mode === "recovery" ||
    mode === "confirmation" ||
    mode === "magic" ||
    mode === "reset";

  const heading =
    mode === "login"
      ? "Entre na sua conta"
      : mode === "producer"
        ? "Cadastro do produtor"
        : mode === "consumer"
          ? "Crie sua conta"
          : mode === "recovery"
            ? "Recupere sua senha"
            : mode === "confirmation"
              ? "Confirme seu cadastro"
              : mode === "magic"
                ? "Acesso por link ou código"
                : "Defina sua nova senha";

  return (
    <section className="account card">
      <span className="eyebrow">
        {auxiliary ? "Segurança da conta" : "Faça parte da nossa região"}
      </span>
      <h1>{heading}</h1>
      <p>
        {mode === "producer"
          ? "Conecte sua produção a quem valoriza alimentos frescos."
          : mode === "recovery"
            ? "Informe seu e-mail para receber as instruções de redefinição."
            : mode === "confirmation"
              ? "Informe seu e-mail para reenviar a confirmação do cadastro."
              : mode === "magic"
                ? "Receba um link ou código de uso único para acessar sua conta."
                : mode === "reset"
                  ? "Use uma senha nova, diferente da anterior."
                  : "Que bom ter você por aqui."}
      </p>

      {!auxiliary && (
        <div className="account-tabs" aria-label="Tipo de acesso">
          {(["login", "consumer", "producer"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={mode === item ? "selected" : ""}
              onClick={() => changeMode(item)}
            >
              {item === "login"
                ? "Entrar"
                : item === "consumer"
                  ? "Consumidor"
                  : "Produtor"}
            </button>
          ))}
        </div>
      )}

      <form key={mode} onSubmit={submit}>
        {(mode === "consumer" || mode === "producer") && (
          <>
            <label>
              Nome completo
              <input
                name="fullName"
                autoComplete="name"
                required
                minLength={3}
                maxLength={255}
              />
            </label>
            <div className="form-grid">
              <label>
                CPF
                <input name="cpf" inputMode="numeric" required maxLength={14} />
              </label>
              <label>
                Celular com DDI
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+5569999999999"
                  required
                />
              </label>
            </div>
          </>
        )}

        {mode !== "reset" && (
          <label>
            E-mail
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={255}
            />
          </label>
        )}

        {(mode === "login" ||
          mode === "consumer" ||
          mode === "producer" ||
          mode === "reset") && (
          <label>
            {mode === "reset" ? "Nova senha" : "Senha"}
            <input
              name="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={mode === "login" ? 1 : 12}
              maxLength={128}
              required
            />
          </label>
        )}

        {(mode === "consumer" || mode === "producer" || mode === "reset") && (
          <small>Use uma senha com pelo menos 12 caracteres.</small>
        )}

        {mode === "producer" && (
          <>
            <label>
              Nome da sua produção
              <input name="brandName" required minLength={2} maxLength={128} />
            </label>
            <label>
              Atividade principal
              <select name="activityType" defaultValue="misto">
                <option value="misto">Produção mista</option>
                <option value="hortalicas_folhosas">Hortaliças folhosas</option>
                <option value="legumes_picados">Legumes picados</option>
                <option value="frutas">Frutas</option>
                <option value="temperos">Temperos</option>
              </select>
            </label>
          </>
        )}

        {notice && (
          <p role="status" className="form-notice">
            {notice}
          </p>
        )}

        <button disabled={busy} className="primary" type="submit">
          {busy
            ? "Aguarde…"
            : mode === "login"
              ? "Entrar"
              : mode === "consumer" || mode === "producer"
                ? "Criar cadastro"
                : mode === "recovery"
                  ? "Enviar recuperação"
                  : mode === "confirmation"
                    ? "Reenviar confirmação"
                    : mode === "magic"
                      ? "Enviar acesso seguro"
                      : "Salvar nova senha"}
        </button>
      </form>

      {mode === "login" && (
        <div className="account-helpers" aria-label="Opções de segurança">
          <button
            type="button"
            className="text-button"
            onClick={() => changeMode("recovery")}
          >
            Esqueci minha senha
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => changeMode("confirmation")}
          >
            Reenviar confirmação
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => changeMode("magic")}
          >
            Entrar com link ou código
          </button>
        </div>
      )}

      {auxiliary && (
        <button
          type="button"
          className="text-button helper-action"
          onClick={() => changeMode("login")}
        >
          Voltar para entrar
        </button>
      )}
    </section>
  );
}
