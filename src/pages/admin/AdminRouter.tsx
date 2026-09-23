import "./admin.css";
import { AdminAccessGate } from "../../components/admin/AdminAccessGate";
import { AdminPortalShell } from "../../components/admin/AdminPortalShell";
import { AdminConfiguracaoPage } from "./config/AdminConfiguracaoPage";
import { AdminLoginPage } from "./AdminLoginPage";
import { AdminBootstrapPage } from "./AdminBootstrapPage";
import { AdminAcceptInvitePage } from "./AdminAcceptInvitePage";
import { AdminGovernancePage } from "./AdminGovernancePage";
import { AdminDashboardPage } from "./AdminDashboardPage";
import { AdminUsersPage } from "./AdminUsersPage";

type Props={
 path:string;
 onNavigate:(to:string)=>void;
 onSessionRefresh:()=>Promise<void>;
};

export function AdminRouter({path,onNavigate,onSessionRefresh}:Props){
 if(path==="/admin/entrar"||path==="/entrar/administrador"||path==="/entrar/super-administrador"){
  const intendedRole =
   path==="/entrar/administrador"
    ? "platform_admin" as const
    : path==="/entrar/super-administrador"
      ? "platform_super_admin" as const
      : null;
  return <AdminLoginPage
   onNavigate={onNavigate}
   onSessionRefresh={onSessionRefresh}
   intendedRole={intendedRole}
  />;
 }
 if(path==="/admin/bootstrap")
  return <AdminBootstrapPage onNavigate={onNavigate}/>;
 if(path==="/admin/aceitar-convite"||path==="/admin/convite")
  return <AdminAcceptInvitePage onNavigate={onNavigate}/>;

 const superOnly = ["/admin/governanca","/admin/usuarios","/admin/configuracao"].includes(path);
 return <AdminAccessGate
  onNavigate={onNavigate}
  requiredRole={superOnly ? "platform_super_admin" : undefined}
 >
  {access=><AdminPortalShell
    access={access}
    currentPath={path}
    onNavigate={onNavigate}
    onSessionRefresh={onSessionRefresh}
   >
    {path==="/admin/governanca" && access.role==="platform_super_admin"
      ? <AdminGovernancePage onNavigate={onNavigate}/>
      : path==="/admin/usuarios" && access.role==="platform_super_admin"
        ? <AdminUsersPage/>
        : path==="/admin/configuracao" && access.role==="platform_super_admin"
          ? <AdminConfiguracaoPage onNavigate={onNavigate}/>
          : <AdminDashboardPage access={access} onNavigate={onNavigate}/>}
   </AdminPortalShell>}
 </AdminAccessGate>;
}
