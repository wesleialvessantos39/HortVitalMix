import { adminSectorLabel } from "../../../shared/adminPermissions";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Crown,
  MailPlus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import "./adminInvites.css";
import { api } from "../../lib/api";
import { CPFInput } from "../../components/forms/CPFInput";
import { cryptoRandomUUID } from "../../lib/uuid";
import type {
  AdminVerifySessionResponse,
  InviteResponse,
} from "../../../shared/contracts/adminGovernance";

type Props = {
  onNavigate: (to: string) => void;
  access: AdminVerifySessionResponse;
};
type Sector = { code: string; name: string; description: string };
type IdentityLookup = {
  found: boolean;
  identity?: {
    fullName: string;
    cpf: string;
    publicEmail: string;
    status: string;
    publicRoles: string[];
    adminRoles: Array<"platform_admin" | "platform_super_admin">;
  };
};
const roleLabels = {
  platform_admin: "Administrador setorial",
  platform_super_admin: "Super administrador",
} as const;
const publicRoleLabel = (role: string) =>
  role === "producer" ? "Produtor" : role === "consumer" ? "Consumidor" : role;
const adminRoleLabel = (role: string) =>
  role === "platform_super_admin"
    ? "Super administrador"
    : "Administrador setorial";

export function AdminGovernancePage({ onNavigate, access }: Props) {
  const isSuper = access.role === "platform_super_admin";
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [invites, setInvites] = useState<InviteResponse[]>([]);
  const [email, setEmail] = useState("");
  const [targetCpf, setTargetCpf] = useState("");
  const [targetRole, setTargetRole] = useState<
    "platform_admin" | "platform_super_admin"
  >("platform_admin");
  const [selected, setSelected] = useState<string[]>([]);
  const [identity, setIdentity] = useState<IdentityLookup | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<InviteResponse | "clear" | null>(null);
  const [acting, setActing] = useState(false);
  const confirmation = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");

  const refreshInFlight = useRef(false);
  const inviteListRevision = useRef(0);
  const [syncError, setSyncError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = useRef(false);
  async function load() {
    if (manualRefresh.current) return;
    manualRefresh.current = true;
    setRefreshing(true);
    setError("");
    const revision = inviteListRevision.current;
    try {
      const [s, i] = await Promise.all([
        api<{ sectors: Sector[] }>("/v1/admin/sectors"),
        api<{ invites: InviteResponse[] }>("/v1/admin/invites"),
      ]);
      setSectors(s.sectors);
      if (revision === inviteListRevision.current) setInvites(i.invites);
    } catch {
      setError("Não foi possível carregar a governança administrativa.");
    } finally {
      manualRefresh.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const dialog = confirmation.current;
    if (action && dialog && !dialog.open) dialog.showModal();
    if (!action && dialog?.open) dialog.close();
  }, [action]);
  const hasPending = invites.some(
    (i) =>
      !i.isAccepted &&
      !i.invalidatedAt &&
      new Date(i.expiresAt).getTime() > Date.now(),
  );
  useEffect(() => {
    if (!hasPending) return;
    const abort = new AbortController();
    async function sync() {
      if (document.visibilityState !== "visible" || refreshInFlight.current)
        return;
      refreshInFlight.current = true;
      const revision = inviteListRevision.current;
      try {
        const result = await api<{ invites: InviteResponse[] }>(
          "/v1/admin/invites",
          { signal: abort.signal },
        );
        if (!abort.signal.aborted && revision === inviteListRevision.current) {
          setInvites(result.invites);
          setSyncError("");
        }
      } catch {
        if (!abort.signal.aborted)
          setSyncError(
            "A atualização automática está indisponível. Tente atualizar novamente.",
          );
      } finally {
        refreshInFlight.current = false;
      }
    }
    const timer = window.setInterval(() => void sync(), 3000);
    document.addEventListener("visibilitychange", sync);
    return () => {
      abort.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [hasPending]);

  async function lookupIdentity() {
    const cpf = targetCpf.replace(/\D/g, "");
    setIdentity(null);
    if (cpf.length !== 11) return;
    try {
      const result = await api<IdentityLookup>(
        "/v1/admin/identities/lookup?cpf=" + encodeURIComponent(cpf),
      );
      setIdentity(result);
    } catch {
      setIdentity(null);
    }
  }

  function toggle(code: string) {
    setSelected((v) =>
      v.includes(code) ? v.filter((x) => x !== code) : [...v, code],
    );
  }
  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await api<{ status: string; invite?: InviteResponse }>(
        "/v1/admin/invites",
        {
          method: "POST",
          body: JSON.stringify({
            email,
            targetCpf: targetCpf.replace(/\D/g, "") || undefined,
            targetRole,
            sectors: targetRole === "platform_admin" ? selected : [],
            commandId: cryptoRandomUUID(),
          }),
        },
      );
      if (result.status === "created" && result.invite) {
        inviteListRevision.current++;
        setSuccess(
          result.invite.identityMode === "existing"
            ? "Convite enviado. O cadastro existente será preservado e receberá apenas o novo acesso administrativo."
            : "Convite enviado. O novo acesso administrativo poderá ser ativado pelo link recebido.",
        );
        setEmail("");
        setTargetCpf("");
        setSelected([]);
        setIdentity(null);
        setTargetRole("platform_admin");
        const created = result.invite;
        setInvites((current) => [
          created,
          ...current.filter((i) => i.id !== created.id),
        ]);
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 401
          ? "Entre novamente para confirmar esta operação."
          : status === 403
            ? "Seu nível de acesso não permite criar esse tipo de administrador."
            : status === 409
              ? "Já existe acesso ou convite pendente para este mesmo papel administrativo."
              : "Não foi possível emitir o convite.",
      );
    } finally {
      setBusy(false);
    }
  }

  const inviteStatus = (i: InviteResponse) =>
    i.isAccepted
      ? "accepted"
      : i.invalidatedAt
        ? "cancelled"
        : Date.parse(i.expiresAt) <= Date.now()
          ? "expired"
          : "pending";
  const visibleInvites = invites.filter(
    (i) =>
      (filter === "all" || inviteStatus(i) === filter) &&
      i.email.toLowerCase().includes(query.trim().toLowerCase()),
  );

  async function confirmAction() {
    if (!action || acting) return;
    setActing(true);
    setError("");
    setSuccess("");
    try {
      if (action === "clear") {
        const result = await api<{ count: number }>(
          "/v1/admin/invites/clear-history",
          {
            method: "POST",
            body: JSON.stringify({ commandId: cryptoRandomUUID() }),
          },
        );
        inviteListRevision.current++;
        setInvites((current) =>
          current.filter((i) => inviteStatus(i) === "pending"),
        );
        setSuccess(
          `${result.count} convite(s) removido(s) do histórico. Os convites pendentes continuam disponíveis.`,
        );
      } else {
        const result = await api<{ cleanupPending?: boolean }>(
          `/v1/admin/invites/${action.id}`,
          {
            method: "DELETE",
            body: JSON.stringify({
              expectedRevision: action.revision,
              commandId: cryptoRandomUUID(),
            }),
          },
        );
        inviteListRevision.current++;
        setInvites((current) => current.filter((i) => i.id !== action.id));
        setSuccess(
          action.isAccepted
            ? "Convite removido do histórico. O acesso administrativo permanece ativo."
            : result.cleanupPending
              ? "Convite excluído e link cancelado. A liberação do e-mail será tentada novamente ao emitir um novo convite."
              : "Convite excluído e link cancelado. Você já pode enviar um novo convite para este e-mail.",
        );
      }
      setAction(null);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 409
          ? "O convite foi atualizado. Atualize o histórico antes de tentar novamente."
          : status === 401
            ? "Entre novamente para confirmar esta operação."
            : status === 403
              ? "Seu acesso não permite alterar este convite."
              : "Não foi possível concluir a operação. Tente novamente.",
      );
      setAction(null);
    } finally {
      setActing(false);
    }
  }

  return (
    <section className="admin-page admin-invite-governance">
      <header className="admin-page-header">
        <div>
          <span className="admin-kicker">
            <ShieldCheck size={15} /> Governança
          </span>
          <h1>Convites administrativos</h1>
          <p>
            Crie novos acessos sem duplicar CPF ou cadastro pessoal. Cada acesso
            mantém seu próprio nome e perfil, sem alterar os outros cadastros.
          </p>
        </div>
        <button
          className="admin-secondary compact"
          disabled={refreshing}
          aria-busy={refreshing}
          onClick={() => void load()}
        >
          <RefreshCw
            size={16}
            className={refreshing ? "hvm-sync-spinning" : undefined}
          />{" "}
          {refreshing ? "Atualizando…" : "Atualizar"}
        </button>
      </header>

      {error && (
        <div className="admin-alert admin-alert--error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="admin-alert admin-alert--success" role="status">
          {success}
        </div>
      )}
      <div className="admin-alert">
        {isSuper
          ? "Hierarquia: você pode convidar Administradores setoriais e outros Super administradores."
          : "Hierarquia: você pode convidar somente Administradores setoriais e apenas para setores aos quais já possui acesso."}
      </div>

      <div className="admin-governance-grid">
        <section className="admin-card">
          <h2>
            <MailPlus size={19} /> Novo acesso administrativo
          </h2>
          <p className="admin-muted">
            Escolha o papel e os poderes antes do envio. O destinatário receberá
            um convite válido por 24 horas.
          </p>
          <form onSubmit={createInvite} className="admin-form">
            <CPFInput
              label="CPF já cadastrado (opcional)"
              required={false}
              value={targetCpf}
              onChange={(value) => {
                setTargetCpf(value);
                setIdentity(null);
              }}
            />
            {targetCpf.replace(/\D/g, "").length === 11 && (
              <button
                type="button"
                className="admin-secondary compact"
                onClick={() => void lookupIdentity()}
              >
                Localizar cadastro
              </button>
            )}

            {identity?.found && identity.identity && (
              <div className="admin-alert admin-alert--success">
                <strong>
                  <UsersRound size={15} /> Cadastro existente localizado.
                </strong>
                <div>{identity.identity.fullName}</div>
                <small>
                  Perfis públicos:{" "}
                  {identity.identity.publicRoles.length
                    ? identity.identity.publicRoles
                        .map(publicRoleLabel)
                        .join(" • ")
                    : "nenhum"}
                  . Esses perfis serão preservados.
                  {identity.identity.adminRoles.length
                    ? " Acessos administrativos existentes: " +
                      identity.identity.adminRoles
                        .map(adminRoleLabel)
                        .join(" • ") +
                      "."
                    : ""}
                </small>
              </div>
            )}

            <label>
              E-mail administrativo
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <div
              className={`admin-invite-role-preview ${targetRole === "platform_super_admin" ? "is-super" : ""}`}
            >
              {targetRole === "platform_super_admin" ? (
                <Crown size={23} />
              ) : (
                <ShieldCheck size={23} />
              )}
              <div>
                <strong>{roleLabels[targetRole]}</strong>
                <p>
                  {targetRole === "platform_super_admin"
                    ? "Acesso à gestão da plataforma e à delegação de administradores."
                    : "Acesso restrito aos setores selecionados neste convite."}
                </p>
              </div>
            </div>

            <label>
              Papel
              <select
                value={targetRole}
                onChange={(e) => {
                  const role = e.target.value as typeof targetRole;
                  setTargetRole(role);
                  if (role === "platform_super_admin") setSelected([]);
                }}
              >
                <option value="platform_admin">Administrador setorial</option>
                {isSuper && (
                  <option value="platform_super_admin">
                    Super administrador
                  </option>
                )}
              </select>
            </label>

            {targetRole === "platform_admin" && (
              <fieldset className="admin-sectors-fieldset">
                <legend>Setores obrigatórios</legend>
                {sectors.map((s) => (
                  <label key={s.code} className="admin-sector-checkbox">
                    <input
                      type="checkbox"
                      checked={selected.includes(s.code)}
                      onChange={() => toggle(s.code)}
                    />
                    <span>
                      <strong>{s.name}</strong>
                      <small>{s.description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            <button
              className="admin-primary"
              disabled={
                busy ||
                (targetRole === "platform_admin" && selected.length === 0)
              }
            >
              {busy ? "Enviando…" : "Enviar convite"}
            </button>
          </form>
        </section>

        <section className="admin-card admin-card--table">
          <div className="admin-card-heading">
            <div>
              <h2>Histórico de convites</h2>
              <p className="admin-muted">
                {isSuper
                  ? "Todos os convites administrativos."
                  : "Somente convites emitidos por você."}
              </p>
            </div>
            <button
              type="button"
              className="admin-secondary compact"
              disabled={invites.length === 0 || acting || loading}
              onClick={() => setAction("clear")}
            >
              <Archive size={16} /> Limpar histórico
            </button>
          </div>
          <div className="admin-invite-filters">
            <label className="admin-invite-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                aria-label="Buscar convite por e-mail"
                placeholder="Buscar por e-mail"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Filtrar convites por status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">Todos ({invites.length})</option>
              <option value="pending">Pendentes</option>
              <option value="accepted">Aceitos</option>
              <option value="expired">Expirados</option>
              <option value="cancelled">Cancelados</option>
            </select>
          </div>
          {hasPending && (
            <p className="admin-muted" role="status">
              Acompanhando a aceitação dos convites automaticamente.
            </p>
          )}
          {syncError && (
            <p role="status" className="admin-muted">
              {syncError}
            </p>
          )}
          {loading ? (
            <p className="admin-empty" role="status">
              Carregando convites…
            </p>
          ) : visibleInvites.length === 0 ? (
            <p className="admin-empty">
              {invites.length
                ? "Nenhum convite corresponde à busca."
                : "Nenhum convite no histórico."}
            </p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table admin-invites-table">
                <thead>
                  <tr>
                    <th>E-mail</th>
                    <th>Papel</th>
                    <th>Origem</th>
                    <th>Setores</th>
                    <th>Status</th>
                    <th>Expira</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleInvites.map((i) => {
                    const expired =
                      new Date(i.expiresAt).getTime() < Date.now();
                    const label = i.isAccepted
                      ? "Aceito"
                      : i.invalidatedAt
                        ? "Invalidado"
                        : expired
                          ? "Expirado"
                          : "Pendente";
                    return (
                      <tr key={i.id}>
                        <td data-label="E-mail">
                          <span className="admin-invite-email">{i.email}</span>
                          <button
                            type="button"
                            className="admin-invite-remove"
                            disabled={acting}
                            aria-label={`Excluir convite para ${i.email}`}
                            onClick={() => setAction(i)}
                          >
                            <Trash2 size={14} /> Excluir convite
                          </button>
                        </td>
                        <td data-label="Papel">
                          <span
                            className={`admin-invite-role-tag ${i.targetRole === "platform_super_admin" ? "is-super" : ""}`}
                          >
                            {roleLabels[i.targetRole]}
                          </span>
                        </td>
                        <td data-label="Origem">
                          {i.identityMode === "existing"
                            ? "Cadastro existente"
                            : "Novo cadastro"}
                        </td>
                        <td data-label="Poderes">
                          {i.sectors.length
                            ? i.sectors.map((code) => (
                                <span className="admin-sector-tag" key={code}>
                                  {adminSectorLabel(code)}
                                </span>
                              ))
                            : "—"}
                        </td>
                        <td data-label="Status">
                          <span
                            className={
                              "admin-badge " +
                              (i.isAccepted
                                ? "admin-badge--ok"
                                : label === "Pendente"
                                  ? "admin-badge--pending"
                                  : "")
                            }
                          >
                            {label}
                          </span>
                        </td>
                        <td data-label="Expira">
                          <time dateTime={i.expiresAt}>
                            <span>
                              {new Date(i.expiresAt).toLocaleDateString(
                                "pt-BR",
                              )}
                            </span>
                            <span>
                              {new Date(i.expiresAt).toLocaleTimeString(
                                "pt-BR",
                                { hour: "2-digit", minute: "2-digit" },
                              )}
                            </span>
                          </time>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <dialog
        ref={confirmation}
        className="admin-invite-confirmation"
        aria-labelledby="invite-confirm-title"
        onCancel={(e) => {
          if (acting) e.preventDefault();
          else setAction(null);
        }}
        onClose={() => setAction(null)}
      >
        <h2 id="invite-confirm-title">
          {action === "clear"
            ? "Limpar histórico de convites?"
            : "Excluir este convite?"}
        </h2>
        <p>
          {action === "clear"
            ? "Convites aceitos, expirados e cancelados serão removidos do histórico. Convites pendentes e registros de auditoria serão preservados."
            : action?.isAccepted
              ? "O convite será removido do histórico. O acesso já ativado e o registro de auditoria serão preservados."
              : "O link será cancelado e o convite será removido do histórico. Você poderá emitir outro convite para o mesmo e-mail. O registro de auditoria será preservado."}
        </p>
        {action && action !== "clear" && (
          <strong className="admin-invite-email">{action.email}</strong>
        )}
        <div className="admin-invite-confirm-actions">
          <button
            type="button"
            className="admin-secondary"
            disabled={acting}
            onClick={() => setAction(null)}
          >
            Voltar
          </button>
          <button
            type="button"
            className="admin-primary"
            disabled={acting}
            onClick={() => void confirmAction()}
          >
            {acting
              ? "Processando…"
              : action === "clear"
                ? "Limpar histórico"
                : "Excluir convite"}
          </button>
        </div>
      </dialog>
      <button
        className="admin-link"
        onClick={() => onNavigate("/admin/painel")}
      >
        Voltar ao painel
      </button>
    </section>
  );
}
