import "./admin.css";
import { VerificationQueuePage } from "./VerificationQueuePage";
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
import { AdminLocalitiesPage } from "./locality/AdminLocalitiesPage";
import { AdminAccessBlocksPage } from "./AdminAccessBlocksPage";
import { lazy, Suspense } from "react";
const AdminCategoriesPage = lazy(() => import("./AdminCategoriesPage"));
const AdminCommercePage = lazy(() => import("../commerce/AdminCommercePage"));

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

  const localityRoute =
  path==="/admin/localidades" ||
  path==="/admin/bloqueios" ||
  path.startsWith("/admin/localidades/") ||
  path.startsWith("/admin/bloqueios/");
 return <AdminAccessGate
  onNavigate={onNavigate}
  requiredRole={path === "/admin/categorias" ? "platform_super_admin" : undefined}
   requiredSector={
   path==="/admin/reembolsos" || path==="/admin/politica-reembolso"
    ? "refund_management"
    : path==="/admin/denuncias"
    ? "complaint_management"
    : path==="/admin/pagamentos"
    ? "payment_configuration"
    :
   path==="/admin/imoveis" || path.startsWith("/admin/documentos/fila")
    ? "document_verification"
    : localityRoute
      ? "location_management"
      : path==="/admin/configuracao"
        ? "platform_configuration"
        : undefined
  }
 >
  {access=><AdminPortalShell
    access={access}
    currentPath={path}
    onNavigate={onNavigate}
    onSessionRefresh={onSessionRefresh}
   >
    {["/admin/reembolsos","/admin/denuncias","/admin/pagamentos","/admin/politica-reembolso"].includes(path)
      ? <Suspense fallback={<p role="status">Carregando gestão da compra…</p>}><AdminCommercePage key={path} path={path} access={access} onNavigate={onNavigate}/></Suspense>
      : path === "/admin/categorias"
      ? <Suspense fallback={<p role="status">Carregando categorias…</p>}><AdminCategoriesPage access={access} onNavigate={onNavigate}/></Suspense>
      : path==="/admin/conta" || path.startsWith("/admin/conta/")
      ? <AdminAccountPage path={path} access={access} onNavigate={onNavigate}/>
      : path==="/admin/governanca"
      ? <AdminGovernancePage onNavigate={onNavigate} access={access}/>
      : path==="/admin/imoveis" || path.startsWith("/admin/documentos/fila") ? <VerificationQueuePage/>
      : path==="/admin/usuarios"
        ? <AdminUsersPage access={access}/>
        : path==="/admin/localidades" || path.startsWith("/admin/localidades/")
          ? <AdminLocalitiesPage access={access} onNavigate={onNavigate}/>
          : path==="/admin/bloqueios" || path.startsWith("/admin/bloqueios/")
            ? <AdminAccessBlocksPage access={access} onNavigate={onNavigate}/>
        : path==="/admin/configuracao"
          ? <AdminConfiguracaoPage access={access} onNavigate={onNavigate}/>
          : <AdminDashboardPage access={access} onNavigate={onNavigate}/>}
   </AdminPortalShell>}
 </AdminAccessGate>;
}
