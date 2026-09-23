import { useEffect,useState } from "react";
import { Leaf,ShieldPlus } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import { PasswordInput } from "../../components/forms/PasswordInput";
import { PasswordStrengthMeter } from "../../components/forms/PasswordStrengthMeter";
import { CPFInput } from "../../components/forms/CPFInput";
import { PhoneInput } from "../../components/forms/PhoneInput";
import { BootstrapRequestSchema } from "../../../shared/contracts/adminGovernance";

type Props={onNavigate:(to:string)=>void};
type FieldErrors=Record<string,string>;

export function AdminBootstrapPage({onNavigate}:Props){
 const [status,setStatus]=useState<"loading"|"open"|"closed"|"disabled">("loading");
 const [reason,setReason]=useState<string|null>(null);
 const [form,setForm]=useState({fullName:"",cpf:"",email:"",phone:"",password:""});
 const [fieldErrors,setFieldErrors]=useState<FieldErrors>({});
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");

 async function refreshBootstrapStatus(){
  try{
   const result=await api<{
    status:"open"|"closed"|"disabled";
    reason:string|null;
    authorizedEmailHint?:string|null;
   }>("/v1/admin/bootstrap/status");
   setStatus(result.status);
   setReason(result.reason);
   return result;
  }catch{
   const result={
    status:"disabled" as const,
    reason:"Não foi possível consultar o bootstrap neste ambiente.",
    authorizedEmailHint:null as string|null,
   };
   setStatus(result.status);
   setReason(result.reason);
   return result;
  }
 }

 useEffect(()=>{
  void refreshBootstrapStatus();
 },[]);

 function setField<K extends keyof typeof form>(field:K,value:string){
  setForm(current=>({...current,[field]:value}));
  setFieldErrors(current=>{
   if(!current[field]) return current;
   const next={...current};
   delete next[field];
   return next;
  });
  if(message) setMessage("");
 }

 async function submit(e:React.FormEvent){
  e.preventDefault();
  setMessage("");
  setFieldErrors({});

  const commandId=cryptoRandomUUID();
  const parsed=BootstrapRequestSchema.safeParse({...form,commandId});
  if(!parsed.success){
   const errors:FieldErrors={};
   for(const issue of parsed.error.issues){
    const field=String(issue.path[0]??"");
    if(field && !errors[field]) errors[field]=issue.message;
   }
   setFieldErrors(errors);
   setMessage("Revise os campos destacados antes de continuar.");
   return;
  }

  setBusy(true);
  try{
   const result=await api<{status:string}>("/v1/admin/bootstrap",{
    method:"POST",
    body:JSON.stringify(parsed.data),
   });
   if(result.status==="completed"){
    setMessage("Configuração inicial concluída.");
    setTimeout(()=>onNavigate("/admin/entrar"),800);
   }
  }catch(caught){
   const failure=caught as ApiFailure;
   if(failure.status===403){
    const current=await refreshBootstrapStatus();
    if(current.status==="disabled"){
     setMessage(current.reason??"Bootstrap desabilitado neste ambiente.");
    }else if(current.status==="closed"){
     setMessage(current.reason??"O bootstrap já foi concluído.");
    }else{
     setFieldErrors({email:"Use exatamente o e-mail autorizado para o primeiro Super administrador."});
     setMessage("O e-mail informado não foi reconhecido como o e-mail autorizado deste ambiente.");
    }
   }else if(failure.status===409){
    setMessage("Já existe uma identidade usando este e-mail ou CPF. Use dados ainda não vinculados.");
   }else if(failure.status===422){
    setMessage("Revise os campos destacados antes de continuar.");
   }else if(failure.status===503){
    setMessage("O backend não conseguiu acessar uma dependência obrigatória. Verifique Supabase, banco e secrets deste ambiente.");
   }else{
    setMessage("Não foi possível concluir a configuração inicial. Tente novamente após atualizar o ambiente.");
   }
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

    {status==="open"&&<form onSubmit={submit} className="admin-form-grid" noValidate>
     <label>Nome completo
      <input
       value={form.fullName}
       onChange={e=>setField("fullName",e.target.value)}
       required
       minLength={3}
       maxLength={255}
       aria-invalid={Boolean(fieldErrors.fullName)}
      />
      {fieldErrors.fullName&&<small className="field-error" role="alert">{fieldErrors.fullName}</small>}
     </label>

     <CPFInput
      value={form.cpf}
      onChange={value=>setField("cpf",value)}
      error={fieldErrors.cpf}
     />

     <label>E-mail autorizado
      <input
       type="email"
       value={form.email}
       onChange={e=>setField("email",e.target.value)}
       required
       maxLength={255}
       autoComplete="email"
       aria-invalid={Boolean(fieldErrors.email)}
      />
      {fieldErrors.email&&<small className="field-error" role="alert">{fieldErrors.email}</small>}
     </label>

     <PhoneInput
      value={form.phone}
      onChange={value=>setField("phone",value)}
      error={fieldErrors.phone}
     />

     <label className="admin-span-2">Senha forte
      <PasswordInput
       value={form.password}
       onChange={value=>setField("password",value)}
       autoComplete="new-password"
      />
      <PasswordStrengthMeter value={form.password}/>
      {fieldErrors.password&&<small className="field-error" role="alert">{fieldErrors.password}</small>}
     </label>

     <button className="admin-primary admin-span-2" disabled={busy}>
      {busy?"Salvando…":"Concluir configuração inicial"}
     </button>
    </form>}
   </div>
  </div>
 </section>
}
