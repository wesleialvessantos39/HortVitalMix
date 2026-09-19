import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import {
  formatBrazilMobile,
  formatCpf,
  RegisterConsumerSchema,
  RegisterProducerSchema
} from "../../shared/contracts/auth";

type Session = {
  userId: string;
  email: string;
  roles: string[];
};

type Mode =
  | "login"
  | "consumer"
  | "producer"
  | "admin"
  | "recovery"
  | "confirmation"
  | "magic"
  | "reset";

function modeFromPath(path: string): Mode {
  if (path === "/cadastro/consumidor") return "consumer";
  if (path === "/cadastro/produtor") return "producer";
  if (path === "/acesso/administracao") return "admin";
  if (path === "/recuperar-senha") return "recovery";
  if (path === "/redefinir-senha") return "reset";
  if (path === "/confirmar-contato") return "confirmation";
  return "login";
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    consumer: "Consumidor",
    producer: "Produtor",
    platform_admin: "Administrador",
    platform_super_admin: "Super administrador",
  };
  return labels[role] ?? role;
}

export function Account({
  path = "/entrar",
  onNavigate,
}: {
  path?: string;
  onNavigate?: (to: string) => void;
}) {
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

          history.replaceState({}, "", location.pathname + location.search);

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
        // Estado sem sessão é esperado nas telas públicas.
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [path]);

  function navigate(to: string) {
    if (onNavigate) onNavigate(to);
    else location.assign(to);
  }

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
        navigate("/entrar");
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
        navigate("/entrar");
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
      navigate("/entrar");
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
            .map((role) => roleLabel(role))
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
        {notice && (
          <p role="status" className="form-notice">
            {notice}
          </p>
        )}
      </section>
    );

  if (mode === "admin")
    return (
      <section className="account card admin-prepared">
        <span className="eyebrow">Área administrativa</span>
        <h1>Login administrativo</h1>
        <p>
          Tela reservada para Administrador e Super administrador. A autorização
          continuará sendo definida pelo perfil real da conta, nunca por seleção
          manual na tela.
        </p>

        <div className="admin-role-preview" aria-label="Perfis administrativos previstos">
          <span>Administrador</span>
          <span>Super administrador</span>
        </div>

        <form aria-label="Login administrativo em preparação">
          <label>
            E-mail
            <input type="email" autoComplete="username" disabled />
          </label>
          <label>
            Senha
            <input type="password" autoComplete="current-password" disabled />
          </label>
          <button className="primary" type="button" disabled>
            Acesso administrativo — disponível futuramente
          </button>
        </form>

        <button
          type="button"
          className="text-button helper-action"
          onClick={() => navigate("/entrar")}
        >
          Voltar para login
        </button>
      </section>
    );

  const auxiliary =
    mode === "recovery" ||
    mode === "confirmation" ||
    mode === "magic" ||
    mode === "reset";

  const heading =
    mode === "login"
      ? "Entrar no HortiVitalMix"
      : mode === "producer"
        ? "Cadastro de produtor"
        : mode === "consumer"
          ? "Cadastro de consumidor"
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
          ? "Cadastre seus dados e identifique o imóvel ligado à sua produção."
          : mode === "consumer"
            ? "Cadastre seus dados para utilizar o HortiVitalMix."
            : mode === "recovery"
              ? "Informe seu e-mail para receber as instruções de redefinição."
              : mode === "confirmation"
                ? "Informe seu e-mail para reenviar a confirmação do cadastro."
                : mode === "magic"
                  ? "Receba um link ou código de uso único para acessar sua conta."
                  : mode === "reset"
                    ? "Use uma senha nova, diferente da anterior."
                    : "Informe suas credenciais para entrar."}
      </p>

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
                <input
                  name="cpf"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000.000.000-00"
                  maxLength={14}
                  onInput={(event) => {
                    event.currentTarget.value = formatCpf(event.currentTarget.value);
                  }}
                  required
                />
              </label>
              <label>
                Celular com DDD
                <input
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="(00) 00000-0000"
                  maxLength={15}
                  onInput={(event) => {
                    event.currentTarget.value = formatBrazilMobile(
                      event.currentTarget.value,
                    );
                  }}
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
              Nome de seu imóvel
              <input name="propertyName" required minLength={2} maxLength={128} />
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
        <>
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

          <div className="account-choice-grid" aria-label="Opções de cadastro">
            <button
              className="account-choice"
              type="button"
              onClick={() => navigate("/cadastro/consumidor")}
            >
              <strong>Cadastro de consumidor</strong>
              <span>Abra uma conta para comprar no HortiVitalMix.</span>
            </button>
            <button
              className="account-choice"
              type="button"
              onClick={() => navigate("/cadastro/produtor")}
            >
              <strong>Cadastro de produtor</strong>
              <span>Cadastre seu perfil e o nome de seu imóvel.</span>
            </button>
            <button
              className="account-choice account-choice-admin"
              type="button"
              onClick={() => navigate("/acesso/administracao")}
            >
              <strong>Acesso administrativo</strong>
              <span>Tela preparada para ativação futura.</span>
            </button>
          </div>
        </>
      )}

      {(mode === "consumer" || mode === "producer") && (
        <button
          type="button"
          className="text-button helper-action"
          onClick={() => navigate("/entrar")}
        >
          Já tenho cadastro — entrar
        </button>
      )}

      {auxiliary && (
        <button
          type="button"
          className="text-button helper-action"
          onClick={() => {
            changeMode("login");
            navigate("/entrar");
          }}
        >
          Voltar para entrar
        </button>
      )}
    </section>
  );
}
