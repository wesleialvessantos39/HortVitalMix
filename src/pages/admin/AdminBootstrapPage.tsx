import { useEffect,useState } from "react";
import { Leaf,ShieldPlus } from "lucide-react";
import { api } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
type Props={onNavigate:(to:string)=>void};
export function AdminBootstrapPage({onNavigate}:Props){
 const [status,setStatus]=useState("loading");
 useEffect(()=>{api<{status:string}>("/v1/admin/bootstrap/status").then(r=>setStatus(r.status)).catch(()=>setStatus("disabled"))},[]);
 return <section className="admin-login-page"><header className="admin-login-header"><button className="admin-back" onClick={()=>onNavigate("/admin/entrar")}>← Acesso administrativo</button><div className="admin-login-brand"><span className="admin-brand-mark"><Leaf/></span><strong>Horti<span>Vital</span>Mix</strong></div></header><div className="admin-bootstrap-wrap"><div className="admin-login-card admin-login-card--wide"><div className="admin-login-icon"><ShieldPlus/></div><h1>Configuração inicial da administração</h1><p className="admin-muted">Status: {status}</p><button className="admin-primary" onClick={()=>onNavigate("/admin/entrar")}>Voltar ao acesso</button><input type="hidden" value={cryptoRandomUUID()} readOnly/></div></div></section>
}
