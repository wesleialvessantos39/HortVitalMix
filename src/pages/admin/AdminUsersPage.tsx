import { useEffect, useRef, useState } from "react";
import { RefreshCw, UserCog, UsersRound } from "lucide-react";
import { api } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";

type UserRow = {
  id: string;
  status: string;
  stored_status?:string; block_starts_at?:string; block_ends_at?:string;
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
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  const [selected,setSelected]=useState<UserRow|null>(null);
  const [mode,setMode]=useState("indefinite"),[startsAt,setStartsAt]=useState(""),[endsAt,setEndsAt]=useState("");
  const isSuper = access.role === "platform_super_admin";

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

  async function changeStatus(user: UserRow, unblock=false) {
    if (!isSuper) return;
    setBusy(user.id);
    setError("");
    const status = unblock ? "active" : "blocked";
    try {
      await api("/v1/admin/users/" + encodeURIComponent(user.id) + "/status", {
        method: "PATCH",
        body: JSON.stringify({ status, commandId: cryptoRandomUUID(), ...(unblock?{}:{mode,...(mode==="custom"?{startsAt:new Date(startsAt).toISOString(),endsAt:new Date(endsAt).toISOString()}:{})}) }),
      });
      setSelected(null);
      await load();
    } catch (err) {
      const e = err as { status?: number; message?: string };
      setError(
        e.status === 409
          ? "O último Super administrador ativo é protegido e não pode ser bloqueado."
          : e.status === 401
            ? "Entre novamente para confirmar esta operação."
            : "A alteração não pôde ser concluída.",
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
          Você visualiza consumidores, produtores e Administradores que
          compartilham seus setores. A gestão de Super administradores permanece
          no nível superior.
        </div>
      )}
      {error && <div className="admin-alert admin-alert--error">{error}</div>}
      {selected && <form className="admin-card" onSubmit={e=>{e.preventDefault();void changeStatus(selected);}}>
       <h2>Bloquear acesso de {selected.full_name}</h2>
       <label>Tipo de bloqueio<select value={mode} onChange={e=>setMode(e.target.value)}><option value="indefinite">Prazo indeterminado</option><option value="custom">Bloqueio personalizado</option></select></label>
       {mode==="custom" && <><p>Datas e horários no fuso deste aparelho ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Desbloqueio automático ao término.</p><label>Início<input type="datetime-local" required value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></label><label>Término<input type="datetime-local" required min={startsAt} value={endsAt} onChange={e=>setEndsAt(e.target.value)}/></label></>}
       <button className="admin-primary" disabled={!!busy}>Confirmar bloqueio</button><button type="button" className="admin-secondary" disabled={!!busy} onClick={()=>setSelected(null)}>Cancelar</button>
      </form>}
      <section className="admin-card admin-card--table">
        {refreshing && users.length === 0 ? (
          <p className="admin-empty" role="status">
            Carregando usuários…
          </p>
        ) : users.length === 0 ? (
          <p className="admin-empty">Nenhum usuário encontrado.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Tipo de conta</th>
                  <th>Perfis vinculados</th>
                  <th>Setores</th>
                  <th>Status</th>
                  {isSuper && <th>Ação</th>}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id + "-" + u.role_code}>
                    <td>
                      <strong>{u.full_name}</strong>
                      <small className="admin-table-sub">
                        {u.email_normalized}
                      </small>
                    </td>
                    <td>
                      {u.role_code === "platform_super_admin"
                        ? "Super administrador"
                        : u.role_code === "platform_admin"
                          ? "Administrador setorial"
                          : "Conta pública"}
                    </td>
                    <td>
                      {u.public_roles?.length
                        ? u.public_roles.map(publicRoleLabel).join(" • ")
                        : "Somente administrativo"}
                    </td>
                    <td>{u.sectors?.length ? u.sectors.join(", ") : "—"}</td>
                    <td>
                      <span
                        className={
                          "admin-badge " +
                          (u.status === "active" ? "admin-badge--ok" : "")
                        }
                      >
                        {u.status !== "active"
                          ? "Bloqueado"
                          : u.email_confirmed === false
                            ? "E-mail pendente"
                            : "Ativo"}
                      </span>
                      {u.stored_status==="blocked" && u.block_ends_at && Date.parse(u.block_ends_at)>Date.now() && <small className="admin-table-sub">{u.block_starts_at && new Date(u.block_starts_at).toLocaleString("pt-BR")} até {new Date(u.block_ends_at).toLocaleString("pt-BR")}</small>}
                    </td>
                    {isSuper && (
                      <td>
                          <button
                            className="admin-table-action"
                            disabled={busy === u.id}
                            onClick={() => { if(u.status==="blocked" || (u.stored_status==="blocked" && u.block_starts_at && Date.parse(u.block_starts_at)>Date.now())) void changeStatus(u,true); else {setSelected(u);setMode("indefinite");setStartsAt("");setEndsAt("");} }}
                          >
                            <UserCog size={15} />
                            {u.status === "blocked" ? "Desbloquear" : u.stored_status==="blocked" && u.block_starts_at && Date.parse(u.block_starts_at)>Date.now() ? "Cancelar bloqueio agendado" : "Bloquear"}
                          </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
