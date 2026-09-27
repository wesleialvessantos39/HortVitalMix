import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Mail, Sprout } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import type { ShellSession } from "../../hooks/useSession";
import "./auth.css";

type Result = {
  status: "confirmed" | "pending" | "sent";
  fullName?: string;
  email?: string;
  role: "consumer" | "producer";
};
export function ContactConfirmationPage({
  onNavigate,
  session,
  onSessionAdopt,
}: {
  session: ShellSession | null;
  onNavigate: (path: string) => void;
  onSessionAdopt: (session: ShellSession | null) => void;
  onSessionRefresh: () => Promise<void>;
}) {
  const [link] = useState(() => {
    const query = new URLSearchParams(location.search),
      hash = new URLSearchParams(location.hash.slice(1));
    return {
      context: query.get("context") || undefined,
      accessToken: hash.get("access_token") || undefined,
      portalRole:
        query.get("portal") === "producer"
          ? ("producer" as const)
          : ("consumer" as const),
      error: hash.get("error_code"),
    };
  });
  const [result, setResult] = useState<Result | null>(null);
  const [email, setEmail] = useState(
    () =>
      new URLSearchParams(location.search).get("email") ||
      (() => {
        try {
          return (
            sessionStorage.getItem("hvm:login-email:" + link.portalRole) || ""
          );
        } catch {
          return "";
        }
      })(),
  );
  const [role, setRole] = useState(link.portalRole);
  const [busy, setBusy] = useState(Boolean(link.context || link.accessToken));
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const request = useRef<Promise<Result> | null>(null);
  const [cooldown, setCooldown] = useState(false);
  useEffect(() => {
    if (!link.context && !link.accessToken) {
      if (link.error)
        setNotice(
          "Não foi possível validar este link antigo. Solicite uma nova confirmação abaixo.",
        );
      return;
    }
    let active = true;
    setBusy(true);
    request.current ??= api<Result>("/v1/auth/confirmation", {
      method: "POST",
      body: JSON.stringify({
        context: link.context,
        accessToken: link.accessToken,
        portalRole: link.portalRole,
      }),
    });
    void request.current
      .then((value) => {
        if (!active) return;
        setResult(value);
        setRole(value.role);
        setEmail(value.email ?? "");
        setNotice(
          value.status === "confirmed"
            ? "Seu e-mail foi confirmado. Agora você pode entrar com sua senha."
            : "A confirmação ainda está pendente. Reenvie o link para o mesmo e-mail com o botão abaixo.",
        );
        history.replaceState(
          history.state,
          "",
          location.pathname + location.search,
        );
      })
      .catch((e: ApiFailure) => {
        if (active)
          setNotice(
            e.status === 401
              ? "Este link não pode mais ser validado. Solicite uma nova confirmação."
              : "Não foi possível consultar a confirmação agora. Tente novamente; isso não significa que o link expirou.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [link, retry]);
  async function resend(event: React.FormEvent) {
    event.preventDefault();
    if (busy || cooldown) return;
    setBusy(true);
    try {
      if (link.context) {
        const value = await api<Result>("/v1/auth/confirmation", {
          method: "POST",
          body: JSON.stringify({ context: link.context, resend: true }),
        });
        setResult(value);
        if (value.status === "confirmed") {
          setEmail(value.email ?? "");
          setNotice("Seu e-mail já está confirmado.");
          return;
        }
      } else
        await api("/v1/auth/resend-confirmation", {
          method: "POST",
          body: JSON.stringify({ email, portalRole: role }),
        });
      setNotice(
        "Solicitação recebida. Confira o e-mail cadastrado e a pasta de spam. Use o link mais recente.",
      );
      setCooldown(true);
      window.setTimeout(() => setCooldown(false), 60000);
    } catch {
      setNotice(
        "Não foi possível reenviar agora. Aguarde um minuto e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    setBusy(true);
    try {
      if (session) {
        await api("/v1/auth/logout", { method: "POST" });
        onSessionAdopt(null);
      }
      try {
        sessionStorage.setItem("hvm:login-email:" + role, email);
      } catch {}
      onNavigate(
        role === "producer" ? "/entrar/produtor" : "/entrar/consumidor",
      );
    } catch {
      setNotice("Não foi possível preparar o login agora. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  const confirmed = result?.status === "confirmed";
  return (
    <section
      className="t04-security-layout"
      aria-labelledby="t04-confirm-title"
    >
      <aside className="t04-security-aside" aria-hidden="true">
        <div className="t04-brand-mark">
          <Sprout />
        </div>
        <span className="t04-kicker">HortiVitalMix</span>
        <h2>Seu cadastro, pronto para começar.</h2>
        <p>Confirme seu e-mail e entre com sua senha.</p>
      </aside>
      <div className="t04-security-card">
        <div className="t04-title-icon success">
          {confirmed ? <CheckCircle2 /> : <Mail />}
        </div>
        <h1 id="t04-confirm-title">
          {confirmed
            ? `Boas-vindas, ${result.fullName}!`
            : busy
              ? "Verificando seu e-mail…"
              : "Confirme seu e-mail"}
        </h1>
        {notice && (
          <p className="t04-banner" role="status">
            {notice}
          </p>
        )}
        {confirmed ? (
          <button
            className="t04-primary"
            disabled={busy}
            onClick={() => void login()}
          >
            Login
          </button>
        ) : (
          !busy && (
            <>
              {link.context || link.accessToken ? (
                <button
                  className="t04-link-button"
                  onClick={() => {
                    request.current = null;
                    setRetry((v) => v + 1);
                  }}
                >
                  Verificar novamente
                </button>
              ) : null}
              <form className="t04-form" onSubmit={resend}>
                {!link.context && (
                  <>
                    <label>
                      Perfil
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value as typeof role)}
                      >
                        <option value="consumer">Consumidor</option>
                        <option value="producer">Produtor</option>
                      </select>
                    </label>
                    <label>
                      E-mail do cadastro
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </label>
                  </>
                )}
                <button className="t04-primary" disabled={busy || cooldown}>
                  {cooldown
                    ? "Aguarde um minuto para reenviar"
                    : "Reenviar confirmação"}
                </button>
              </form>
              <button className="t04-link-button" onClick={() => void login()}>
                Ir para o login
              </button>
            </>
          )
        )}
      </div>
    </section>
  );
}
