import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import {
  formatBrazilMobile,
  formatCpf,
  NewPasswordSchema,
  passwordChecks,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RegisterConsumerSchema,
  RegisterProducerSchema,
} from "../../shared/contracts/auth";

type Session = {
  userId: string;
  email: string;
  roles: string[];
  activeRole?: string | null;
};

type Mode =
  | "login"
  | "loginConsumer"
  | "loginProducer"
  | "consumer"
  | "producer"
  | "admin"
  | "superAdmin"
  | "recovery"
  | "confirmation"
  | "magic"
  | "reset";

function modeFromPath(path: string): Mode {
  if (path === "/entrar/consumidor") return "loginConsumer";
  if (path === "/entrar/produtor") return "loginProducer";
  if (path === "/cadastro/consumidor") return "consumer";
  if (path === "/cadastro/produtor") return "producer";
  if (path === "/acesso/administracao") return "admin";
  if (path === "/acesso/super-administracao") return "superAdmin";
  if (path === "/recuperar-senha") return "recovery";
  if (path === "/redefinir-senha") return "reset";
  if (path === "/confirmar-contato") return "confirmation";
  return "login";
}

function portalRoleForMode(mode: Mode) {
  if (mode === "loginConsumer") return "consumer";
  if (mode === "loginProducer") return "producer";
  if (mode === "admin") return "platform_admin";
  if (mode === "superAdmin") return "platform_super_admin";
  return null;
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

type FieldErrors = Record<string, string>;

const requiredMessages: Record<string, string> = {
  fullName: "Informe seu nome completo.",
  cpf: "Informe seu CPF.",
  phone: "Informe seu celular com DDD.",
  email: "Informe seu e-mail.",
  password: "Crie uma senha.",
  confirmPassword: "Confirme sua senha.",
  propertyName: "Informe o nome de seu imóvel.",
  activityType: "Selecione a atividade principal.",
};

function friendlyFieldMessage(
  field: string,
  message: string,
  value?: unknown,
) {
  if (String(value ?? "").trim() === "") return requiredMessages[field] ?? message;

  if (field === "fullName")
    return "Informe seu nome completo com pelo menos 3 caracteres.";
  if (field === "cpf") return "Informe um CPF válido no formato 000.000.000-00.";
  if (field === "phone")
    return "Informe um celular válido com DDD no formato (00) 00000-0000.";
  if (field === "email") return "Informe um e-mail válido.";
  if (field === "password")
    return "A senha ainda não atende a todos os requisitos de segurança.";
  if (field === "propertyName")
    return "Informe o nome de seu imóvel com pelo menos 2 caracteres.";
  if (field === "activityType") return "Selecione a atividade principal.";
  return message;
}

function PasswordFields({
  password,
  confirmation,
  onPasswordChange,
  onConfirmationChange,
  label = "Senha",
  passwordError,
  confirmationError,
}: {
  password: string;
  confirmation: string;
  onPasswordChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  label?: string;
  passwordError?: string;
  confirmationError?: string;
}) {
  const [visible, setVisible] = useState(false);
  const checks = passwordChecks(password);
  const matches = confirmation.length > 0 && password === confirmation;

  const rules = [
    [checks.length, `Entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres`],
    [checks.lowercase, "Letra minúscula"],
    [checks.uppercase, "Letra maiúscula"],
    [checks.number, "Número"],
    [checks.symbol, "Símbolo, por exemplo: ! @ # $ %"],
  ] as const;

  return (
    <div className="password-security">
      <label>
        {label}
        <div className="password-input">
          <input
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            value={password}
            aria-invalid={Boolean(passwordError)}
            aria-describedby={passwordError ? "password-error" : undefined}
            onChange={(event) => onPasswordChange(event.currentTarget.value)}
            required
          />
          <button
            type="button"
            className="password-visibility"
            aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? "Ocultar" : "Mostrar"}
          </button>
        </div>
        {passwordError && (
          <small id="password-error" className="field-error" role="alert">
            {passwordError}
          </small>
        )}
      </label>

      <div className="password-rules" aria-live="polite">
        <strong>Sua senha deve conter:</strong>
        <ul>
          {rules.map(([valid, text]) => (
            <li key={text} className={valid ? "valid" : undefined}>
              <span aria-hidden="true">{valid ? "✓" : "○"}</span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      <label>
        Confirmar senha
        <input
          name="confirmPassword"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          value={confirmation}
          aria-invalid={Boolean(confirmationError)}
          aria-describedby={
            confirmationError ? "confirm-password-error" : undefined
          }
          onChange={(event) => onConfirmationChange(event.currentTarget.value)}
          required
        />
        {confirmationError && (
          <small
            id="confirm-password-error"
            className="field-error"
            role="alert"
          >
            {confirmationError}
          </small>
        )}
      </label>
      {confirmation.length > 0 && (
        <small
          className={matches ? "password-match valid" : "password-match invalid"}
          role="status"
        >
          {matches ? "✓ As senhas coincidem." : "As senhas não coincidem."}
        </small>
      )}
    </div>
  );
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
  const [passwordValue, setPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loginPasswordVisible, setLoginPasswordVisible] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    setMode(modeFromPath(path));
    setPasswordValue("");
    setConfirmPassword("");
    setLoginPasswordVisible(false);
    setFieldErrors({});
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

          if (!cancelled && type === "signup") {
            setNotice(
              "E-mail confirmado com sucesso. Sua conta já está pronta para uso.",
            );
          }

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
    setFieldErrors({});
    setPasswordValue("");
    setConfirmPassword("");
    setLoginPasswordVisible(false);
  }

  function clearFieldError(name: string) {
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function showFieldErrors(errors: FieldErrors) {
    setFieldErrors(errors);
    setNotice("Revise os campos destacados para continuar.");
    const first = Object.keys(errors)[0];
    if (first)
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      });
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice("");
    setFieldErrors({});
    const rawForm = Object.fromEntries(new FormData(e.currentTarget));
    const { confirmPassword: confirmation, ...form } = rawForm;

    if (mode === "consumer" || mode === "producer") {
      const parsed = (
        mode === "producer" ? RegisterProducerSchema : RegisterConsumerSchema
      ).safeParse(form);
      const errors: FieldErrors = {};

      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = String(issue.path[0] ?? "");
          if (field && !errors[field])
            errors[field] = friendlyFieldMessage(
              field,
              issue.message,
              form[field],
            );
        }
      }

      if (String(confirmation ?? "") === "")
        errors.confirmPassword = requiredMessages.confirmPassword;
      else if (form.password !== confirmation)
        errors.confirmPassword = "A confirmação deve ser igual à senha.";

      if (Object.keys(errors).length) {
        showFieldErrors(errors);
        return;
      }
    }

    if (mode === "reset") {
      const errors: FieldErrors = {};
      if (String(form.password ?? "") === "")
        errors.password = requiredMessages.password;
      if (String(confirmation ?? "") === "")
        errors.confirmPassword = requiredMessages.confirmPassword;
      else if (form.password !== confirmation)
        errors.confirmPassword = "A confirmação deve ser igual à senha.";

      if (Object.keys(errors).length) {
        showFieldErrors(errors);
        return;
      }
    }

    setBusy(true);
    try {
      const portalRole = portalRoleForMode(mode);
      if (portalRole) {
        await api("/v1/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: form.email,
            password: form.password,
            portalRole,
          }),
        });
        const currentSession = await api<Session>("/v1/auth/session");
        setSession(currentSession);
        navigate("/conta");
        return;
      }

      if (mode === "consumer" || mode === "producer") {
        const result = await api<{
          confirmationRequired: boolean;
          confirmationDispatchAccepted: boolean;
          existingIdentity?: boolean;
          roleAdded?: boolean;
          role?: "consumer" | "producer";
        }>("/v1/auth/register-" + mode, {
          method: "POST",
          body: JSON.stringify(form),
        });

        setNotice(
          result.existingIdentity
            ? mode === "producer"
              ? "Perfil de produtor adicionado à sua conta existente. Entre pelo Login do Produtor."
              : "Perfil de consumidor adicionado à sua conta existente. Entre pelo Login do Consumidor."
            : result.confirmationDispatchAccepted
              ? "Cadastro realizado. Enviamos a confirmação para o seu e-mail."
              : "Cadastro realizado, mas o e-mail não pôde ser enviado agora. Use “Reenviar confirmação”.",
        );
        navigate(mode === "producer" ? "/entrar/produtor" : "/entrar/consumidor");
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
        const parsed = NewPasswordSchema.safeParse({ password: form.password });
        if (!parsed.success) {
          setNotice(parsed.error.issues.map((issue) => issue.message).join(". "));
          return;
        }
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
      const failure = error as Error & {
        fields?: Array<{ field: string; message: string }>;
        requestId?: string;
      };
      const code = failure.message;

      if (code === "VALIDATION_ERROR" && failure.fields?.length) {
        const errors: FieldErrors = {};
        for (const item of failure.fields)
          if (item.field && !errors[item.field])
            errors[item.field] = friendlyFieldMessage(
              item.field,
              item.message,
              rawForm[item.field],
            );
        showFieldErrors(errors);
        return;
      }

      const requestSuffix = failure.requestId
        ? ` Código de atendimento: ${failure.requestId}.`
        : "";

      setNotice(
        code === "INVALID_CREDENTIALS"
          ? "E-mail ou senha inválidos."
          : code === "EMAIL_CONFIRMATION_REQUIRED"
            ? "Confirme seu e-mail antes de entrar. Se necessário, reenvie a confirmação."
            : code === "ROLE_NOT_ALLOWED_FOR_PORTAL"
              ? "Esta conta existe, mas não possui acesso a este portal. Use o login correspondente ao seu perfil."
              : code === "ROLE_ALREADY_ASSIGNED"
                ? "Este perfil já está habilitado nesta conta. Use o login correspondente."
                : code === "CPF_LINKED_TO_EXISTING_ACCOUNT"
                  ? "Este CPF já pertence a uma conta. Para adicionar outro perfil, use o mesmo e-mail e a mesma senha da conta existente."
                  : code === "EXISTING_ACCOUNT_CREDENTIALS_INVALID"
                    ? "O CPF já possui conta. Informe o mesmo e-mail e a senha dessa conta para habilitar o novo perfil."
                    : code === "EXISTING_ACCOUNT_CONFIRM_REQUIRED"
                      ? "Confirme primeiro o e-mail da conta existente e depois tente habilitar o novo perfil."
                      : code === "IDENTITY_CONFLICT"
                        ? "Já existe uma identidade com dados diferentes. Confira CPF e e-mail antes de continuar."
                        : code === "REGISTRATION_RATE_LIMITED"
                ? "Foram feitas muitas tentativas de cadastro. Tente novamente em alguns minutos."
                : code === "AUTH_UNAVAILABLE"
                  ? "O serviço de autenticação está temporariamente indisponível." + requestSuffix
                  : code === "DATABASE_UNAVAILABLE"
                    ? "O cadastro não conseguiu acessar o banco de dados." + requestSuffix
                    : code === "ORIGIN_NOT_ALLOWED"
                      ? "A página de cadastro não foi reconhecida como origem segura. Atualize a página e tente novamente." + requestSuffix
                      : code === "ACCOUNT_UNAVAILABLE"
                        ? "Sua conta não está disponível para acesso."
                        : code === "PASSWORD_UPDATE_REJECTED"
                          ? "Não foi possível aceitar a nova senha. Solicite um novo link de recuperação."
                          : code === "DEPENDENCY_UNAVAILABLE"
                            ? "O serviço de cadastro está temporariamente indisponível." + requestSuffix
                            : code === "REGISTRATION_SCHEMA_OUTDATED"
                              ? "O banco de dados ainda não recebeu a atualização necessária para concluir o cadastro." + requestSuffix
                              : code === "REGISTRATION_DATA_REJECTED"
                                ? "Os dados foram recusados pelo cadastro. Revise os campos e tente novamente." + requestSuffix
                                : code === "REGISTRATION_INTERNAL_ERROR"
                                  ? "Ocorreu uma falha interna durante o cadastro." + requestSuffix
                                  : code === "REQUEST_TIMEOUT"
                                    ? "O servidor demorou mais do que o esperado para responder. O cadastro não foi confirmado."
                                    : code === "NETWORK_UNAVAILABLE"
                                      ? "Não foi possível conectar ao servidor de cadastro. Verifique a conexão e tente novamente."
                                      : code === "INVALID_API_RESPONSE"
                                        ? "A função de cadastro respondeu de forma inválida. O erro foi identificado para correção."
                                        : code === "REGISTRATION_STATUS_UNKNOWN"
                                          ? "O servidor perdeu a confirmação final do cadastro e não apagou a conta por segurança. Não repita o cadastro agora; tente entrar ou recuperar a senha." + requestSuffix
                                          : code === "HTTP_400"
                                            ? "A plataforma recusou a solicitação como inválida (HTTP 400)." + requestSuffix
                                            : code === "HTTP_401"
                                              ? "A plataforma recusou a solicitação por autenticação (HTTP 401)." + requestSuffix
                                              : code === "HTTP_403"
                                                ? "A plataforma bloqueou esta solicitação (HTTP 403)." + requestSuffix
                                                : code === "HTTP_404"
                                                  ? "A rota de cadastro não foi encontrada (HTTP 404)." + requestSuffix
                                                  : code === "HTTP_405"
                                                    ? "A rota existe, mas recusou o método POST (HTTP 405)." + requestSuffix
                                                    : code === "HTTP_413"
                                                      ? "A plataforma recusou o tamanho da solicitação (HTTP 413)." + requestSuffix
                                                      : code === "HTTP_429"
                                                        ? "A plataforma limitou temporariamente as tentativas de cadastro (HTTP 429)." + requestSuffix
                                                        : code === "HTTP_500"
                                                          ? "A função de cadastro falhou internamente (HTTP 500)." + requestSuffix
                                                          : code === "HTTP_502"
                                                            ? "O gateway não conseguiu concluir a chamada ao cadastro (HTTP 502)." + requestSuffix
                                                            : code === "HTTP_503"
                                                              ? "O serviço de cadastro está indisponível no momento (HTTP 503)." + requestSuffix
                                                              : code === "HTTP_504"
                                                                ? "A plataforma encerrou a solicitação por tempo excedido (HTTP 504)." + requestSuffix
                                                                : code.startsWith("HTTP_")
                                                                  ? "A plataforma recusou a solicitação com " + code.replace("_", " ") + "." + requestSuffix
                                                                  : "Falha não identificada no cadastro: " + code + requestSuffix,
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
    setNotice("");
    const form = Object.fromEntries(new FormData(e.currentTarget));
    if (form.password !== form.confirmPassword) {
      setNotice("As senhas não coincidem.");
      return;
    }
    const parsed = NewPasswordSchema.safeParse({ password: form.password });
    if (!parsed.success) {
      setNotice(parsed.error.issues.map((issue) => issue.message).join(". "));
      return;
    }

    setBusy(true);
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
          <form
            className="security-form"
            onSubmit={changePassword}
            noValidate
            onInputCapture={(event) => {
              const name = (event.target as HTMLInputElement).name;
              if (name) clearFieldError(name);
            }}
          >
            <h2>Alterar senha</h2>
            <p>
              Digite o código recebido e crie uma senha forte.
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
            <PasswordFields
              label="Nova senha"
              password={passwordValue}
              confirmation={confirmPassword}
              onPasswordChange={(value) => {
                setPasswordValue(value);
                clearFieldError("password");
              }}
              onConfirmationChange={(value) => {
                setConfirmPassword(value);
                clearFieldError("confirmPassword");
              }}
              passwordError={fieldErrors.password}
              confirmationError={fieldErrors.confirmPassword}
            />
            <button
              className="primary"
              disabled={busy}
              type="submit"
            >
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

  if (mode === "login")
    return (
      <section className="account card">
        <span className="eyebrow">Acesso seguro</span>
        <h1>Escolha seu perfil de acesso</h1>
        <p>
          Cada portal valida o perfil real da conta. A mesma identidade pode ter
          os perfis Consumidor e Produtor, mantendo as experiências separadas.
        </p>

        <div className="account-choice-grid" aria-label="Perfis de acesso">
          <button className="account-choice" type="button" onClick={() => navigate("/entrar/consumidor")}>
            <strong>Login do Consumidor</strong>
            <span>Compras, conta e recursos do consumidor.</span>
          </button>
          <button className="account-choice" type="button" onClick={() => navigate("/entrar/produtor")}>
            <strong>Login do Produtor</strong>
            <span>Perfil de produção e recursos do produtor.</span>
          </button>
          <button className="account-choice account-choice-admin" type="button" onClick={() => navigate("/acesso/administracao")}>
            <strong>Login do Administrador</strong>
            <span>Acesso restrito ao perfil Administrador.</span>
          </button>
          <button className="account-choice account-choice-admin" type="button" onClick={() => navigate("/acesso/super-administracao")}>
            <strong>Login do Super administrador</strong>
            <span>Acesso restrito ao perfil Super administrador.</span>
          </button>
        </div>

        <div className="account-helpers" aria-label="Opções de cadastro">
          <button type="button" className="text-button" onClick={() => navigate("/cadastro/consumidor")}>
            Criar cadastro de consumidor
          </button>
          <button type="button" className="text-button" onClick={() => navigate("/cadastro/produtor")}>
            Criar cadastro de produtor
          </button>
        </div>
      </section>
    );

  const auxiliary =
    mode === "recovery" ||
    mode === "confirmation" ||
    mode === "magic" ||
    mode === "reset";

  const loginMode = portalRoleForMode(mode) !== null;

  const heading =
    mode === "loginConsumer"
      ? "Login do Consumidor"
      : mode === "loginProducer"
        ? "Login do Produtor"
        : mode === "admin"
          ? "Login do Administrador"
          : mode === "superAdmin"
            ? "Login do Super administrador"
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
                    : mode === "loginConsumer"
                      ? "Entre com uma conta que possua o perfil Consumidor."
                      : mode === "loginProducer"
                        ? "Entre com uma conta que possua o perfil Produtor."
                        : mode === "admin"
                          ? "Acesso exclusivo para contas com perfil Administrador."
                          : mode === "superAdmin"
                            ? "Acesso exclusivo para contas com perfil Super administrador."
                            : "Informe suas credenciais para entrar."}
      </p>

      <form
        key={mode}
        onSubmit={submit}
        noValidate={
          mode === "consumer" || mode === "producer" || mode === "reset"
        }
        onInputCapture={(event) => {
          const name = (event.target as HTMLInputElement).name;
          if (name) clearFieldError(name);
        }}
      >
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
                aria-invalid={Boolean(fieldErrors.fullName)}
              />
              {fieldErrors.fullName && (
                <small className="field-error" role="alert">
                  {fieldErrors.fullName}
                </small>
              )}
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
                  aria-invalid={Boolean(fieldErrors.cpf)}
                  required
                />
                {fieldErrors.cpf && (
                  <small className="field-error" role="alert">
                    {fieldErrors.cpf}
                  </small>
                )}
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
                  aria-invalid={Boolean(fieldErrors.phone)}
                  required
                />
                {fieldErrors.phone && (
                  <small className="field-error" role="alert">
                    {fieldErrors.phone}
                  </small>
                )}
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
              aria-invalid={Boolean(fieldErrors.email)}
            />
            {fieldErrors.email && (
              <small className="field-error" role="alert">
                {fieldErrors.email}
              </small>
            )}
          </label>
        )}

        {loginMode && (
          <label>
            Senha
            <div className="password-input">
              <input
                name="password"
                type={loginPasswordVisible ? "text" : "password"}
                autoComplete="current-password"
                minLength={1}
                maxLength={128}
                required
              />
              <button
                type="button"
                className="password-visibility"
                aria-label={loginPasswordVisible ? "Ocultar senha" : "Mostrar senha"}
                onClick={() => setLoginPasswordVisible((current) => !current)}
              >
                {loginPasswordVisible ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </label>
        )}

        {(mode === "consumer" || mode === "producer" || mode === "reset") && (
          <PasswordFields
            label={mode === "reset" ? "Nova senha" : "Senha"}
            password={passwordValue}
            confirmation={confirmPassword}
            onPasswordChange={(value) => {
              setPasswordValue(value);
              clearFieldError("password");
            }}
            onConfirmationChange={(value) => {
              setConfirmPassword(value);
              clearFieldError("confirmPassword");
            }}
            passwordError={fieldErrors.password}
            confirmationError={fieldErrors.confirmPassword}
          />
        )}

        {mode === "producer" && (
          <>
            <label>
              Nome de seu imóvel
              <input
                name="propertyName"
                required
                minLength={2}
                maxLength={128}
                aria-invalid={Boolean(fieldErrors.propertyName)}
              />
              {fieldErrors.propertyName && (
                <small className="field-error" role="alert">
                  {fieldErrors.propertyName}
                </small>
              )}
            </label>
            <label>
              Atividade principal
              <select
                name="activityType"
                defaultValue="misto"
                aria-invalid={Boolean(fieldErrors.activityType)}
              >
                <option value="misto">Produção mista</option>
                <option value="hortalicas_folhosas">Hortaliças folhosas</option>
                <option value="legumes_picados">Legumes picados</option>
                <option value="frutas">Frutas</option>
                <option value="temperos">Temperos</option>
              </select>
              {fieldErrors.activityType && (
                <small className="field-error" role="alert">
                  {fieldErrors.activityType}
                </small>
              )}
            </label>
          </>
        )}

        {notice && (
          <p role="status" className="form-notice">
            {notice}
          </p>
        )}

        <button
          disabled={busy}
          className="primary"
          type="submit"
        >
          {busy
            ? "Aguarde…"
            : loginMode
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

      {loginMode && (
        <>
          <div className="account-helpers" aria-label="Opções de segurança">
            <button type="button" className="text-button" onClick={() => navigate("/recuperar-senha")}>
              Esqueci minha senha
            </button>
            <button type="button" className="text-button" onClick={() => navigate("/confirmar-contato")}>
              Reenviar confirmação
            </button>
            <button type="button" className="text-button" onClick={() => changeMode("magic")}>
              Entrar com link ou código
            </button>
          </div>

          <button type="button" className="text-button helper-action" onClick={() => navigate("/entrar")}>
            Trocar perfil de acesso
          </button>
        </>
      )}

      {(mode === "consumer" || mode === "producer") && (
        <button
          type="button"
          className="text-button helper-action"
          onClick={() =>
            navigate(
              mode === "producer"
                ? "/entrar/produtor"
                : "/entrar/consumidor",
            )
          }
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
