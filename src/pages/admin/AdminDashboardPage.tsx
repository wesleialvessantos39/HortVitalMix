import { AccountGreeting } from "../../components/AccountGreeting";
import { ShieldCheck, UsersRound, Settings } from "lucide-react";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";

type Props={access:AdminVerifySessionResponse;onNavigate:(to:string)=>void};
export function AdminDashboardPage({access,onNavigate}:Props){
 const superAdmin=access.role==="platform_super_admin";
 return <section className="admin-page">
  <header className="admin-page-header">
   <div><h1><AccountGreeting /></h1><p>Gerencie os acessos e as configurações do HortiVitalMix.</p></div>

  </header>
  <div className="admin-stat-grid">
   <article className="admin-stat-card"><ShieldCheck/><div><strong>{superAdmin?"Acesso global":"Acesso setorial"}</strong><span>{superAdmin?"Acesso a todas as áreas da administração.":access.sectors.join(" • ")}</span></div></article>
   <article className="admin-stat-card"><UsersRound/><div><strong>Equipe administrativa</strong><span>Convide pessoas e gerencie suas permissões.</span></div></article>
   <article className="admin-stat-card"><Settings/><div><strong>Configuração segura</strong><span>Operações sensíveis exigem autenticação recente.</span></div></article>
  </div>
  <div className="admin-card">
   <h2>Atalhos</h2>
   <div className="admin-action-grid">
    <button onClick={()=>onNavigate("/admin/governanca")}><ShieldCheck/><span><strong>Governança</strong><small>{superAdmin?"Criar Administradores ou Super administradores por convite.":"Criar Administradores setoriais dentro dos seus setores."}</small></span></button>
    <button onClick={()=>onNavigate("/admin/usuarios")}><UsersRound/><span><strong>Usuários</strong><small>Consultar acessos administrativos e perfis vinculados.</small></span></button>
    {superAdmin&&<button onClick={()=>onNavigate("/admin/configuracao")}><Settings/><span><strong>Configuração</strong><small>Ajustar parâmetros globais da plataforma.</small></span></button>}
   </div>
  </div>
 </section>
}
