import { PageLoading } from "../../components/PageLoading";
import { adminSectorLabel } from "../../../shared/adminPermissions";
import { useEffect, useRef, useState } from "react";
import { Crown, Leaf, ShieldCheck } from "lucide-react";
import "./adminInvites.css";
import { api } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import { PasswordInput } from "../../components/forms/PasswordInput";
import { PasswordStrengthMeter } from "../../components/forms/PasswordStrengthMeter";
import { CPFInput } from "../../components/forms/CPFInput";
import { PhoneInput } from "../../components/forms/PhoneInput";
import { logoutCurrentBrowserSessions } from "../../lib/sessionLogout";

type Props = { onNavigate: (to: string) => void };
type InviteState = {
  status: string;
  email?: string;
  targetRole?: string;
  identityMode?: "new" | "existing";
  existingRoles?: Array<"consumer" | "producer">;
  sectors?: string[];
  expiresAt?: string;
};
const publicRoleLabel = (role: string) =>
  role === "producer" ? "Produtor" : role === "consumer" ? "Consumidor" : role;

export function AdminAcceptInvitePage({ onNavigate }: Props) {
  const token = new URLSearchParams(location.search).get("token") ?? "";
  const [state, setState] = useState<InviteState>({ status: "loading" });
  const [form, setForm] = useState({
    fullName: "",
    cpf: "",
    phone: "",
    password: "",
  });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [exitError, setExitError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const successNavigation = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const activation = useRef<AbortController | null>(null);
  const currentToken = useRef(token);
  currentToken.current = token;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activation.current?.abort();
      if (successNavigation.current) clearTimeout(successNavigation.current);
    };
  }, []);

  useEffect(() => {
    activation.current?.abort();
    activation.current = null;
    if (successNavigation.current) clearTimeout(successNavigation.current);
    successNavigation.current = null;
    setAccepted(false);
    setBusy(false);
    setMessage("");
    setExitError("");
    setForm({ fullName: "", cpf: "", phone: "", password: "" });
    setState({ status: "loading" });
    if (!token) {
      setState({ status: "invalid" });
      return;
    }
    const abort = new AbortController();
    api<InviteState>(
      "/v1/admin/invites/validate?token=" + encodeURIComponent(token),
      { signal: abort.signal },
    )
      .then((next) => {
        if (!abort.signal.aborted) setState(next);
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ status: "invalid" });
      });
    return () => abort.abort();
  }, [token]);

  async function returnToSite() {
    if (leaving || busy) return;
    setLeaving(true);
    setExitError("");
    if (successNavigation.current) clearTimeout(successNavigation.current);
    try {
      await logoutCurrentBrowserSessions();
      if (!mounted.current) return;
      // Remove the personal invitation URL from the current history entry.
      history.replaceState({}, "", "/");
      onNavigate("/");
    } catch {
      if (mounted.current)
        setExitError(
          "Não foi possível encerrar as sessões com segurança. Confira sua conexão e tente voltar ao site novamente.",
        );
    } finally {
      if (mounted.current) setLeaving(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || leaving || accepted || activation.current) return;
    const abort = new AbortController();
    activation.current = abort;
    const stillCurrent = () =>
      mounted.current &&
      !abort.signal.aborted &&
      currentToken.current === token;
    setBusy(true);
    setMessage("");
    let activated = false;
    try {
      const payload = { ...form, token, commandId: cryptoRandomUUID() };
      const result = await api<{ status: string }>("/v1/admin/invites/accept", {
        method: "POST",
        body: JSON.stringify(payload),
        signal: abort.signal,
      });
      if (!stillCurrent()) return;
      if (result.status === "accepted") {
        activated = true;
        setAccepted(true);
        setMessage(
          state.identityMode === "existing"
            ? "Acesso administrativo criado. Seus perfis de Consumidor ou Produtor continuam preservados e usam o cadastro público normalmente."
            : "Convite aceito. Seu acesso administrativo está pronto.",
        );
        // Activation grants a credential; it never signs the recipient in.
        // Clear any previously open identity before showing its login screen.
        await logoutCurrentBrowserSessions();
        if (!stillCurrent()) return;
        successNavigation.current = setTimeout(() => {
          if (stillCurrent())
            onNavigate(
              state.targetRole === "platform_super_admin"
                ? "/entrar/super-administrador"
                : "/admin/entrar",
            );
        }, 900);
      }
    } catch (err) {
      if (!stillCurrent()) return;
      if (activated) {
        setExitError(
          "Seu convite foi aceito, mas não foi possível encerrar a sessão anterior com segurança. Confira sua conexão e use Voltar ao site para sair antes de entrar com seu e-mail e senha.",
        );
        return;
      }
      const status = (err as { status?: number }).status;
      setMessage(
        status === 409
          ? "Cadastro não autorizado. Confirme o CPF vinculado a este convite."
          : status === 422
            ? "Revise os dados informados."
            : "Não foi possível concluir o convite. Tente novamente.",
      );
    } finally {
      if (activation.current === abort) activation.current = null;
      if (mounted.current && currentToken.current === token) setBusy(false);
    }
  }

  const valid = state.status === "valid";
  const existing = valid && state.identityMode === "existing";
  const isSuper = state.targetRole === "platform_super_admin";

  return (
    <section
      className={`admin-login-page admin-invite-accept ${isSuper ? "is-super" : ""}`}
    >
      <header className="admin-login-header">
        <button
          type="button"
          className="admin-back"
          onClick={returnToSite}
          disabled={leaving || busy}
        >
          {leaving ? "Encerrando sessões…" : "← Voltar ao site"}
        </button>
        <div className="admin-login-brand">
          <span className="admin-brand-mark">
            <Leaf />
          </span>
          <strong>
            Horti<span>Vital</span>Mix
          </strong>
        </div>
      </header>
      <div className="admin-bootstrap-wrap">
        <div className="admin-login-card admin-login-card--wide">
          <div className="admin-login-icon">
            {isSuper ? <Crown /> : <ShieldCheck />}
          </div>
          <span className="admin-kicker">
            {valid
              ? isSuper
                ? "Convite de super administrador"
                : "Convite de administrador setorial"
              : "Convite administrativo"}
          </span>
          {exitError && (
            <p className="admin-alert" role="alert">
              {exitError}
            </p>
          )}
          {state.status === "loading" && (
            <PageLoading label="Validando convite…" compact />
          )}
          {state.status !== "loading" && !valid && (
            <>
              <h1>Este convite não está disponível</h1>
              <p className="admin-muted">
                O link pode ter expirado, sido invalidado ou já utilizado.
              </p>
            </>
          )}
          {valid && (
            <>
              <h1>
                {existing
                  ? "Ative o acesso administrativo"
                  : "Conclua seu cadastro"}
              </h1>
              <p className="admin-muted">
                {state.email} ·{" "}
                {state.targetRole === "platform_super_admin"
                  ? "Super administrador"
                  : "Administrador setorial"}
              </p>
              <div
                className={`admin-invite-role-preview ${isSuper ? "is-super" : ""}`}
              >
                {isSuper ? <Crown size={23} /> : <ShieldCheck size={23} />}
                <div>
                  <strong>
                    {isSuper
                      ? "Gestão da plataforma"
                      : "Administração por setores"}
                  </strong>
                  <p>
                    {isSuper
                      ? "Gerencie a plataforma e os acessos administrativos conforme as permissões da governança."
                      : "Seu acesso se limita aos setores autorizados neste convite."}
                  </p>
                </div>
              </div>
              {state.expiresAt && (
                <p className="admin-invite-validity">
                  Ative até{" "}
                  {new Date(state.expiresAt).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                  . Este convite é pessoal e de uso único.
                </p>
              )}
              {(state.sectors?.length ?? 0) > 0 && (
                <div className="admin-chip-row">
                  {state.sectors!.map((s) => (
                    <span key={s}>{adminSectorLabel(s)}</span>
                  ))}
                </div>
              )}
              {existing && (
                <div className="admin-alert admin-alert--success">
                  Este CPF já possui cadastro no HortiVitalMix.
                  {(state.existingRoles?.length ?? 0) > 0 && (
                    <>
                      {" "}
                      Perfis preservados:{" "}
                      {state.existingRoles!.map(publicRoleLabel).join(" • ")}.
                    </>
                  )}{" "}
                  Informe os dados deste cadastro administrativo. Nome, perfil e
                  senha serão independentes dos seus outros cadastros.
                </div>
              )}
              {message && <div className="admin-alert">{message}</div>}
              {!accepted && (
                <form onSubmit={submit} className="admin-form-grid">
                  <label>
                    Nome completo
                    <input
                      value={form.fullName}
                      onChange={(e) =>
                        setForm({ ...form, fullName: e.target.value })
                      }
                      required
                      minLength={3}
                    />
                  </label>

                  <CPFInput
                    value={form.cpf}
                    onChange={(value) => setForm({ ...form, cpf: value })}
                  />

                  <PhoneInput
                    value={form.phone}
                    onChange={(value) => setForm({ ...form, phone: value })}
                  />

                  <label className="admin-span-2">
                    Crie a senha do acesso administrativo
                    <PasswordInput
                      value={form.password}
                      onChange={(value) =>
                        setForm({ ...form, password: value })
                      }
                      autoComplete="new-password"
                    />
                    <PasswordStrengthMeter value={form.password} />
                  </label>

                  <button
                    className="admin-primary admin-span-2"
                    disabled={busy || leaving}
                  >
                    {busy
                      ? "Ativando…"
                      : existing
                        ? "Adicionar acesso administrativo"
                        : "Aceitar convite e ativar acesso"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
