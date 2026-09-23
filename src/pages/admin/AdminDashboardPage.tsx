import { ShieldCheck, UsersRound, Settings, LayoutDashboard } from "lucide-react";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";

type Props={access:AdminVerifySessionResponse;onNavigate:(to:string)=>void};
export function AdminDashboardPage({access,onNavigate}:Props){
 const superAdmin=access.role==="platform_super_admin";
 return <section className="admin-page">
  <header className="admin-page-header">
   <div><span className="admin-kicker"><LayoutDashboard size={15}/> Volume 01 · Trilha 05</span><h1>Painel administrativo</h1><p>Governança, escopos e segurança operacional do HortiVitalMix.</p></div>
   <span className="admin-role-pill">{superAdmin?"Super administrador":"Administrador setorial"}</span>
  </header>
  <div className="admin-stat-grid">
   <article className="admin-stat-card"><ShieldCheck/><div><strong>{superAdmin?"Acesso global":"Acesso setorial"}</strong><span>{superAdmin?"Governança total com MFA obrigatório.":access.sectors.join(" • ")}</span></div></article>
   <article className="admin-stat-card"><UsersRound/><div><strong>Identidades administrativas</strong><span>Convites e papéis protegidos por autorização.</span></div></article>
   <article className="admin-stat-card"><Settings/><div><strong>Configuração segura</strong><span>Operações sensíveis exigem autenticação recente.</span></div></article>
  </div>
  <div className="admin-card">
   <h2>Atalhos</h2>
   <div className="admin-action-grid">
    {superAdmin&&<button onClick={()=>onNavigate("/admin/governanca")}><ShieldCheck/><span><strong>Governança</strong><small>Emitir convites e revisar escopos.</small></span></button>}
    {superAdmin&&<button onClick={()=>onNavigate("/admin/usuarios")}><UsersRound/><span><strong>Usuários</strong><small>Consultar acessos administrativos ativos.</small></span></button>}
    {superAdmin&&<button onClick={()=>onNavigate("/admin/configuracao")}><Settings/><span><strong>Configuração</strong><small>Ajustar parâmetros globais da plataforma.</small></span></button>}
   </div>
  </div>
 </section>
}
