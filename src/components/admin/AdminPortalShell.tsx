import {
  LayoutDashboard,
  ShieldCheck,
  UsersRound,
  Settings,
  LogOut,
  Leaf,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
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
  ["/admin/configuracao", "Configuração", Settings],
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
    return to === "/admin/painel";
  });

  async function logout() {
    try {
      await api("/v1/auth/logout", { method: "POST", body: "{}" });
    } catch {}
    await onSessionRefresh();
    onNavigate("/admin/entrar");
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <button className="admin-brand" onClick={() => onNavigate("/")}>
          <span className="admin-brand-mark"><Leaf /></span>
          <span>
            <strong>Horti<span>Vital</span>Mix</strong>
            <small>Administração</small>
          </span>
        </button>
        <nav className="admin-sidebar-nav" aria-label="Administração">
          {visible.map(([to, label, Icon]) => (
            <button
              key={to}
              className={"admin-nav-item " + (currentPath === to ? "is-active" : "")}
              onClick={() => onNavigate(to)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <span className="admin-role-pill">
            {access.role === "platform_super_admin"
              ? "Super administrador"
              : "Administrador setorial"}
          </span>
          {access.sectors.length > 0 && (
            <small>{access.sectors.join(" • ")}</small>
          )}
          <button className="admin-logout" onClick={logout}>
            <LogOut size={17} /> Sair
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-mobile-bar">
          <button className="admin-brand compact" onClick={() => onNavigate("/")}>
            <span className="admin-brand-mark"><Leaf /></span>
            <strong>Horti<span>Vital</span>Mix</strong>
          </button>
          <button className="admin-logout icon-only" onClick={logout} aria-label="Sair">
            <LogOut size={18} />
          </button>
        </div>
        {children}
        <nav className="admin-bottom-nav" aria-label="Administração mobile">
          {visible.map(([to, label, Icon]) => (
            <button
              key={to}
              className={currentPath === to ? "is-active" : ""}
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
