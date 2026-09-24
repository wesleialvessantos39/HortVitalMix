import { useEffect,useState } from "react";
import { RefreshCw,UserCog,UsersRound } from "lucide-react";
import { api } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";

type UserRow={
 id:string;
 status:string;
 full_name:string;
 email_normalized:string;
 role_code:"platform_admin"|"platform_super_admin";
 sectors:string[];
 public_roles:string[];
};
const publicRoleLabel=(role:string)=>role==="producer"?"Produtor":role==="consumer"?"Consumidor":role;

export function AdminUsersPage({access}:{access:AdminVerifySessionResponse}){
 const [users,setUsers]=useState<UserRow[]>([]);
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState("");
 const isSuper=access.role==="platform_super_admin";

 async function load(){
  setError("");
  try{const r=await api<{users:UserRow[]}>("/v1/admin/users");setUsers(r.users)}
  catch{setError("Não foi possível carregar os acessos administrativos.")}
 }
 useEffect(()=>{void load()},[]);

 async function changeStatus(user:UserRow){
  if(!isSuper)return;
  setBusy(user.id);setError("");
  const status=user.status==="active"?"blocked":"active";
  try{
   await api("/v1/admin/users/"+encodeURIComponent(user.id)+"/status",{method:"PATCH",body:JSON.stringify({status,commandId:cryptoRandomUUID()})});
   await load();
  }catch(err){
   const e=err as {status?:number;message?:string};
   setError(e.status===409?"O último Super administrador ativo é protegido e não pode ser bloqueado.":e.status===401?"Entre novamente para confirmar esta operação.":"A alteração não pôde ser concluída.");
  }finally{setBusy(null)}
 }

 return <section className="admin-page">
  <header className="admin-page-header">
   <div>
    <span className="admin-kicker"><UsersRound size={15}/> Segurança de acesso</span>
    <h1>Usuários administrativos</h1>
    <p>O cadastro pessoal é único, mas os perfis públicos e o acesso administrativo são exibidos separadamente.</p>
   </div>
   <button className="admin-secondary compact" onClick={()=>void load()}><RefreshCw size={16}/> Atualizar</button>
  </header>
  {!isSuper&&<div className="admin-alert">Você visualiza Administradores setoriais que compartilham ao menos um de seus setores. A gestão de Super administradores permanece no nível superior.</div>}
  {error&&<div className="admin-alert admin-alert--error">{error}</div>}
  <section className="admin-card admin-card--table">
   {users.length===0?<p className="admin-empty">Nenhum usuário administrativo encontrado.</p>:<div className="admin-table-wrap"><table className="admin-table">
    <thead><tr><th>Usuário</th><th>Acesso administrativo</th><th>Perfis vinculados</th><th>Setores</th><th>Status</th>{isSuper&&<th>Ação</th>}</tr></thead>
    <tbody>{users.map(u=><tr key={u.id+"-"+u.role_code}>
     <td><strong>{u.full_name}</strong><small className="admin-table-sub">{u.email_normalized}</small></td>
     <td>{u.role_code==="platform_super_admin"?"Super administrador":"Administrador setorial"}</td>
     <td>{u.public_roles?.length?u.public_roles.map(publicRoleLabel).join(" • "):"Somente administrativo"}</td>
     <td>{u.sectors?.length?u.sectors.join(", "):"—"}</td>
     <td><span className={"admin-badge "+(u.status==="active"?"admin-badge--ok":"")}>{u.status==="active"?"Ativo":"Bloqueado"}</span></td>
     {isSuper&&<td><button className="admin-table-action" disabled={busy===u.id} onClick={()=>void changeStatus(u)}><UserCog size={15}/>{u.status==="active"?"Bloquear":"Reativar"}</button></td>}
    </tr>)}</tbody>
   </table></div>}
  </section>
 </section>
}
