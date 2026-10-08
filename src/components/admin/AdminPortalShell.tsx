import { hasAdminPermission } from "../../../shared/adminPermissions";
import { NotificationBell } from "../notifications/NotificationProvider";
import {
  LayoutDashboard,
  ShieldCheck,
  UsersRound,
  Settings,
  LogOut,
  Leaf,
  MapPin,
  Ban,
  UserRound,
  ListTree,
  Star,
  Bell,
  BarChart3,
  Menu,
  X,
  Store,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import { clearAdminSession } from "../../lib/adminSessionStore";
import { api } from "../../lib/api";
import { AccountStatusIcon } from "../AccountStatusIcon";

type Props = {
  access: AdminVerifySessionResponse;
  currentPath: string;
  onNavigate: (to: string) => void;
  onSessionRefresh: () => Promise<void>;
  children: ReactNode;
};

const items = [
  ["/admin/notificacoes", "Notificações", Bell],
  ["/admin/painel", "Painel", LayoutDashboard],
  ["/admin/bi", "BI executivo", BarChart3],
  ["/admin/governanca", "Governança", ShieldCheck],
  ["/admin/usuarios", "Usuários", UsersRound],
  ["/admin/documentos/fila", "Auditoria", ShieldCheck],
  ["/admin/localidades", "Localidades", MapPin],
  ["/admin/bloqueios", "Bloqueios", Ban],
  ["/admin/configuracao", "Configuração", Settings],
  ["/admin/categorias", "Categorias", ListTree],
  ["/admin/reembolsos", "Reembolsos", ShieldCheck],
  ["/admin/politica-reembolso", "Política de reembolso", Settings],
  ["/admin/denuncias", "Denúncias", Ban],
  ["/admin/avaliacoes", "Avaliações", Star],
  ["/admin/pagamentos", "Pagamentos", Settings],
  ["/admin/assinaturas", "Assinaturas", Leaf],
  ["/admin/conta", "Conta", UserRound],
] as const;
function keepMenuFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"));
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

export function AdminPortalShell({
  access,
  currentPath,
  onNavigate,
  onSessionRefresh,
  children,
}: Props) {
  const visible = items.filter(([to]) => {
    if (to === "/admin/categorias")
      return (
        access.role === "platform_super_admin" &&
        hasAdminPermission(access, "catalog_moderation")
      );
    if (to === "/admin/bi")
      return (
        access.role === "platform_super_admin" &&
        hasAdminPermission(access, "platform_configuration")
      );
    if (to === "/admin/governanca" || to === "/admin/usuarios")
      return !access.deniedSectors?.includes("account_governance");
    if (to === "/admin/reembolsos" || to === "/admin/politica-reembolso")
      return hasAdminPermission(access, "refund_management");
    if (to === "/admin/denuncias" || to === "/admin/avaliacoes")
      return hasAdminPermission(access, "complaint_management");
    if (to === "/admin/pagamentos" || to === "/admin/assinaturas")
      return hasAdminPermission(access, "payment_configuration");
    if (to === "/admin/configuracao")
      return hasAdminPermission(access, "platform_configuration");
    if (to === "/admin/documentos/fila")
      return hasAdminPermission(access, "document_verification");
    if (to === "/admin/localidades" || to === "/admin/bloqueios")
      return hasAdminPermission(access, "location_management");
    return true;
  });

  const [leaving, setLeaving] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const roleLabel = access.role === "platform_super_admin" ? "Super administrador" : "Administrador";
  const isActive = (to: string) => currentPath === to || currentPath.startsWith(to + "/") || (to === "/admin/documentos/fila" && currentPath === "/admin/imoveis");
  const primaryItems = visible.filter(([to]) => ["/admin/painel", "/admin/usuarios", "/admin/conta"].includes(to));
  const navigate = (to: string) => {
    setMenuOpen(false);
    onNavigate(to);
  };
  useEffect(() => setMenuOpen(false), [currentPath]);
  useEffect(() => {
    const menu = drawer.current;
    if (!menu) return;
    if (!menuOpen) {
      menu.close();
      return;
    }
    menu.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener("change", closeOnDesktop);
      menu.close();
    };
  }, [menuOpen]);
  async function logout() {
    if (leaving) return;
    setLeaving(true);
    setLogoutError("");
    try {
      await api("/v1/auth/logout", { method: "POST", body: "{}" });
      clearAdminSession();
      window.dispatchEvent(new Event("hvm:session-cleared"));
      onNavigate("/admin/entrar");
    } catch {
      setLogoutError("Não foi possível sair. Tente novamente.");
    } finally {
      setLeaving(false);
    }
  }

  const brand = <button className="admin-brand" onClick={() => navigate("/admin/painel")}>
    <span className="admin-brand-mark"><Leaf aria-hidden="true" /></span>
    <span><strong>Horti<span>Vital</span>Mix</strong><small>{roleLabel}</small></span>
  </button>;
  const menuItems = <nav className="admin-sidebar-nav" aria-label="Todas as áreas administrativas">
    {visible.map(([to, label, Icon]) => <button key={to} className={"admin-nav-item" + (isActive(to) ? " is-active" : "")} aria-current={isActive(to) ? "page" : undefined} onClick={() => navigate(to)}>
      {to === "/admin/conta" ? <AccountStatusIcon session={{ activeRole: access.role }} size={18} /> : <Icon size={18} aria-hidden="true" />}<span>{label}</span>
    </button>)}
  </nav>;
  const menuFooter = <div className="admin-sidebar-footer">
    <button className="admin-storefront-entry" onClick={() => navigate("/")}><Store size={17} aria-hidden="true" /> Abrir vitrine</button>
    <button className="admin-logout" onClick={logout} disabled={leaving}><LogOut size={17} aria-hidden="true" /> {leaving ? "Saindo…" : "Sair"}</button>
  </div>;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        {brand}
        {menuItems}
        {menuFooter}
      </aside>
      <div className="admin-main">
        <div className="admin-mobile-bar">
          <button
            className="icon"
            aria-label="Abrir menu administrativo"
            aria-haspopup="dialog"
            aria-controls="admin-navigation-dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Menu aria-hidden="true" />
          </button>
          <button className="admin-brand admin-mobile-heading" onClick={() => navigate("/admin/painel")}><strong>Horti<span>Vital</span>Mix</strong><small>{roleLabel}</small></button>
          <NotificationBell onClick={() => navigate("/admin/notificacoes")} />
        </div>
        {logoutError && (
          <p role="alert" className="admin-alert admin-alert--error">
            {logoutError}
          </p>
        )}
        {children}
        <nav className="admin-bottom-nav" aria-label="Administração mobile">
          {primaryItems.map(([to, label, Icon]) => (
            <button
              key={to}
              className={
                isActive(to)
                  ? "is-active"
                  : ""
              }
              aria-label={label}
              aria-current={isActive(to) ? "page" : undefined}
              onClick={() => navigate(to)}
            >
              {to === "/admin/conta" ? (
                <AccountStatusIcon
                  session={{ activeRole: access.role }}
                  size={19}
                />
              ) : (
                <Icon size={19} aria-hidden="true" />
              )}
              <span>{label}</span>
            </button>
          ))}
          <button type="button" aria-label="Mais áreas administrativas" aria-haspopup="dialog" aria-controls="admin-navigation-dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={19} aria-hidden="true" /><span>Menu</span></button>
        </nav>
      </div>
      <dialog ref={drawer} id="admin-navigation-dialog" className="navigation-drawer admin-navigation-drawer" aria-labelledby="admin-navigation-title" onKeyDown={keepMenuFocus} onCancel={() => setMenuOpen(false)} onClose={() => setMenuOpen(false)} onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setMenuOpen(false);
      }}>
        <div className="navigation-drawer-header"><div><h2 id="admin-navigation-title">Administração</h2><small>{roleLabel}</small></div><button type="button" className="icon" aria-label="Fechar menu administrativo" autoFocus onClick={() => setMenuOpen(false)}><X aria-hidden="true" /></button></div>
        {menuItems}
        {menuFooter}
      </dialog>
    </div>
  );
}
