import { useEffect,useState } from "react";
import { Leaf,ShieldPlus } from "lucide-react";
import { api } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import { PasswordInput } from "../../components/forms/PasswordInput";
import { PasswordStrengthMeter } from "../../components/forms/PasswordStrengthMeter";

type Props={onNavigate:(to:string)=>void};
export function AdminBootstrapPage({onNavigate}:Props){
 const [status,setStatus]=useState<"loading"|"open"|"closed"|"disabled">("loading");
 const [reason,setReason]=useState<string|null>(null);
 const [form,setForm]=useState({fullName:"",cpf:"",email:"",phone:"",password:""});
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 useEffect(()=>{
  api<{status:"open"|"closed"|"disabled";reason:string|null}>("/v1/admin/bootstrap/status")
   .then(r=>{setStatus(r.status);setReason(r.reason)})
   .catch(()=>{setStatus("disabled");setReason("Não foi possível consultar o bootstrap.")});
 },[]);
 async function submit(e:React.FormEvent){
  e.preventDefault();setBusy(true);setMessage("");
  try{
   const result=await api<{status:string}>("/v1/admin/bootstrap",{
    method:"POST",
    body:JSON.stringify({...form,commandId:cryptoRandomUUID()}),
   });
   if(result.status==="completed"){
    setMessage("Configuração inicial concluída.");
    setTimeout(()=>onNavigate("/admin/entrar"),800);
   }
  }catch{
   setMessage("Não foi possível concluir a configuração inicial. Verifique o e-mail autorizado e os dados informados.");
  }finally{setBusy(false)}
 }
 return <section className="admin-login-page">
  <header className="admin-login-header">
   <button className="admin-back" onClick={()=>onNavigate("/admin/entrar")}>← Acesso administrativo</button>
   <div className="admin-login-brand"><span className="admin-brand-mark"><Leaf/></span><strong>Horti<span>Vital</span>Mix</strong></div>
  </header>
  <div className="admin-bootstrap-wrap">
   <div className="admin-login-card admin-login-card--wide">
    <div className="admin-login-icon"><ShieldPlus/></div>
    <span className="admin-kicker">Configuração protegida</span>
    <h1>Primeiro acesso administrativo</h1>
    <p className="admin-muted">Esta etapa abre somente enquanto ainda não existe um Super administrador ativo e aceita apenas o e-mail autorizado no servidor.</p>
    {status==="loading"&&<p className="admin-muted">Consultando disponibilidade…</p>}
    {status!=="loading"&&status!=="open"&&<div className="admin-alert">{reason??"Configuração inicial indisponível."}</div>}
    {message&&<div className="admin-alert">{message}</div>}
    {status==="open"&&<form onSubmit={submit} className="admin-form-grid">
     <label>Nome completo<input value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})} required minLength={3}/></label>
     <label>CPF<input inputMode="numeric" value={form.cpf} onChange={e=>setForm({...form,cpf:e.target.value})} required/></label>
     <label>E-mail autorizado<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required/></label>
     <label>Celular<input placeholder="(00) 00000-0000" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} required/></label>
     <label className="admin-span-2">Senha forte
      <PasswordInput value={form.password} onChange={value=>setForm({...form,password:value})} autoComplete="new-password"/>
      <PasswordStrengthMeter value={form.password}/>
     </label>
     <button className="admin-primary admin-span-2" disabled={busy}>{busy?"Salvando…":"Concluir configuração inicial"}</button>
    </form>}
   </div>
  </div>
 </section>
}
