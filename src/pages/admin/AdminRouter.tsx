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
import { AdminEmailConfirmationPage } from "./AdminEmailConfirmationPage";
import { AdminAccountPage } from "./AdminAccountPage";

type Props={
 path:string;
 onNavigate:(to:string)=>void;
 onSessionRefresh:()=>Promise<void>;
};

export function AdminRouter({path,onNavigate,onSessionRefresh}:Props){
 if(
  path==="/admin/entrar" ||
  path==="/entrar/administrador" ||
  path==="/entrar/super-administrador" ||
  path==="/acesso/administracao" ||
  path==="/acesso/super-administracao"
 ){
  const intendedRole =
   path==="/entrar/administrador" || path==="/acesso/administracao"
    ? "platform_admin" as const
    : path==="/entrar/super-administrador" || path==="/acesso/super-administracao"
      ? "platform_super_admin" as const
      : null;
  return <AdminLoginPage
   onNavigate={onNavigate}
   intendedRole={intendedRole}
  />;
 }
 if(path==="/admin/bootstrap")
  return <AdminBootstrapPage onNavigate={onNavigate}/>;
 if(path==="/admin/confirmar-email")
  return <AdminEmailConfirmationPage onNavigate={onNavigate}/>;
 if(path==="/admin/aceitar-convite"||path==="/admin/convite")
  return <AdminAcceptInvitePage onNavigate={onNavigate}/>;

 const superOnly = path==="/admin/configuracao";
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
    {path==="/admin/conta" || path.startsWith("/admin/conta/")
      ? <AdminAccountPage path={path} access={access} onNavigate={onNavigate}/>
      : path==="/admin/governanca"
      ? <AdminGovernancePage onNavigate={onNavigate} access={access}/>
      : path==="/admin/usuarios"
        ? <AdminUsersPage access={access}/>
        : path==="/admin/configuracao" && access.role==="platform_super_admin"
          ? <AdminConfiguracaoPage onNavigate={onNavigate}/>
          : <AdminDashboardPage access={access} onNavigate={onNavigate}/>}
   </AdminPortalShell>}
 </AdminAccessGate>;
}
