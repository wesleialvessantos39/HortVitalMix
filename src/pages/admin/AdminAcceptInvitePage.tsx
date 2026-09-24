import { useEffect,useMemo,useState } from "react";
import { Leaf,UserCheck } from "lucide-react";
import { api } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import { PasswordInput } from "../../components/forms/PasswordInput";
import { PasswordStrengthMeter } from "../../components/forms/PasswordStrengthMeter";
import { CPFInput } from "../../components/forms/CPFInput";
import { PhoneInput } from "../../components/forms/PhoneInput";

type Props={onNavigate:(to:string)=>void};
type InviteState={
 status:string;
 email?:string;
 targetRole?:string;
 identityMode?:"new"|"existing";
 existingRoles?:Array<"consumer"|"producer">;
 sectors?:string[];
 expiresAt?:string;
};
const publicRoleLabel=(role:string)=>role==="producer"?"Produtor":role==="consumer"?"Consumidor":role;

export function AdminAcceptInvitePage({onNavigate}:Props){
 const token=useMemo(()=>new URLSearchParams(location.search).get("token")??"",[]);
 const [state,setState]=useState<InviteState>({status:"loading"});
 const [form,setForm]=useState({fullName:"",cpf:"",phone:"",password:""});
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");

 useEffect(()=>{
  if(!token){setState({status:"invalid"});return}
  api<InviteState>("/v1/admin/invites/validate?token="+encodeURIComponent(token))
   .then(setState)
   .catch(()=>setState({status:"invalid"}));
 },[token]);

 async function submit(e:React.FormEvent){
  e.preventDefault();setBusy(true);setMessage("");
  try{
   const payload=state.identityMode==="existing"
    ? {cpf:form.cpf,password:form.password,token,commandId:cryptoRandomUUID()}
    : {...form,token,commandId:cryptoRandomUUID()};
   const result=await api<{status:string}>("/v1/admin/invites/accept",{
    method:"POST",
    body:JSON.stringify(payload),
   });
   if(result.status==="accepted"){
    setMessage(
     state.identityMode==="existing"
      ? "Acesso administrativo criado. Seus perfis de Consumidor ou Produtor continuam preservados e usam o cadastro público normalmente."
      : "Convite aceito. Seu acesso administrativo está pronto."
    );
    setTimeout(()=>onNavigate("/admin/entrar"),900);
   }
  }catch(err){
   const status=(err as {status?:number}).status;
   setMessage(
    status===409
     ? "Cadastro não autorizado. Confirme o CPF vinculado a este convite."
     : status===422
       ? "Revise os dados informados."
       : "Não foi possível concluir o convite. Tente novamente."
   );
  }finally{setBusy(false)}
 }

 const valid=state.status==="valid";
 const existing=valid&&state.identityMode==="existing";

 return <section className="admin-login-page">
  <header className="admin-login-header">
   <button className="admin-back" onClick={()=>onNavigate("/")}>← Voltar ao site</button>
   <div className="admin-login-brand"><span className="admin-brand-mark"><Leaf/></span><strong>Horti<span>Vital</span>Mix</strong></div>
  </header>
  <div className="admin-bootstrap-wrap"><div className="admin-login-card admin-login-card--wide">
   <div className="admin-login-icon"><UserCheck/></div><span className="admin-kicker">Convite administrativo</span>
   {state.status==="loading"&&<p className="admin-muted">Validando convite…</p>}
   {state.status!=="loading"&&!valid&&<>
    <h1>Este convite não está disponível</h1>
    <p className="admin-muted">O link pode ter expirado, sido invalidado ou já utilizado.</p>
    <button className="admin-secondary" onClick={()=>onNavigate("/admin/entrar")}>Ir para o acesso administrativo</button>
   </>}
   {valid&&<>
    <h1>{existing?"Ative o acesso administrativo":"Conclua seu cadastro"}</h1>
    <p className="admin-muted">{state.email} · {state.targetRole==="platform_super_admin"?"Super administrador":"Administrador setorial"}</p>
    {(state.sectors?.length??0)>0&&<div className="admin-chip-row">{state.sectors!.map(s=><span key={s}>{s}</span>)}</div>}
    {existing&&<div className="admin-alert admin-alert--success">
     Este CPF já possui cadastro no HortiVitalMix.
     {(state.existingRoles?.length??0)>0&&<> Perfis preservados: {state.existingRoles!.map(publicRoleLabel).join(" • ")}.</>}
     {" "}O convite criará uma credencial administrativa separada e não altera o login público.
    </div>}
    {message&&<div className="admin-alert">{message}</div>}
    <form onSubmit={submit} className="admin-form-grid">
     {!existing&&<label>Nome completo
      <input value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})} required minLength={3}/>
     </label>}

     <CPFInput value={form.cpf} onChange={value=>setForm({...form,cpf:value})}/>

     {!existing&&<PhoneInput value={form.phone} onChange={value=>setForm({...form,phone:value})}/>}

     <label className="admin-span-2">Crie a senha do acesso administrativo
      <PasswordInput value={form.password} onChange={value=>setForm({...form,password:value})} autoComplete="new-password"/>
      <PasswordStrengthMeter value={form.password}/>
     </label>

     <button className="admin-primary admin-span-2" disabled={busy}>
      {busy?"Ativando…":existing?"Adicionar acesso administrativo":"Aceitar convite e ativar acesso"}
     </button>
    </form>
   </>}
  </div></div>
 </section>
}
