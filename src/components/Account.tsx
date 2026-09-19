import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import {
  RegisterConsumerSchema,
  RegisterProducerSchema,
} from "../../shared/contracts/auth";
type Session = { userId: string; email: string; roles: string[] };
export function Account() {
  const [mode, setMode] = useState<"login" | "consumer" | "producer">("login"),
    [session, setSession] = useState<Session | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<Session>("/v1/auth/session", { signal: controller.signal })
      .then(setSession)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice("");
    const form = Object.fromEntries(new FormData(e.currentTarget));
    if (mode !== "login") {
      const parsed = (
        mode === "producer" ? RegisterProducerSchema : RegisterConsumerSchema
      ).safeParse(form);
      if (!parsed.success) {
        setNotice(parsed.error.issues.map((i) => i.message).join(". "));
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
      } else {
        const result = await api<{ confirmationRequired: boolean }>(
          "/v1/auth/register-" + mode,
          { method: "POST", body: JSON.stringify(form) },
        );
        setNotice(
          result.confirmationRequired
            ? "Cadastro recebido. Confirme seu e-mail antes de entrar."
            : "Cadastro realizado. Você já pode entrar.",
        );
        setMode("login");
      }
    } catch (error) {
      const code = (error as Error).message;
      setNotice(
        code === "INVALID_CREDENTIALS"
          ? "E-mail ou senha inválidos."
          : code === "IDENTITY_CONFLICT"
            ? "Os dados de identificação já estão em uso."
            : code === "ACCOUNT_UNAVAILABLE"
              ? "Sua conta não está disponível para acesso."
              : "Não foi possível concluir agora. Tente novamente mais tarde.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (session)
    return (
      <section className="account card">
        <h1>Minha conta</h1>
        <p>{session.email}</p>
        <p>
          Acesso:{" "}
          {session.roles
            .map(
              (r) =>
                ({
                  consumer: "Consumidor",
                  producer: "Produtor",
                  platform_admin: "Administrador",
                  platform_super_admin: "Superadministrador",
                })[r] ?? r,
            )
            .join(", ")}
        </p>
        <button
          className="primary"
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
        <p role="status">{notice}</p>
      </section>
    );
  return (
    <section className="account card">
      <span className="eyebrow">Faça parte da nossa região</span>
      <h1>
        {mode === "login"
          ? "Entre na sua conta"
          : mode === "producer"
            ? "Cadastro do produtor"
            : "Crie sua conta"}
      </h1>
      <p>
        {mode === "producer"
          ? "Conecte sua produção a quem valoriza alimentos frescos."
          : "Que bom ter você por aqui."}
      </p>
      <div className="account-tabs" aria-label="Tipo de acesso">
        {(["login", "consumer", "producer"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? "selected" : ""}
            onClick={() => {
              setMode(m);
              setNotice("");
            }}
          >
            {m === "login"
              ? "Entrar"
              : m === "consumer"
                ? "Consumidor"
                : "Produtor"}
          </button>
        ))}
      </div>
      <form key={mode} onSubmit={submit}>
        {mode !== "login" && (
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
        <label>
          Senha
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
        {mode !== "login" && (
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
          {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar cadastro"}
        </button>
      </form>
    </section>
  );
}
