import { useEffect, useRef, useState } from "react";
import { RegistrationReviews } from "./RegistrationReviews";
import { RefreshCw, UserCog, UsersRound, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";

type UserRow = {
  id: string;
  status: string;
  stored_status?: string;
  block_starts_at?: string;
  block_ends_at?: string;
  full_name: string;
  email_normalized: string;
  role_code: "platform_admin" | "platform_super_admin" | null;
  account_kind?: "public" | "administrative";
  email_confirmed?: boolean;
  sectors: string[];
  public_roles: string[];
};
const publicRoleLabel = (role: string) =>
  role === "producer" ? "Produtor" : role === "consumer" ? "Consumidor" : role;

export function AdminUsersPage({
  access,
}: {
  access: AdminVerifySessionResponse;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [focusUserId,setFocusUserId]=useState(()=>{const value=new URLSearchParams(location.search).get("userId");return value&&/^[a-f0-9-]{36}$/i.test(value)?value:null;});
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [mode, setMode] = useState("indefinite"),
    [startsAt, setStartsAt] = useState(""),
    [endsAt, setEndsAt] = useState("");
  const [deleting, setDeleting] = useState<UserRow | null>(null),
    [deleteConfirmed, setDeleteConfirmed] = useState(false),
    [refreshKey, setRefreshKey] = useState(0);
  const isSuper = access.role === "platform_super_admin";
  const canGovernAccounts =
    isSuper || access.sectors.includes("account_governance");

  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = useRef(false);
  async function load() {
    if (manualRefresh.current) return;
    manualRefresh.current = true;
    setRefreshing(true);
    setError("");
    try {
      const r = await api<{ users: UserRow[] }>("/v1/admin/users");
      setUsers(r.users);
      setRefreshKey((key) => key + 1);
    } catch {
      setError("Não foi possível carregar os usuários.");
    } finally {
      manualRefresh.current = false;
      setRefreshing(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function changeStatus(user: UserRow, unblock = false) {
    if (!canGovernAccounts) return;
    setBusy(user.id);
    setError("");
    const status = unblock ? "active" : "blocked";
    try {
      await api("/v1/admin/users/" + encodeURIComponent(user.id) + "/status", {
        method: "PATCH",
        body: JSON.stringify({
          status,
          commandId: cryptoRandomUUID(),
          ...(unblock
            ? {}
            : {
                mode,
                ...(mode === "custom"
                  ? {
                      startsAt: new Date(startsAt).toISOString(),
                      endsAt: new Date(endsAt).toISOString(),
                    }
                  : {}),
              }),
        }),
      });
      setSelected(null);
      await load();
    } catch (err) {
      const e = err as { status?: number; message?: string };
      setError(
        e.message === "ACCOUNT_REQUIRES_REVIEW"
          ? "Esta conta exige análise; não é possível desbloqueá-la por esta ação."
          : e.status === 422
            ? "Confira as datas: o término deve ser futuro e posterior ao início."
            : e.status === 409
              ? "O último Super administrador ativo é protegido e não pode ser bloqueado."
              : e.status === 401
                ? "Entre novamente para confirmar esta operação."
                : "A alteração não pôde ser concluída.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    if (!deleting || !deleteConfirmed || busy) return;
    setBusy(deleting.id);
    setError("");
    try {
      await api("/v1/admin/users/" + deleting.id + "/delete", {
        method: "POST",
        body: JSON.stringify({ commandId: cryptoRandomUUID() }),
      });
      setDeleting(null);
      await load();
    } catch (err) {
      const e = err as { status?: number };
      setError(
        e.status === 409
          ? "Esta conta administrativa é protegida."
          : e.status === 401
            ? "Entre novamente para confirmar esta operação."
            : "A exclusão não pôde ser concluída. Atualize a lista e tente novamente.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-kicker">
            <UsersRound size={15} /> Segurança de acesso
          </span>
          <h1>Usuários</h1>
          <p>
            O cadastro pessoal é único, mas os perfis públicos e o acesso
            administrativo são exibidos separadamente.
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
      {!isSuper && (
        <div className="admin-alert">
          {canGovernAccounts
            ? "O Super administrador delegou a você a governança de contas. Você pode analisar, bloquear, desbloquear e excluir contas não protegidas."
            : "Você possui acesso somente de consulta nesta área. Ações de governança exigem o setor account_governance concedido pelo Super administrador."}
        </div>
      )}
      {error && <div className="admin-alert admin-alert--error">{error}</div>}
      {selected && (
        <form
          className="admin-card admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            void changeStatus(selected);
          }}
        >
          <h2>Bloquear acesso de {selected.full_name}</h2>
          <label>
            Tipo de bloqueio
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="indefinite">Prazo indeterminado</option>
              <option value="custom">Bloqueio personalizado</option>
            </select>
          </label>
          {mode === "custom" && (
            <>
              <p>
                Datas e horários no fuso deste aparelho (
                {Intl.DateTimeFormat().resolvedOptions().timeZone}). Desbloqueio
                automático ao término.
              </p>
              <label>
                Início
                <input
                  type="datetime-local"
                  required
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </label>
              <label>
                Término
                <input
                  type="datetime-local"
                  required
                  min={startsAt}
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </label>
            </>
          )}
          <button className="admin-primary" disabled={!!busy}>
            Confirmar bloqueio
          </button>
          <button
            type="button"
            className="admin-secondary"
            disabled={!!busy}
            onClick={() => setSelected(null)}
          >
            Cancelar
          </button>
        </form>
      )}
      {deleting && (
        <form
          className="admin-card admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            void deleteAccount();
          }}
        >
          <h2>Excluir conta de {deleting.full_name}</h2>
          <p>
            O acesso será encerrado. O histórico será preservado para auditoria
            e análise de futuros cadastros. Todos os perfis vinculados a este
            login serão encerrados. Credenciais administrativas independentes
            permanecem separadas.
          </p>
          <label className="admin-confirm-checkbox">
            <input
              type="checkbox"
              required
              checked={deleteConfirmed}
              onChange={(e) => setDeleteConfirmed(e.target.checked)}
            />{" "}
            Confirmo a exclusão desta conta.
          </label>
          <div className="admin-button-row">
            <button
              className="admin-primary admin-danger"
              disabled={!!busy || !deleteConfirmed}
            >
              Confirmar exclusão
            </button>
            <button
              type="button"
              className="admin-secondary"
              disabled={!!busy}
              onClick={() => setDeleting(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {canGovernAccounts && (
        <RegistrationReviews
          refreshKey={refreshKey}
          onChanged={() => void load()}
        />
      )}
      <section className="admin-card admin-card--table">
        {refreshing && users.length === 0 ? (
          <p className="admin-empty" role="status">
            Carregando usuários…
          </p>
        ) : users.length === 0 ? (
          <p className="admin-empty">Nenhum usuário encontrado.</p>
        ) : (
          <>{focusUserId&&<p className="admin-alert">Conta vinculada à denúncia. <button className="admin-secondary" onClick={()=>setFocusUserId(null)}>Mostrar todos os usuários</button></p>}
      <div className="admin-table-wrap">
            <table className="admin-table admin-users-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Tipo de conta</th>
                  <th>Perfis vinculados</th>
                  <th>Setores</th>
                  <th>Status</th>
                  {canGovernAccounts && <th>Ação</th>}
                </tr>
              </thead>
              <tbody>
                {users.filter(user=>!focusUserId||user.id===focusUserId).map((u) => (
                  <tr key={u.id + "-" + u.role_code}>
                    <td data-label="Usuário">
                      <strong>{u.full_name}</strong>
                      <small className="admin-table-sub">
                        {u.email_normalized}
                      </small>
                    </td>
                    <td data-label="Tipo de conta">
                      {u.role_code === "platform_super_admin"
                        ? "Super administrador"
                        : u.role_code === "platform_admin"
                          ? "Administrador setorial"
                          : "Conta pública"}
                    </td>
                    <td data-label="Perfis">
                      {u.public_roles?.length
                        ? u.public_roles.map(publicRoleLabel).join(" • ")
                        : "Somente administrativo"}
                    </td>
                    <td data-label="Setores">
                      {u.sectors?.length ? u.sectors.join(", ") : "—"}
                    </td>
                    <td data-label="Status">
                      <span
                        className={
                          "admin-badge " +
                          (u.status === "active" ? "admin-badge--ok" : "")
                        }
                      >
                        {u.status === "deleted"
                          ? "Excluída"
                          : u.status === "pending"
                            ? "Em análise"
                            : u.status === "suspended"
                              ? "Suspensa"
                              : u.status !== "active"
                                ? "Bloqueado"
                                : u.email_confirmed === false
                                  ? "E-mail pendente"
                                  : "Ativo"}
                      </span>
                      {u.stored_status === "blocked" &&
                        u.block_ends_at &&
                        Date.parse(u.block_ends_at) > Date.now() && (
                          <small className="admin-table-sub">
                            {u.block_starts_at &&
                              new Date(u.block_starts_at).toLocaleString(
                                "pt-BR",
                              )}{" "}
                            até{" "}
                            {new Date(u.block_ends_at).toLocaleString("pt-BR")}
                          </small>
                        )}
                    </td>
                    {canGovernAccounts && (
                      <td data-label="Ações">
                        <div className="admin-button-row">
                          {["active", "blocked"].includes(u.status) && (
                            <button
                              className="admin-table-action"
                              disabled={busy === u.id}
                              onClick={() => {
                                if (
                                  u.status === "blocked" ||
                                  (u.stored_status === "blocked" &&
                                    u.block_starts_at &&
                                    Date.parse(u.block_starts_at) > Date.now())
                                )
                                  void changeStatus(u, true);
                                else {
                                  setDeleting(null);
                                  setSelected(u);
                                  window.scrollTo({
                                    top: 0,
                                    behavior: "instant",
                                  });
                                  setMode("indefinite");
                                  setStartsAt("");
                                  setEndsAt("");
                                }
                              }}
                            >
                              <UserCog size={15} />
                              {u.status === "blocked"
                                ? "Desbloquear"
                                : u.stored_status === "blocked" &&
                                    u.block_starts_at &&
                                    Date.parse(u.block_starts_at) > Date.now()
                                  ? "Cancelar bloqueio agendado"
                                  : "Bloquear"}
                            </button>
                          )}
                          {u.status !== "deleted" &&
                            u.role_code !== "platform_super_admin" && (
                              <button
                                className="admin-table-action admin-danger-text"
                                disabled={!!busy}
                                onClick={() => {
                                  setDeleting(u);
                                  setDeleteConfirmed(false);
                                  setSelected(null);
                                  window.scrollTo({
                                    top: 0,
                                    behavior: "instant",
                                  });
                                }}
                              >
                                <Trash2 size={15} />
                                Excluir conta
                              </button>
                            )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div></>
        )}
      </section>
    </section>
  );
}
