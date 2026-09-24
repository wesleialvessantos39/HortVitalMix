import { useEffect, useState, type FormEvent } from "react";
import { ChevronRight, Crown, Plus, ShieldCheck, ShoppingBag, Sprout } from "lucide-react";
import { api } from "../lib/api";
import { getBootstrapStatus } from "../lib/adminBootstrapTransport";
import { CPFInput } from "./forms/CPFInput";
import { PhoneInput } from "./forms/PhoneInput";
import { PasswordStrengthMeter } from "./forms/PasswordStrengthMeter";
import { OtpInput } from "./forms/OtpInput";
import { PROVIDER_OTP_LENGTH } from "../../shared/securityCodes";
import type { ShellSession } from "../hooks/useSession";
import {
  NewPasswordSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RegisterConsumerSchema,
  RegisterProducerSchema,
  PortalRoleSchema,
  type PortalRole,
} from "../../shared/contracts/auth";


type Mode =
  | "login"
  | "consumer"
  | "producer"
  | "recovery"
  | "confirmation"
  | "magic"
  | "reset";

function modeFromPath(path: string): Mode {
  if (path === "/cadastro/consumidor") return "consumer";
  if (path === "/cadastro/produtor") return "producer";
  if (path === "/recuperar-senha") return "recovery";
  if (path === "/redefinir-senha" || path === "/redefinirsenha") return "reset";
  if (path === "/confirmar-contato" || path === "/confirmarcontato") return "confirmation";
  return "login";
}

function loginRoleFromPath(path: string): PortalRole | null {
  if (path === "/entrar/consumidor") return "consumer";
  if (path === "/entrar/produtor") return "producer";
  if (path === "/entrar/administrador" || path === "/acesso/administracao")
    return "platform_admin";
  if (
    path === "/entrar/super-administrador" ||
    path === "/acesso/super-administracao"
  )
    return "platform_super_admin";
  return null;
}

function loginPathForRole(role: PortalRole) {
  if (role === "consumer") return "/entrar/consumidor";
  if (role === "producer") return "/entrar/produtor";
  if (role === "platform_admin") return "/entrar/administrador";
  return "/entrar/super-administrador";
}

function portalRoleFromSearch(): PortalRole | null {
  if (typeof location === "undefined") return null;
  const parsed = PortalRoleSchema.safeParse(
    new URLSearchParams(location.search).get("portal"),
  );
  return parsed.success ? parsed.data : null;
}

