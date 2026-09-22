import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Mail, ShieldCheck, Sprout } from "lucide-react";
import { api } from "../../lib/api";
import type { ShellSession } from "../../hooks/useSession";
import { PortalRoleSchema, type PortalRole } from "../../../shared/contracts/auth";
import "./auth.css";

const ROLES: Array<{ role: PortalRole; label: string; help: string }> = [
  { role: "consumer", label: "Consumidor", help: "Conta de compras e assinaturas." },
  { role: "producer", label: "Produtor", help: "Conta de produção e oferta." },
  { role: "platform_admin", label: "Administrador", help: "Acesso administrativo." },
  { role: "platform_super_admin", label: "Super administrador", help: "Governança da plataforma." },
];

function readPortal(): PortalRole | null {
  const parsed = PortalRoleSchema.safeParse(new URLSearchParams(location.search).get("portal"));
  return parsed.success ? parsed.data : null;
}

function loginPath(role: PortalRole) {
  if (role === "consumer") return "/entrar/consumidor";
  if (role === "producer") return "/entrar/produtor";
  if (role === "platform_admin") return "/entrar/administrador";
  return "/entrar/super-administrador";
}

export function ContactConfirmationPage({
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
  const initialRole = useMemo(readPortal, []);
  const [role, setRole] = useState<PortalRole | null>(initialRole);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(Boolean(session));
  const [notice, setNotice] = useState("");
  const [linkHandled, setLinkHandled] = useState(false);

  useEffect(() => {
    if (linkHandled) return;
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const type = hash.get("type");
    if (!accessToken || !refreshToken) return;

    setLinkHandled(true);
    setBusy(true);
    void api<ShellSession & { status?: string }>("/v1/auth/import-session", {
      method: "POST",
      body: JSON.stringify({
        accessToken,
        refreshToken,
        portalRole: initialRole ?? undefined,
      }),
    })
      .then(async (imported) => {
        onSessionAdopt(imported);
        history.replaceState({}, "", location.pathname + location.search);
        await onSessionRefresh();
        setConfirmed(type === "signup" || Boolean(imported.userId));
        setNotice("E-mail confirmado com sucesso. Sua conta está pronta para uso.");
      })
      .catch(() => {
        setNotice("Este link expirou ou já foi utilizado. Solicite uma nova confirmação.");
      })
      .finally(() => setBusy(false));
  }, [initialRole, linkHandled, onSessionAdopt, onSessionRefresh]);

  async function resend(event: React.FormEvent) {
    event.preventDefault();
    if (!role) {
      setNotice("Escolha o perfil do cadastro.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await api("/v1/auth/resend-confirmation", {
        method: "POST",
        body: JSON.stringify({ email, portalRole: role }),
      });
      setNotice(
        `Se houver um cadastro ${ROLES.find((item) => item.role === role)?.label} pendente para este e-mail, a confirmação será enviada pelo Supabase.`,
      );
    } catch {
      setNotice("Não foi possível solicitar o reenvio agora. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="t04-security-layout" aria-labelledby="t04-confirm-title">
      <aside className="t04-security-aside" aria-hidden="true">
        <div className="t04-brand-mark"><Sprout /></div>
        <span className="t04-kicker">HortiVitalMix • Segurança</span>
        <h2>Seu acesso protegido, sem complicação.</h2>
        <p>Os e-mails de confirmação são enviados pelo Supabase Auth através do Gmail/SMTP já configurado no projeto.</p>
        <div className="t04-steps">
          <span><b>1</b> Solicite a confirmação</span>
          <span><b>2</b> Abra o e-mail recebido</span>
          <span><b>3</b> Confirme pelo link seguro</span>
        </div>
      </aside>

      <div className="t04-security-card">
        <div className="t04-title-icon success"><Mail /></div>
        <span className="eyebrow">Confirmação de cadastro</span>
        <h1 id="t04-confirm-title">{confirmed ? "E-mail confirmado" : "Confirme seu e-mail"}</h1>
        <p className="t04-lead">
          {confirmed
            ? "A confirmação foi reconhecida e sua sessão segura está disponível."
            : "Escolha o perfil correto e solicite um novo e-mail somente se ainda não tiver confirmado o cadastro."}
        </p>

        {notice && <div className="t04-banner" role="status">{notice}</div>}

        {confirmed ? (
          <div className="t04-success-panel">
            <CheckCircle2 />
            <div>
              <strong>Confirmação concluída</strong>
              <span>{session?.email ?? "E-mail validado pelo Supabase Auth."}</span>
            </div>
          </div>
        ) : (
          <form className="t04-form" onSubmit={resend}>
            {!role ? (
              <div>
                <span className="t04-field-label">Qual cadastro você quer confirmar?</span>
                <div className="t04-role-grid">
                  {ROLES.map((item) => (
                    <button
                      key={item.role}
                      type="button"
                      className="t04-role-option"
                      onClick={() => setRole(item.role)}
                    >
                      <ShieldCheck />
                      <span><strong>{item.label}</strong><small>{item.help}</small></span>
                      <ChevronRight />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="t04-context">
                  Perfil selecionado: <strong>{ROLES.find((item) => item.role === role)?.label}</strong>
                  <button type="button" onClick={() => setRole(null)}>Trocar</button>
                </div>
                <label>
                  E-mail do cadastro
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.currentTarget.value)}
                    required
                    maxLength={255}
                    placeholder="seuemail@exemplo.com"
                  />
                </label>
                <button className="t04-primary" disabled={busy}>
                  {busy ? "Enviando…" : "Reenviar confirmação"}
                </button>
              </>
            )}
          </form>
        )}

        <div className="t04-footer-actions">
          <button
            type="button"
            className="t04-link-button"
            onClick={() => onNavigate(session ? "/minha-conta" : role ? loginPath(role) : "/entrar")}
          >
            {session ? "Ir para minha conta" : "Voltar para entrar"}
          </button>
        </div>
      </div>
    </section>
  );
}
