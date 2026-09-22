import { useEffect,useState } from "react";
import { MailPlus,RefreshCw,ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import type { InviteResponse } from "../../../shared/contracts/adminGovernance";

type Props={onNavigate:(to:string)=>void};
type Sector={code:string;name:string;description:string};
const roleLabels={platform_admin:"Administrador setorial",platform_super_admin:"Super administrador"} as const;

export function AdminGovernancePage({onNavigate}:Props){
 const [sectors,setSectors]=useState<Sector[]>([]);
 const [invites,setInvites]=useState<InviteResponse[]>([]);
 const [email,setEmail]=useState("");
 const [targetRole,setTargetRole]=useState<"platform_admin"|"platform_super_admin">("platform_admin");
 const [selected,setSelected]=useState<string[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");

 async function load(){
  try{
   const [s,i]=await Promise.all([
    api<{sectors:Sector[]}>("/v1/admin/sectors"),
    api<{invites:InviteResponse[]}>("/v1/admin/invites"),
   ]);
   setSectors(s.sectors);setInvites(i.invites);
  }catch{setError("Não foi possível carregar a governança administrativa.")}
 }
 useEffect(()=>{void load()},[]);

 function toggle(code:string){setSelected(v=>v.includes(code)?v.filter(x=>x!==code):[...v,code])}
 async function createInvite(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError("");setSuccess("");
  try{
   const result=await api<{status:string;invite?:InviteResponse}>("/v1/admin/invites",{
    method:"POST",
    body:JSON.stringify({email,targetRole,sectors:targetRole==="platform_admin"?selected:[],commandId:cryptoRandomUUID()}),
   });
   if(result.status==="created"){
    setSuccess("Convite enviado pelo Supabase Auth com validade de 24 horas.");
    setEmail("");setSelected([]);await load();
   }
  }catch(err){
   const status=(err as {status?:number}).status;
   setError(status===401?"Autenticação recente requerida. Saia e entre novamente antes de emitir um convite.":status===409?"Já existe identidade ou convite ativo para este e-mail.":"Não foi possível emitir o convite.");
  }finally{setBusy(false)}
 }
 return <section className="admin-page">
  <header className="admin-page-header"><div><span className="admin-kicker"><ShieldCheck size={15}/> Governança</span><h1>Convites administrativos</h1><p>Crie acessos por convite, com papel e setores definidos antes da ativação.</p></div><button className="admin-secondary compact" onClick={()=>void load()}><RefreshCw size={16}/> Atualizar</button></header>
  <div className="admin-governance-grid">
   <section className="admin-card">
    <h2><MailPlus size={19}/> Novo convite</h2>
    <p className="admin-muted">O link expira em 24 horas. Super administrador não recebe setores.</p>
    {error&&<div className="admin-alert admin-alert--error">{error}</div>}
    {success&&<div className="admin-alert admin-alert--success">{success}</div>}
    <form onSubmit={createInvite} className="admin-form">
     <label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
     <label>Papel<select value={targetRole} onChange={e=>{const role=e.target.value as typeof targetRole;setTargetRole(role);if(role==="platform_super_admin")setSelected([])}}>
      <option value="platform_admin">Administrador setorial</option><option value="platform_super_admin">Super administrador</option>
     </select></label>
     {targetRole==="platform_admin"&&<fieldset className="admin-sectors-fieldset"><legend>Setores obrigatórios</legend>{sectors.map(s=><label key={s.code} className="admin-sector-checkbox"><input type="checkbox" checked={selected.includes(s.code)} onChange={()=>toggle(s.code)}/><span><strong>{s.name}</strong><small>{s.description}</small></span></label>)}</fieldset>}
     <button className="admin-primary" disabled={busy||(targetRole==="platform_admin"&&selected.length===0)}>{busy?"Enviando…":"Enviar convite"}</button>
    </form>
   </section>
   <section className="admin-card admin-card--table">
    <div className="admin-card-heading"><div><h2>Histórico de convites</h2><p className="admin-muted">Tokens nunca são armazenados em texto puro.</p></div></div>
    {invites.length===0?<p className="admin-empty">Nenhum convite emitido.</p>:<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>E-mail</th><th>Papel</th><th>Setores</th><th>Status</th><th>Expira</th></tr></thead><tbody>{invites.map(i=>{
     const expired=new Date(i.expiresAt).getTime()<Date.now();
     const label=i.isAccepted?"Aceito":i.invalidatedAt?"Invalidado":expired?"Expirado":"Pendente";
     return <tr key={i.id}><td>{i.email}</td><td>{roleLabels[i.targetRole]}</td><td>{i.sectors.length?i.sectors.join(", "):"—"}</td><td><span className={"admin-badge "+(i.isAccepted?"admin-badge--ok":label==="Pendente"?"admin-badge--pending":"")}>{label}</span></td><td>{new Date(i.expiresAt).toLocaleString("pt-BR")}</td></tr>
    })}</tbody></table></div>}
   </section>
  </div>
  <button className="admin-link" onClick={()=>onNavigate("/admin/painel")}>Voltar ao painel</button>
 </section>
}
