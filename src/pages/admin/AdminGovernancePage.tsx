import { useEffect,useRef,useState } from "react";
import { MailPlus,RefreshCw,ShieldCheck,UsersRound } from "lucide-react";
import { api } from "../../lib/api";
import { CPFInput } from "../../components/forms/CPFInput";
import { cryptoRandomUUID } from "../../lib/uuid";
import type {
  AdminVerifySessionResponse,
  InviteResponse,
} from "../../../shared/contracts/adminGovernance";

type Props={
 onNavigate:(to:string)=>void;
 access:AdminVerifySessionResponse;
};
type Sector={code:string;name:string;description:string};
type IdentityLookup={
 found:boolean;
 identity?:{
  fullName:string;
  cpf:string;
  publicEmail:string;
  status:string;
  publicRoles:string[];
  adminRoles:Array<"platform_admin"|"platform_super_admin">;
 };
};
const roleLabels={platform_admin:"Administrador setorial",platform_super_admin:"Super administrador"} as const;
const publicRoleLabel=(role:string)=>role==="producer"?"Produtor":role==="consumer"?"Consumidor":role;
const adminRoleLabel=(role:string)=>role==="platform_super_admin"?"Super administrador":"Administrador setorial";

export function AdminGovernancePage({onNavigate,access}:Props){
 const isSuper=access.role==="platform_super_admin";
 const [sectors,setSectors]=useState<Sector[]>([]);
 const [invites,setInvites]=useState<InviteResponse[]>([]);
 const [email,setEmail]=useState("");
 const [targetCpf,setTargetCpf]=useState("");
 const [targetRole,setTargetRole]=useState<"platform_admin"|"platform_super_admin">("platform_admin");
 const [selected,setSelected]=useState<string[]>([]);
 const [identity,setIdentity]=useState<IdentityLookup|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");

 const refreshInFlight = useRef(false);
 const [syncError,setSyncError]=useState("");
 async function load(){
  setError("");
  try{
   const [s,i]=await Promise.all([
    api<{sectors:Sector[]}>("/v1/admin/sectors"),
    api<{invites:InviteResponse[]}>("/v1/admin/invites"),
   ]);
   setSectors(s.sectors);setInvites(i.invites);
  }catch{setError("Não foi possível carregar a governança administrativa.")}
 }
 useEffect(()=>{void load()},[]);
 const hasPending = invites.some(i=>!i.isAccepted&&!i.invalidatedAt&&new Date(i.expiresAt).getTime()>Date.now());
 useEffect(()=>{
  if(!hasPending) return;
  const abort = new AbortController();
  async function sync(){
   if(document.visibilityState!=="visible"||refreshInFlight.current) return;
   refreshInFlight.current=true;
   try {
    const result=await api<{invites:InviteResponse[]}>("/v1/admin/invites",{signal:abort.signal});
    if(!abort.signal.aborted){setInvites(result.invites);setSyncError("");}
   } catch {
    if(!abort.signal.aborted)setSyncError("A atualização automática está indisponível. Tente atualizar novamente.");
   } finally {refreshInFlight.current=false;}
  }
  const timer=window.setInterval(()=>void sync(),3000);
  document.addEventListener("visibilitychange",sync);
  return ()=>{abort.abort();clearInterval(timer);document.removeEventListener("visibilitychange",sync);};
 },[hasPending]);

 async function lookupIdentity(){
  const cpf=targetCpf.replace(/\D/g,"");
  setIdentity(null);
  if(cpf.length!==11) return;
  try{
   const result=await api<IdentityLookup>("/v1/admin/identities/lookup?cpf="+encodeURIComponent(cpf));
   setIdentity(result);
  }catch{
   setIdentity(null);
  }
 }

 function toggle(code:string){setSelected(v=>v.includes(code)?v.filter(x=>x!==code):[...v,code])}
 async function createInvite(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError("");setSuccess("");
  try{
   const result=await api<{status:string;invite?:InviteResponse}>("/v1/admin/invites",{
    method:"POST",
    body:JSON.stringify({
     email,
     targetCpf:targetCpf.replace(/\D/g,"")||undefined,
     targetRole,
     sectors:targetRole==="platform_admin"?selected:[],
     commandId:cryptoRandomUUID(),
    }),
   });
   if(result.status==="created"&&result.invite){
    setSuccess(
     result.invite.identityMode==="existing"
      ? "Convite enviado. O cadastro existente será preservado e receberá apenas o novo acesso administrativo."
      : "Convite enviado. O novo acesso administrativo poderá ser ativado pelo link recebido."
    );
    setEmail("");setTargetCpf("");setSelected([]);setIdentity(null);setTargetRole("platform_admin");
    const created=result.invite;
    setInvites(current=>[created,...current.filter(i=>i.id!==created.id)]);
   }
  }catch(err){
   const status=(err as {status?:number}).status;
   setError(
    status===401
     ? "Entre novamente para confirmar esta operação."
     : status===403
       ? "Seu nível de acesso não permite criar esse tipo de administrador."
       : status===409
         ? "Já existe acesso ou convite pendente para este mesmo papel administrativo."
         : "Não foi possível emitir o convite."
   );
  }finally{setBusy(false)}
 }

 return <section className="admin-page">
  <header className="admin-page-header">
   <div>
    <span className="admin-kicker"><ShieldCheck size={15}/> Governança</span>
    <h1>Convites administrativos</h1>
    <p>Crie novos acessos sem duplicar CPF ou cadastro pessoal. Perfis de Consumidor e Produtor permanecem separados do acesso administrativo.</p>
   </div>
   <button className="admin-secondary compact" onClick={()=>void load()}><RefreshCw size={16}/> Atualizar</button>
  </header>

  <div className="admin-alert">
   {isSuper
    ? "Hierarquia: você pode convidar Administradores setoriais e outros Super administradores."
    : "Hierarquia: você pode convidar somente Administradores setoriais e apenas para setores aos quais já possui acesso."}
  </div>

  <div className="admin-governance-grid">
   <section className="admin-card">
    <h2><MailPlus size={19}/> Novo acesso administrativo</h2>
    <p className="admin-muted">Informe o CPF para reaproveitar a mesma pessoa. Administrador e Super administrador podem usar o mesmo Gmail visível, mas cada portal mantém sua própria senha e seu próprio nível de acesso.</p>
    {error&&<div className="admin-alert admin-alert--error">{error}</div>}
    {success&&<div className="admin-alert admin-alert--success">{success}</div>}
    <form onSubmit={createInvite} className="admin-form">
     <CPFInput
      label="CPF já cadastrado (opcional)"
      required={false}
      value={targetCpf}
      onChange={value=>{setTargetCpf(value);setIdentity(null)}}
     />
     {targetCpf.replace(/\D/g,"").length===11&&<button type="button" className="admin-secondary compact" onClick={()=>void lookupIdentity()}>Localizar cadastro</button>}

     {identity?.found&&identity.identity&&<div className="admin-alert admin-alert--success">
      <strong><UsersRound size={15}/> Cadastro existente localizado.</strong>
      <div>{identity.identity.fullName}</div>
      <small>
       Perfis públicos: {identity.identity.publicRoles.length
        ? identity.identity.publicRoles.map(publicRoleLabel).join(" • ")
        : "nenhum"}.
       {" "}Esses perfis serão preservados.
       {identity.identity.adminRoles.length
        ? " Acessos administrativos existentes: " + identity.identity.adminRoles.map(adminRoleLabel).join(" • ") + "."
        : ""}
      </small>
     </div>}

     <label>E-mail administrativo
      <input
       type="email"
       value={email}
       onChange={e=>setEmail(e.target.value)}
       required
      />
     </label>

     <label>Papel
      <select
       value={targetRole}
       onChange={e=>{
        const role=e.target.value as typeof targetRole;
        setTargetRole(role);
        if(role==="platform_super_admin")setSelected([]);
       }}
      >
       <option value="platform_admin">Administrador setorial</option>
       {isSuper&&<option value="platform_super_admin">Super administrador</option>}
      </select>
     </label>

     {targetRole==="platform_admin"&&<fieldset className="admin-sectors-fieldset">
      <legend>Setores obrigatórios</legend>
      {sectors.map(s=><label key={s.code} className="admin-sector-checkbox">
       <input type="checkbox" checked={selected.includes(s.code)} onChange={()=>toggle(s.code)}/>
       <span><strong>{s.name}</strong><small>{s.description}</small></span>
      </label>)}
     </fieldset>}

     <button className="admin-primary" disabled={busy||(targetRole==="platform_admin"&&selected.length===0)}>
      {busy?"Enviando…":"Enviar convite"}
     </button>
    </form>
   </section>

   <section className="admin-card admin-card--table">
    <div className="admin-card-heading"><div><h2>Histórico de convites</h2><p className="admin-muted">{isSuper?"Todos os convites administrativos.":"Somente convites emitidos por você."}</p></div></div>
    {hasPending&&<p className="admin-muted" role="status">Acompanhando a aceitação dos convites automaticamente.</p>}
    {syncError&&<p role="status" className="admin-muted">{syncError}</p>}
    {invites.length===0?<p className="admin-empty">Nenhum convite emitido.</p>:<div className="admin-table-wrap"><table className="admin-table">
     <thead><tr><th>E-mail</th><th>Papel</th><th>Origem</th><th>Setores</th><th>Status</th><th>Expira</th></tr></thead>
     <tbody>{invites.map(i=>{
      const expired=new Date(i.expiresAt).getTime()<Date.now();
      const label=i.isAccepted?"Aceito":i.invalidatedAt?"Invalidado":expired?"Expirado":"Pendente";
      return <tr key={i.id}>
       <td>{i.email}</td>
       <td>{roleLabels[i.targetRole]}</td>
       <td>{i.identityMode==="existing"?"Cadastro existente":"Novo cadastro"}</td>
       <td>{i.sectors.length?i.sectors.join(", "):"—"}</td>
       <td><span className={"admin-badge "+(i.isAccepted?"admin-badge--ok":label==="Pendente"?"admin-badge--pending":"")}>{label}</span></td>
       <td>{new Date(i.expiresAt).toLocaleString("pt-BR")}</td>
      </tr>
     })}</tbody>
    </table></div>}
   </section>
  </div>
  <button className="admin-link" onClick={()=>onNavigate("/admin/painel")}>Voltar ao painel</button>
 </section>
}
