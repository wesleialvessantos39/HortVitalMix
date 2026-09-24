import { useEffect, useMemo, useState } from "react";
import { ChevronRight, KeyRound, Mail, ShieldCheck, Sprout } from "lucide-react";
import { api } from "../../lib/api";
import { PortalRoleSchema, type PortalRole } from "../../../shared/contracts/auth";
import "./auth.css";

const ROLES: Array<{ role: PortalRole; label: string; help: string }> = [
  { role: "consumer", label: "Consumidor", help: "Compras, pedidos e assinaturas." },
  { role: "producer", label: "Produtor", help: "Produção, ofertas e vendas." },
  { role: "platform_admin", label: "Administrador", help: "Operação administrativa." },
  { role: "platform_super_admin", label: "Super administrador", help: "Governança da plataforma." },
];

function queryRole(): PortalRole | null {
  const parsed = PortalRoleSchema.safeParse(new URLSearchParams(location.search).get("portal"));
  return parsed.success ? parsed.data : null;
}

function loginPath(role: PortalRole | null) {
  if (role === "consumer") return "/entrar/consumidor";
  if (role === "producer") return "/entrar/produtor";
  if (role === "platform_admin") return "/entrar/administrador";
  if (role === "platform_super_admin") return "/entrar/super-administrador";
  return "/entrar";
}

export function RecoverPasswordPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [role, setRole] = useState<PortalRole | null>(useMemo(queryRole, []));
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(
      () => setRetryAfter((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!role) {
      setNotice("Escolha primeiro o perfil de acesso.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{
        status: string;
        retryAfterSeconds?: number;
      }>("/v1/auth/request-password-reset", {
        method: "POST",
        body: JSON.stringify({ email, portalRole: role }),
      });
      setSent(true);
      setRetryAfter(result.retryAfterSeconds ?? 60);
      setNotice(
        `Se o e-mail possuir o perfil ${ROLES.find((item) => item.role === role)?.label}, as instruções foram processadas. Um pedido repetido não invalida o link anterior enquanto um novo e-mail não for realmente enviado.`,
      );
    } catch {
      setNotice("Não foi possível processar a solicitação agora. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="t04-security-layout" aria-labelledby="t04-recovery-title">
      <aside className="t04-security-aside">
        <div className="t04-brand-mark"><Sprout /></div>
        <span className="t04-kicker">Recuperação segura</span>
        <h2>Volte para sua conta com segurança.</h2>
        <p>Enviaremos um link para você criar uma nova senha com segurança.</p>
        <div className="t04-steps">
          <span><b>1</b> Selecione seu perfil</span>
          <span><b>2</b> Informe o e-mail</span>
          <span><b>3</b> Defina uma nova senha</span>
        </div>
      </aside>

      <div className="t04-security-card">
        <div className="t04-title-icon"><KeyRound /></div>
        <span className="eyebrow">Segurança da conta</span>
        <h1 id="t04-recovery-title">Recuperar senha</h1>
        <p className="t04-lead">A recuperação permanece vinculada ao perfil usado no acesso. A resposta não revela se o e-mail existe.</p>

        {notice && <div className={sent ? "t04-banner success" : "t04-banner"} role="status">{notice}</div>}

        {sent ? (
          <div className="t04-mail-result">
            <div className="t04-title-icon success"><Mail /></div>
            <h2>Confira seu e-mail</h2>
            <p>Abra o link enviado por e-mail para criar sua nova senha.</p>
            <button
              type="button"
              className="t04-secondary"
              disabled={retryAfter > 0}
              onClick={() => setSent(false)}
            >
              {retryAfter > 0
                ? `Novo envio disponível em ${retryAfter}s`
                : "Enviar novamente"}
            </button>
          </div>
        ) : (
          <form className="t04-form" onSubmit={submit}>
            {!role ? (
              <div>
                <span className="t04-field-label">Escolha seu perfil de acesso</span>
                <div className="t04-role-grid">
                  {ROLES.map((item) => (
                    <button
                      className="t04-role-option"
                      type="button"
                      key={item.role}
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
                  Perfil: <strong>{ROLES.find((item) => item.role === role)?.label}</strong>
                  <button type="button" onClick={() => setRole(null)}>Trocar</button>
                </div>
                <label>
                  E-mail cadastrado
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
                  {busy ? "Enviando…" : "Enviar link de recuperação"}
                </button>
              </>
            )}
          </form>
        )}

        <div className="t04-footer-actions">
          <button type="button" className="t04-link-button" onClick={() => onNavigate(loginPath(role))}>
            Voltar para entrar
          </button>
        </div>
      </div>
    </section>
  );
}
