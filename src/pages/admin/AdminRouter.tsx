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
import { PageLoading } from "../../components/PageLoading";
const AdminCategoriesPage = lazy(() => import("./AdminCategoriesPage"));
const AdminCommercePage = lazy(() => import("../commerce/AdminCommercePage"));
const AdminSubscriptionPlansPage = lazy(() => import("./AdminSubscriptionPlansPage"));
const NotificationsPage = lazy(() => import("../account/NotificationsPage"));
const NotificationDetailPage = lazy(() => import("../account/NotificationDetailPage"));
const AdminReviewsPage = lazy(() => import("./AdminReviewsPage"));
const ExecutiveBiDashboardPage = lazy(() => import("./ExecutiveBiDashboardPage"));
const AdminDepartmentsPage = lazy(() => import("./AdminDepartmentsPage"));
const AdminAppDistributionPage = lazy(() => import("./AdminAppDistributionPage"));
const AdminFinancePage = lazy(() => import("./AdminFinancePage"));
const AdminCatalogPage = lazy(() => import("./AdminCatalogPage"));

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
  requiredRole={path === "/admin/categorias" || path === "/admin/bi" ? "platform_super_admin" : undefined}
   requiredSector={
    path === "/admin/categorias" || path === "/admin/catalogo" ? "catalog_moderation" : path === "/admin/bi" || path === "/admin/aplicativos" ? "platform_configuration" : path === "/admin/financeiro" ? "finance_ops" :
   path==="/admin/reembolsos" || path==="/admin/politica-reembolso"
    ? "refund_management"
    : path==="/admin/denuncias" || path==="/admin/avaliacoes"
    ? "complaint_management"
    : path==="/admin/pagamentos" || path==="/admin/assinaturas"
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
    {path.startsWith("/admin/notificacoes/") ? <Suspense fallback={<PageLoading label="Carregando notificação…" />}><NotificationDetailPage id={path.slice("/admin/notificacoes/".length)} onNavigate={onNavigate}/></Suspense> : path==="/admin/bi" ? <Suspense fallback={<PageLoading label="Carregando BI executivo…" />}><ExecutiveBiDashboardPage/></Suspense> : path==="/admin/notificacoes" ? <Suspense fallback={<PageLoading label="Carregando notificações…" />}><NotificationsPage onNavigate={onNavigate}/></Suspense> : path==="/admin/avaliacoes" ? <Suspense fallback={<PageLoading label="Carregando avaliações…" />}><AdminReviewsPage/></Suspense> : path==="/admin/assinaturas" ? <Suspense fallback={<PageLoading label="Carregando planos…" />}><AdminSubscriptionPlansPage/></Suspense> : ["/admin/reembolsos","/admin/denuncias","/admin/pagamentos","/admin/politica-reembolso"].includes(path)
      ? <Suspense fallback={<PageLoading label="Carregando gestão da compra…" />}><AdminCommercePage key={path} path={path} access={access} onNavigate={onNavigate}/></Suspense>
      : path === "/admin/departamentos"
      ? <Suspense fallback={<PageLoading label="Carregando departamentos…" />}><AdminDepartmentsPage access={access} onNavigate={onNavigate}/></Suspense>
      : path === "/admin/aplicativos"
      ? <Suspense fallback={<PageLoading label="Carregando aplicativos…" />}><AdminAppDistributionPage access={access} onNavigate={onNavigate}/></Suspense>
      : path === "/admin/financeiro"
      ? <Suspense fallback={<PageLoading label="Carregando financeiro…" />}><AdminFinancePage access={access} onNavigate={onNavigate}/></Suspense>
      : path === "/admin/catalogo"
      ? <Suspense fallback={<PageLoading label="Carregando catálogo…" />}><AdminCatalogPage access={access} onNavigate={onNavigate}/></Suspense>
      : path === "/admin/categorias"
      ? <Suspense fallback={<PageLoading label="Carregando categorias…" />}><AdminCategoriesPage access={access} onNavigate={onNavigate}/></Suspense>
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