function recoveryHeading(role: PortalRole | null, reset = false) {
  if (!role) return reset ? "Defina sua nova senha" : "Recupere sua senha";
  const prefix = reset ? "Redefinição de senha" : "Recuperação de senha";
  if (role === "consumer") return `${prefix} — cadastro Consumidor`;
  if (role === "producer") return `${prefix} — cadastro Produtor`;
  return `${prefix} — ${roleLabel(role)}`;
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
type AdminBootstrapStatus = "idle" | "loading" | "open" | "closed" | "disabled";

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
  const matches = confirmation.length > 0 && password === confirmation;

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

      <PasswordStrengthMeter value={password} />

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
  session,
  onSessionAdopt,
  onSessionRefresh,
}: {
  path?: string;
  onNavigate?: (to: string) => void;
  session: ShellSession | null;
  onSessionAdopt: (session: ShellSession | null) => void;
  onSessionRefresh: () => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>(() => modeFromPath(path));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [securityFlow, setSecurityFlow] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loginPasswordVisible, setLoginPasswordVisible] = useState(false);
  const [securityChallengeId, setSecurityChallengeId] = useState<string | null>(null);
  const [securityNonce, setSecurityNonce] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [adminBootstrapStatus, setAdminBootstrapStatus] =
    useState<AdminBootstrapStatus>("idle");

  useEffect(() => {
    setMode(modeFromPath(path));
    setPasswordValue("");
    setConfirmPassword("");
    setLoginPasswordVisible(false);
    setSecurityChallengeId(null);
    setSecurityNonce("");
    setFieldErrors({});
    const params = new URLSearchParams(location.search);
    if (params.get("registered") === "1")
      setNotice("Cadastro realizado. A confirmação de e-mail está sendo enviada.");
    else if (params.get("roleAdded") === "1")
      setNotice("Novo perfil adicionado à sua conta. Você já pode entrar.");
    else
      setNotice("");
  }, [path]);

  useEffect(() => {
    if (path !== "/administracao") {
      setAdminBootstrapStatus("idle");
      return;
    }

    let cancelled = false;
    setAdminBootstrapStatus("loading");

    getBootstrapStatus()
      .then((result) => {
        if (!cancelled) setAdminBootstrapStatus(result.status);
      })
      .catch(() => {
        // Se ambos os transportes falharem, mantemos a descoberta visível.
        // A autorização real continua protegida no POST server-side/Edge.
        if (!cancelled) setAdminBootstrapStatus("open");
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapSecurityLink() {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const type = hash.get("type");
      const emailPortalRole = portalRoleFromSearch();

      if (!accessToken || !refreshToken) return;

      try {
        await api("/v1/auth/import-session", {
          method: "POST",
          body: JSON.stringify({
            accessToken,
            refreshToken,
            portalRole: emailPortalRole ?? undefined,
          }),
        });

        history.replaceState({}, "", location.pathname + location.search);
        await onSessionRefresh();

        if (!cancelled && type === "signup") {
          setNotice(
            "E-mail confirmado com sucesso. Sua conta já está pronta para uso.",
          );
        }

        if (!cancelled && (type === "recovery" || path === "/redefinir-senha")) {
          setMode("reset");
          setNotice("Acesso de recuperação validado. Defina sua nova senha.");
        }
      } catch {
        if (!cancelled) {
          setNotice(
            "O link de segurança expirou ou já foi utilizado. Solicite um novo.",
          );
        }
      }
    }

    void bootstrapSecurityLink();
    return () => {
      cancelled = true;
    };
  }, [path, onSessionRefresh]);

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

  const portalRole = loginRoleFromPath(path);
  const securityRole = portalRole ?? portalRoleFromSearch();
  const recoveryFlow =
    typeof location === "undefined"
      ? ""
      : new URLSearchParams(location.search).get("flow") ?? "";

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
      if (mode === "login") {
        if (!portalRole) {
          navigate("/entrar");
          return;
        }
        if (
          portalRole === "platform_admin" ||
          portalRole === "platform_super_admin"
        ) {
          navigate("/admin/entrar");
          return;
        }
        const authenticated = await api<ShellSession & { status: "authenticated" }>(
          "/v1/auth/login",
          {
            method: "POST",
            body: JSON.stringify({ ...form, portalRole }),
          },
        );
        onSessionAdopt(authenticated);
        navigate("/minha-conta");
        return;
      }

      if (mode === "consumer" || mode === "producer") {
        const result = await api<{
          confirmationRequired: boolean;
          confirmationDispatchAccepted: boolean;
          confirmationDispatchDeferred?: boolean;
          existingIdentity?: boolean;
          roleAdded?: boolean;
        }>("/v1/auth/register-" + mode, {
          method: "POST",
          body: JSON.stringify(form),
        });

        const targetRole = mode;
        onSessionAdopt(null);
        if (result.confirmationRequired) {
          navigate(`/confirmar-contato?portal=${targetRole}&pending=1`);
          return;
        }

        setMode("login");
        navigate(
          loginPathForRole(targetRole) +
            (result.existingIdentity && result.roleAdded
              ? "?roleAdded=1"
              : "?registered=1"),
        );
        return;
      }

      if (mode === "recovery") {
        if (!securityRole) {
          setNotice("Escolha primeiro o perfil de acesso para recuperar a senha.");
          return;
        }
        await api("/v1/auth/request-password-reset", {
          method: "POST",
          body: JSON.stringify({
            email: form.email,
            portalRole: securityRole,
          }),
        });
        setNotice(
          `Se o e-mail possuir o perfil ${roleLabel(securityRole)}, enviaremos as instruções de recuperação correspondentes.`,
        );
        return;
      }

      if (mode === "confirmation") {
        if (!securityRole) {
          setNotice("Escolha primeiro o perfil de acesso para reenviar a confirmação.");
          return;
        }
        await api("/v1/auth/resend-confirmation", {
          method: "POST",
          body: JSON.stringify({
            email: form.email,
            portalRole: securityRole,
          }),
        });
        setNotice(
          `Se houver um cadastro ${roleLabel(securityRole)} pendente para este e-mail, uma nova confirmação será enviada.`,
        );
        return;
      }

      if (mode === "magic") {
        if (!securityRole) {
          setNotice("Escolha primeiro o perfil de acesso.");
          return;
        }
        await api("/v1/auth/magic-link", {
          method: "POST",
          body: JSON.stringify({
            email: form.email,
            portalRole: securityRole,
          }),
        });
        setNotice(
          "Se a conta pública possuir esse perfil, enviaremos o acesso seguro.",
        );
        return;
      }

      if (mode === "reset") {
        const parsed = NewPasswordSchema.safeParse({ password: form.password });
        if (!parsed.success) {
          setNotice(parsed.error.issues.map((issue) => issue.message).join(". "));
          return;
        }
        if (!securityRole || !recoveryFlow) {
          setNotice("Este link de recuperação não possui um contexto de perfil válido.");
          return;
        }
        await api("/v1/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({
            password: form.password,
            portalRole: securityRole,
            flowToken: recoveryFlow,
          }),
        });
        onSessionAdopt(null);
        setMode("login");
        setNotice("Senha atualizada. Entre novamente pelo perfil correspondente.");
        navigate(loginPathForRole(securityRole));
      }
    } catch (error) {
      const failure = error as Error & {
        fields?: Array<{ field: string; message: string }>;
        requestId?: string;
      };
      const code = failure.message;

      if (code === "VALIDATION_ERROR" && !failure.fields?.length) {
        setNotice("Não foi possível validar os dados enviados. Revise o e-mail e o perfil selecionado." +
          (failure.requestId ? ` Código de atendimento: ${failure.requestId}.` : ""));
        return;
      }

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

      setNotice(
        code === "INVALID_CREDENTIALS"
          ? "E-mail ou senha inválidos."
          : code === "EMAIL_CONFIRMATION_REQUIRED"
            ? "Confirme seu e-mail antes de entrar. Se necessário, reenvie a confirmação."
            : code === "IDENTITY_CONFLICT"
              ? "Os dados informados pertencem a identidades diferentes. Confira CPF e e-mail."
              : code === "ROLE_ALREADY_ASSIGNED"
                ? "Este perfil já está ativo nessa conta. Use a tela de login correspondente."
                : code === "CPF_LINKED_TO_EXISTING_ACCOUNT"
                  ? "Este CPF já pertence a uma conta existente. Use o mesmo e-mail e a mesma senha dessa conta para adicionar o novo perfil."
                  : code === "EXISTING_ACCOUNT_CREDENTIALS_INVALID"
                    ? "O CPF já existe, mas a senha informada não confirma a conta atual. Use a senha da conta existente."
                    : code === "EXISTING_ACCOUNT_CONFIRM_REQUIRED"
                      ? "Confirme primeiro o e-mail da conta existente e depois adicione o novo perfil."
                      : code === "ROLE_NOT_ALLOWED_FOR_PORTAL"
                        ? `Esta conta não possui o perfil ${portalRole ? roleLabel(portalRole) : "selecionado"}. Escolha outro tipo de acesso.`
              : code === "REGISTRATION_RATE_LIMITED"
                ? "Foram feitas muitas tentativas de cadastro. Tente novamente em alguns minutos."
                : code === "AUTH_UNAVAILABLE"
                  ? "Não foi possível concluir a solicitação agora. Tente novamente em alguns instantes."
                  : code === "DATABASE_UNAVAILABLE"
                    ? "Não foi possível concluir a solicitação agora. Tente novamente em alguns instantes."
                    : code === "ORIGIN_NOT_ALLOWED"
                      ? "Não foi possível concluir a solicitação agora. Tente novamente em alguns instantes."
                      : code === "ACCOUNT_UNAVAILABLE"
                        ? "Sua conta não está disponível para acesso."
                        : code === "RECOVERY_CONTEXT_MISMATCH"
                          ? "Este link de recuperação pertence a outro perfil."
                          : code === "RECOVERY_CONTEXT_INVALID"
                            ? "Este link de recuperação expirou, foi invalidado ou pertence a outro perfil."
                            : code === "RECOVERY_CONTEXT_ALREADY_USED"
                              ? "Este link de recuperação já foi utilizado."
                              : code === "PASSWORD_UPDATE_REJECTED"
                                ? "Não foi possível aceitar a nova senha. Solicite um novo link de recuperação."
                          : code === "DEPENDENCY_UNAVAILABLE"
                            ? "Não foi possível concluir a solicitação agora. Tente novamente em alguns instantes."
                            : code === "REGISTRATION_SCHEMA_OUTDATED"
                              ? "Não foi possível concluir o cadastro agora. Tente novamente em alguns instantes."
                              : code === "REGISTRATION_DATA_REJECTED"
                                ? "Dados inválidos ou cadastro não autorizado."
                                : code === "REGISTRATION_INTERNAL_ERROR"
                                  ? "Não foi possível concluir o cadastro agora. Tente novamente em alguns instantes."
                                  : code === "REQUEST_TIMEOUT"
                                    ? "O servidor demorou mais do que o esperado para responder. O cadastro não foi confirmado."
                                    : code === "NETWORK_UNAVAILABLE"
                                      ? "Não foi possível conectar ao servidor de cadastro. Verifique a conexão e tente novamente."
                                      : code === "INVALID_API_RESPONSE"
                                        ? "Não foi possível concluir o cadastro agora. Tente novamente em alguns instantes."
                                        : code === "REGISTRATION_STATUS_UNKNOWN"
                                          ? "Não foi possível confirmar o cadastro. Tente entrar ou recuperar a senha antes de repetir o cadastro."
                                          : code === "HTTP_400"
                                            ? "Dados inválidos. Revise as informações e tente novamente."
                                            : code === "HTTP_401"
                                              ? "Dados inválidos ou cadastro não autorizado."
                                              : code === "HTTP_403"
                                                ? "Cadastro não autorizado."
                                                : code === "HTTP_404"
                                                  ? "Não foi possível concluir a solicitação agora. Tente novamente em alguns instantes."
                                                  : code === "HTTP_405"
                                                    ? "Não foi possível concluir a solicitação agora. Tente novamente em alguns instantes."
                                                    : code === "HTTP_413"
                                                      ? "Não foi possível concluir a solicitação. Revise os dados informados."
                                                      : code === "HTTP_429"
                                                        ? "Muitas tentativas. Aguarde alguns minutos e tente novamente."
                                                        : code === "HTTP_500"
                                                          ? "Não foi possível concluir o cadastro agora. Tente novamente em alguns instantes."
                                                          : code === "HTTP_502"
                                                            ? "Não foi possível concluir o cadastro agora. Tente novamente em alguns instantes."
                                                            : code === "HTTP_503"
                                                              ? "Não foi possível concluir o cadastro agora. Tente novamente em alguns instantes."
                                                              : code === "HTTP_504"
                                                                ? "A solicitação demorou mais do que o esperado. Tente novamente."
                                                                : code.startsWith("HTTP_")
                                                                  ? "Não foi possível concluir a solicitação. Verifique os dados informados e tente novamente."
                                                                  : code === "ADMIN_GOVERNANCE_LOGIN_REQUIRED"
                                                                    ? "Dados inválidos ou cadastro não autorizado."
                                                                    : "Não foi possível concluir a solicitação. Verifique os dados informados e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestSecurityCode() {
    const activeRole = session?.activeRole;
    const parsedRole = PortalRoleSchema.safeParse(activeRole);
    if (!parsedRole.success) {
      setNotice("A sessão não possui um perfil de segurança válido.");
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      const result = await api<{ challengeId: string; portalRole: PortalRole }>(
        "/v1/auth/reauthenticate",
        {
          method: "POST",
          body: JSON.stringify({ portalRole: parsedRole.data }),
        },
      );
      setSecurityChallengeId(result.challengeId);
      setSecurityFlow(true);
      setNotice(
        `Enviamos um código de segurança exclusivo para o perfil ${roleLabel(parsedRole.data)}.`,
      );
    } catch (error) {
      setNotice(
        (error as Error).message === "SECURITY_CONTEXT_MISMATCH"
          ? "O perfil desta sessão não corresponde ao portal atual."
          : "Não foi possível enviar o código de segurança agora.",
      );
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

    const parsedRole = PortalRoleSchema.safeParse(session?.activeRole);
    if (!parsedRole.success || !securityChallengeId) {
      setNotice("Solicite um novo código de segurança para este perfil.");
      return;
    }

    setBusy(true);
    try {
      const targetRole = parsedRole.data;
      await api("/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          password: form.password,
          nonce: form.nonce,
          challengeId: securityChallengeId,
          portalRole: targetRole,
        }),
      });
      onSessionAdopt(null);
      setSecurityFlow(false);
      setSecurityChallengeId(null);
      setMode("login");
      setNotice("Senha alterada. Entre novamente para continuar.");
      navigate(loginPathForRole(targetRole));
    } catch (error) {
      const code = (error as Error).message;
      setNotice(
        code === "SECURITY_CODE_REJECTED"
          ? "Código inválido ou expirado. Solicite um novo código para este perfil."
          : code === "SECURITY_CODE_CONTEXT_INVALID" ||
              code === "SECURITY_CONTEXT_MISMATCH"
            ? "Este código não pertence a este perfil. Solicite um código no portal correto."
            : "Não foi possível alterar a senha agora.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (session && path === "/admin/painel") {
    const isAdmin =
      session.activeRole === "platform_admin" ||
      session.activeRole === "platform_super_admin";

    if (!isAdmin)
      return (
        <section className="account card">
          <span className="eyebrow">Administração</span>
          <h1>Portal administrativo</h1>
          <p>Esta sessão não possui um perfil administrativo ativo.</p>
          <button
            className="primary"
            type="button"
            onClick={() => navigate("/administracao")}
          >
            Escolher acesso administrativo
          </button>
        </section>
      );

    return (
      <section className="account card admin-account-panel">
        <span className="eyebrow">Administração</span>
        <h1>Painel administrativo</h1>
        <p>{session.email}</p>
        <p>
          Acesso atual: <strong>{roleLabel(session.activeRole ?? "")}</strong>
        </p>

        {session.activeRole === "platform_super_admin" && (
          <button
            className="primary account-action"
            type="button"
            onClick={() => navigate("/admin/configuracao")}
          >
            Abrir configurações
          </button>
        )}

        <button
          className="secondary account-action"
          type="button"
          onClick={() => navigate("/minha-conta")}
        >
          Minha conta e segurança
        </button>
      </section>
    );
  }

  if (path === "/admin/painel" && !session)
    return (
      <section className="account card">
        <span className="eyebrow">Administração</span>
        <h1>Sessão administrativa necessária</h1>
        <p>Entre como Administrador ou Super administrador para abrir o painel.</p>
        <button
          className="primary"
          type="button"
          onClick={() => navigate("/administracao")}
        >
          Entrar na Administração
        </button>
      </section>
    );

  if (session && path === "/minha-conta")
    return (
      <section className="account card">
        <span className="eyebrow">Acesso seguro</span>
        <h1>Minha conta</h1>
        <p>{session.email}</p>
        <p>
          Acesso atual:{" "}
          <strong>{session.activeRole ? roleLabel(session.activeRole) : "Conta"}</strong>
        </p>
        {session.roles.length > 1 && (
          <p>Perfis disponíveis: {session.roles.map((role) => roleLabel(role)).join(", ")}.</p>
        )}

        {session.activeRole === "platform_super_admin" && (
          <button
            className="secondary account-action"
            type="button"
            onClick={() => navigate("/admin/configuracao")}
          >
            Configuração global da plataforma
          </button>
        )}

        <button
          className="secondary account-action"
          type="button"
          onClick={() => navigate("/confirmar-contato")}
        >
          Confirmar e-mail e telefone
        </button>

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
            <h2>
              Alterar senha
              {session.activeRole ? ` — ${roleLabel(session.activeRole)}` : ""}
            </h2>
            <p>
              Digite o código enviado para este perfil. Códigos emitidos em
              outro portal não são aceitos aqui.
            </p>
            <label className="t04-security-code-label">
              Código de segurança
              <OtpInput
                length={PROVIDER_OTP_LENGTH}
                value={securityNonce}
                onChange={setSecurityNonce}
                disabled={busy}
              />
              <input type="hidden" name="nonce" value={securityNonce} />
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
              onSessionAdopt(null);
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

  const auxiliary =
    mode === "recovery" ||
    mode === "confirmation" ||
    mode === "magic" ||
    mode === "reset";

  if (path === "/minha-conta" && !session)
    return (
      <section className="account card">
        <span className="eyebrow">Conta</span>
        <h1>Sessão necessária</h1>
        <p>Escolha o tipo de acesso e entre novamente para abrir sua conta.</p>
        <button
          className="primary"
          type="button"
          onClick={() => navigate("/conta")}
        >
          Escolher acesso
        </button>
      </section>
    );


  if (
    mode === "login" &&
    !portalRole &&
    path !== "/administracao" &&
    path !== "/admin/entrar"
  )
    return (
      <section className="access-selector" aria-labelledby="account-access-title">
        <h1 id="account-access-title" className="visually-hidden">
          Conta
        </h1>
        <div className="access-grid access-grid-public">
          <button
            className="access-card access-card-consumer"
            type="button"
            aria-label="Entrar como Consumidor"
            onClick={() => navigate("/entrar/consumidor")}
          >
            <span className="access-card-top" aria-hidden="true">
              <span className="access-card-icon">
                <ShoppingBag />
              </span>
              <span className="access-card-badge">Para você</span>
            </span>
            <span className="access-card-copy" aria-hidden="true">
              <strong className="access-card-title access-card-title-desktop">
                Consumidor
              </strong>
              <strong className="access-card-title access-card-title-mobile">
                Entrar como Consumidor
              </strong>
              <span className="access-card-description">
                Compre produtos frescos e acompanhe seus pedidos.
              </span>
            </span>
            <span className="access-card-action" aria-hidden="true">
              Entrar como Consumidor <ChevronRight />
            </span>
            <ChevronRight className="access-card-mobile-chevron" aria-hidden="true" />
          </button>

          <button
            className="access-card access-card-producer"
            type="button"
            aria-label="Entrar como Produtor"
            onClick={() => navigate("/entrar/produtor")}
          >
            <span className="access-card-top" aria-hidden="true">
              <span className="access-card-icon">
                <Sprout />
              </span>
              <span className="access-card-badge">Para produtores</span>
            </span>
            <span className="access-card-copy" aria-hidden="true">
              <strong className="access-card-title access-card-title-desktop">
                Produtor
              </strong>
              <strong className="access-card-title access-card-title-mobile">
                Entrar como Produtor
              </strong>
              <span className="access-card-description">
                Acesse seu ambiente de produção e comercialização.
              </span>
            </span>
            <span className="access-card-action" aria-hidden="true">
              Entrar como Produtor <ChevronRight />
            </span>
            <ChevronRight className="access-card-mobile-chevron" aria-hidden="true" />
          </button>
        </div>
        <div className="access-discovery">
          <div>
            <strong>Primeiro acesso ao HortiVitalMix?</strong>
            <span>Os cadastros de Consumidor e Produtor possuem formulários próprios.</span>
          </div>
          <button
            type="button"
            className="access-discovery-action"
            onClick={() => navigate("/cadastro")}
          >
            <Plus aria-hidden="true" />
            Criar cadastro
          </button>
        </div>
      </section>
    );

  if (
    mode === "login" &&
    !portalRole &&
    (path === "/administracao" || path === "/admin/entrar")
  )
    return (
      <section
        className="access-selector administration-selector"
        aria-labelledby="administration-access-title"
      >
        <span className="eyebrow">Acesso restrito</span>
        <h1 id="administration-access-title">Administração</h1>
        <div className="access-grid access-grid-admin">
          <button
            className="access-card access-card-admin"
            type="button"
            aria-label="Entrar como Administrador"
            onClick={() => navigate("/entrar/administrador")}
          >
            <span className="access-card-top" aria-hidden="true">
              <span className="access-card-icon">
                <ShieldCheck />
              </span>
              <span className="access-card-badge">Gestão</span>
            </span>
            <span className="access-card-copy" aria-hidden="true">
              <strong className="access-card-title">Administrador</strong>
              <span className="access-card-description">
                Gestão operacional conforme as permissões atribuídas à conta.
              </span>
            </span>
            <span className="access-card-action" aria-hidden="true">
              Entrar como Administrador <ChevronRight />
            </span>
            <ChevronRight className="access-card-mobile-chevron" aria-hidden="true" />
          </button>

          <button
            className="access-card access-card-super-admin"
            type="button"
            aria-label="Entrar como Super administrador"
            onClick={() => navigate("/entrar/super-administrador")}
          >
            <span className="access-card-top" aria-hidden="true">
              <span className="access-card-icon">
                <Crown />
              </span>
              <span className="access-card-badge">Acesso superior</span>
            </span>
            <span className="access-card-copy" aria-hidden="true">
              <strong className="access-card-title">Super administrador</strong>
              <span className="access-card-description">
                Administração superior, governança e configurações da plataforma.
              </span>
            </span>
            <span className="access-card-action" aria-hidden="true">
              Entrar como Super administrador <ChevronRight />
            </span>
            <ChevronRight className="access-card-mobile-chevron" aria-hidden="true" />
          </button>
        </div>

        <div
          className={
            "admin-bootstrap-discovery " +
            (adminBootstrapStatus === "open"
              ? "is-open"
              : adminBootstrapStatus === "closed"
                ? "is-closed"
                : "")
          }
          aria-live="polite"
        >
          <span className="admin-bootstrap-discovery-icon" aria-hidden="true">
            <ShieldCheck />
          </span>
          <div>
            <strong>
              {adminBootstrapStatus === "loading"
                ? "Verificando a configuração administrativa…"
                : adminBootstrapStatus === "open"
                  ? "Primeiro Super administrador ainda não configurado"
                  : adminBootstrapStatus === "closed"
                    ? "Configuração inicial concluída"
                    : "Configuração inicial protegida"}
            </strong>
            <span>
              {adminBootstrapStatus === "open"
                ? "Antes de usar o painel, conclua o bootstrap único com o e-mail autorizado no servidor."
                : adminBootstrapStatus === "closed"
                  ? "Use uma das opções acima. Novos administradores entram somente por convite."
                  : adminBootstrapStatus === "loading"
                    ? "Verificando disponibilidade do acesso."
                    : "O bootstrap não está disponível agora. Os acessos existentes continuam preservados."}
            </span>
          </div>
          {adminBootstrapStatus !== "closed" && (
            <button
              type="button"
              className="access-discovery-action"
              onClick={() => navigate("/admin/bootstrap")}
            >
              {adminBootstrapStatus === "open"
                ? "Configurar primeiro Super administrador"
                : "Verificar configuração inicial"}
            </button>
          )}
        </div>
      </section>
    );

  const heading =
    mode === "login"
      ? `Entrar como ${portalRole ? roleLabel(portalRole) : "usuário"}`
      : mode === "producer"
        ? "Cadastro de produtor"
        : mode === "consumer"
          ? "Cadastro de consumidor"
          : mode === "recovery"
            ? recoveryHeading(securityRole)
            : mode === "confirmation"
              ? securityRole
                ? `Confirmação de cadastro — ${roleLabel(securityRole)}`
                : "Confirme seu cadastro"
              : mode === "magic"
                ? "Acesso por link ou código"
                : recoveryHeading(securityRole, true);

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
              ? securityRole
                ? `Informe o e-mail do perfil ${roleLabel(securityRole)}. O link será emitido somente se esse perfil existir na conta.`
                : "Escolha o perfil de acesso antes de solicitar a recuperação."
              : mode === "confirmation"
                ? securityRole
                  ? `Informe o e-mail do cadastro ${roleLabel(securityRole)} para reenviar a confirmação.`
                  : "Escolha o perfil de acesso antes de reenviar a confirmação."
                : mode === "magic"
                  ? "Receba um link ou código de uso único para acessar sua conta."
                  : mode === "reset"
                    ? securityRole
                      ? `Este link é válido exclusivamente para o perfil ${roleLabel(securityRole)} que solicitou a recuperação.`
                      : "Este link de recuperação não possui perfil identificado."
                    : portalRole
                      ? `Informe as credenciais da conta com perfil ${roleLabel(portalRole)}.`
                      : "Escolha o perfil de acesso."}
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
              <CPFInput error={fieldErrors.cpf} />
              <PhoneInput error={fieldErrors.phone} />
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

        {mode === "login" && (
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
          {(portalRole === "consumer" || portalRole === "producer") && (
            <div className="login-registration">
              <span>Ainda não tem esse cadastro?</span>
              <button
                type="button"
                className="login-registration-action"
                onClick={() =>
                  navigate(
                    portalRole === "consumer"
                      ? "/cadastro/consumidor"
                      : "/cadastro/produtor",
                  )
                }
              >
                <Plus aria-hidden="true" />
                {portalRole === "consumer"
                  ? "Criar cadastro de consumidor"
                  : "Criar cadastro de produtor"}
              </button>
            </div>
          )}

          <div className="account-helpers" aria-label="Opções de segurança">
            <button
              type="button"
              className="text-button"
              onClick={() =>
                portalRole &&
                navigate(
                  `/recuperar-senha?portal=${encodeURIComponent(portalRole)}`,
                )
              }
            >
              Esqueci minha senha
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                portalRole &&
                navigate(
                  `/confirmar-contato?portal=${encodeURIComponent(portalRole)}`,
                )
              }
            >
              Reenviar confirmação
            </button>
          </div>

          <button
            type="button"
            className="text-button helper-action"
            onClick={() =>
              navigate(
                portalRole === "platform_admin" ||
                  portalRole === "platform_super_admin"
                  ? "/administracao"
                  : "/entrar",
              )
            }
          >
            {portalRole === "platform_admin" ||
            portalRole === "platform_super_admin"
              ? "Voltar para Administração"
              : "Escolher outro tipo de acesso"}
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
            navigate(
              securityRole ? loginPathForRole(securityRole) : "/entrar",
            );
          }}
        >
          Voltar para entrar
        </button>
      )}
    </section>
  );
}
