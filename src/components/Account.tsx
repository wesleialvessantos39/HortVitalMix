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
