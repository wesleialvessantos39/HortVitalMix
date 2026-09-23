import { useEffect,useMemo,useState } from "react";
import { Leaf,UserCheck } from "lucide-react";
import { api } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import { PasswordInput } from "../../components/forms/PasswordInput";
import { PasswordStrengthMeter } from "../../components/forms/PasswordStrengthMeter";
type Props={onNavigate:(to:string)=>void};
type InviteState={status:string;email?:string;targetRole?:string;sectors?:string[];expiresAt?:string};
export function AdminAcceptInvitePage({onNavigate}:Props){
 const token=useMemo(()=>new URLSearchParams(location.search).get("token")??"",[]);
 const [state,setState]=useState<InviteState>({status:"loading"});
 const [form,setForm]=useState({fullName:"",cpf:"",phone:"",password:""});
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{
  if(!token){setState({status:"invalid"});return}
  api<InviteState>("/v1/admin/invites/validate?token="+encodeURIComponent(token)).then(setState).catch(()=>setState({status:"invalid"}));
 },[token]);
 async function submit(e:React.FormEvent){
  e.preventDefault();setBusy(true);setMessage("");
  try{
   const result=await api<{status:string}>("/v1/admin/invites/accept",{method:"POST",body:JSON.stringify({...form,token,commandId:cryptoRandomUUID()})});
   if(result.status==="accepted"){setMessage("Convite aceito. Seu acesso administrativo está pronto.");setTimeout(()=>onNavigate("/admin/entrar"),900)}
  }catch{setMessage("Não foi possível concluir o convite. Ele pode ter expirado ou já ter sido utilizado.")}
  finally{setBusy(false)}
 }
 const valid=state.status==="valid";
 return <section className="admin-login-page">
  <header className="admin-login-header"><button className="admin-back" onClick={()=>onNavigate("/")}>← Voltar ao site</button><div className="admin-login-brand"><span className="admin-brand-mark"><Leaf/></span><strong>Horti<span>Vital</span>Mix</strong></div></header>
  <div className="admin-bootstrap-wrap"><div className="admin-login-card admin-login-card--wide">
   <div className="admin-login-icon"><UserCheck/></div><span className="admin-kicker">Convite administrativo</span>
   {state.status==="loading"&&<p className="admin-muted">Validando convite…</p>}
   {state.status!=="loading"&&!valid&&<><h1>Este convite não está disponível</h1><p className="admin-muted">O link pode ter expirado, sido invalidado ou já utilizado.</p><button className="admin-secondary" onClick={()=>onNavigate("/admin/entrar")}>Ir para o acesso administrativo</button></>}
   {valid&&<><h1>Conclua seu cadastro</h1><p className="admin-muted">{state.email} · {state.targetRole==="platform_super_admin"?"Super administrador":"Administrador setorial"}</p>
    {(state.sectors?.length??0)>0&&<div className="admin-chip-row">{state.sectors!.map(s=><span key={s}>{s}</span>)}</div>}
    {message&&<div className="admin-alert">{message}</div>}
    <form onSubmit={submit} className="admin-form-grid">
     <label>Nome completo<input value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})} required minLength={3}/></label>
     <label>CPF<input inputMode="numeric" value={form.cpf} onChange={e=>setForm({...form,cpf:e.target.value})} required/></label>
     <label>Celular<input placeholder="(00) 00000-0000" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} required/></label>
     <label className="admin-span-2">Crie sua senha<PasswordInput value={form.password} onChange={value=>setForm({...form,password:value})} autoComplete="new-password"/><PasswordStrengthMeter value={form.password}/></label>
     <button className="admin-primary admin-span-2" disabled={busy}>{busy?"Ativando…":"Aceitar convite e ativar acesso"}</button>
    </form>
   </>}
  </div></div>
 </section>
}
