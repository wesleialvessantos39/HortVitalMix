import { useState } from "react";

export function PasswordInput({ name="password", label="Senha", value, onChange, autoComplete="current-password", error }:{
  name?:string; label?:string; value:string; onChange:(value:string)=>void; autoComplete?:string; error?:string;
}) {
  const [visible,setVisible]=useState(false);
  return <label>{label}<div className="password-input"><input name={name} type={visible?"text":"password"} autoComplete={autoComplete}
    value={value} aria-invalid={Boolean(error)} onChange={(event)=>onChange(event.currentTarget.value)} required />
    <button type="button" className="password-visibility" aria-label={visible?"Ocultar senha":"Mostrar senha"}
      onClick={()=>setVisible((current)=>!current)}>{visible?"Ocultar":"Mostrar"}</button>
  </div>{error&&<small className="field-error" role="alert">{error}</small>}</label>;
}
