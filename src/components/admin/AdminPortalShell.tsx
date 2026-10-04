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
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import { clearAdminSession } from "../../lib/adminSessionStore";
import { api } from "../../lib/api";

type Props = {
  access: AdminVerifySessionResponse;
  currentPath: string;
  onNavigate: (to: string) => void;
  onSessionRefresh: () => Promise<void>;
  children: ReactNode;
};

const items = [
  ["/admin/painel", "Painel", LayoutDashboard],
  ["/admin/governanca", "Governança", ShieldCheck],
  ["/admin/usuarios", "Usuários", UsersRound],
  ["/admin/documentos/fila", "Auditoria", ShieldCheck],
  ["/admin/localidades", "Localidades", MapPin],
  ["/admin/bloqueios", "Bloqueios", Ban],
  ["/admin/configuracao", "Configuração", Settings],
  ["/admin/conta", "Conta", UserRound],
] as const;

export function AdminPortalShell({
  access,
  currentPath,
  onNavigate,
  onSessionRefresh,
  children,
}: Props) {
  const visible = items.filter(([to]) => {
    if (access.role === "platform_super_admin") return true;
    if (to === "/admin/configuracao")
      return access.sectors.includes("platform_configuration");
    if (to === "/admin/documentos/fila")
      return access.sectors.includes("document_verification");
    if (to === "/admin/localidades" || to === "/admin/bloqueios")
      return access.sectors.includes("location_management");
    return true;
  });

  const [leaving, setLeaving] = useState(false);
  const [logoutError, setLogoutError] = useState("");
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
    } finally { setLeaving(false); }
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <button className="admin-brand" onClick={() => window.location.assign("/admin/painel")}>
          <span className="admin-brand-mark"><Leaf /></span>
          <span>
            <strong>Horti<span>Vital</span>Mix</strong>
            <small>{access.role === "platform_super_admin" ? "Super administrador" : "Administrador"}</small>
          </span>
        </button>
        <nav className="admin-sidebar-nav" aria-label="Administração">
          {visible.map(([to, label, Icon]) => (
            <button
              key={to}
              className={"admin-nav-item " + (currentPath === to || currentPath.startsWith(to + "/") ? "is-active" : "")}
              onClick={() => onNavigate(to)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <button className="admin-logout" onClick={logout} disabled={leaving}>
            <LogOut size={17} /> Sair
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-mobile-bar">
          <button className="admin-brand compact" onClick={() => window.location.assign("/admin/painel")}>
            <span className="admin-brand-mark"><Leaf /></span>
            <strong>Horti<span>Vital</span>Mix</strong>
          </button>
          <button className="admin-logout icon-only" onClick={logout} disabled={leaving} aria-label="Sair">
            <LogOut size={18} />
          </button>
        </div>
        {logoutError && <p role="alert" className="admin-alert admin-alert--error">{logoutError}</p>}
        {children}
        <nav className="admin-bottom-nav" aria-label="Administração mobile">
          {visible.map(([to, label, Icon]) => (
            <button
              key={to}
              className={currentPath === to || currentPath.startsWith(to + "/") ? "is-active" : ""}
              aria-label={label}
              onClick={() => onNavigate(to)}
            >
              <Icon size={19} /><span>{label}</span>
            </button>
          ))}
        </nav>
      </main>
    </div>
  );
}
