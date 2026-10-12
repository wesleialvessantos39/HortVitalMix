import { ArrowLeft, Leaf } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

type Props = {
  onNavigate: (to: string) => void;
  backTo?: string;
  backLabel?: string;
  onBack?: () => void | Promise<void>;
  disabled?: boolean;
  homeLink?: boolean;
};

export function PortalAccessHeader({
  onNavigate, backTo = "/", backLabel = "Voltar ao site", onBack, disabled = false, homeLink = false,
}: Props) {
  const brand = <><span className="admin-brand-mark"><Leaf aria-hidden="true" /></span>
    <strong>Horti<span>Vital</span>Mix</strong></>;
  return (
    <header className="admin-login-header portal-access-header" aria-label="Cabeçalho de acesso">
      {homeLink ? <button type="button" className="admin-login-brand" aria-label="HortiVitalMix — início"
        onClick={() => onNavigate("/")}>{brand}</button> : <div className="admin-login-brand">{brand}</div>}
      <div className="hvm-topbar-actions">
        <button type="button" className="admin-back" aria-label={backLabel} title={backLabel}
          disabled={disabled} onClick={() => { if (onBack) void onBack(); else onNavigate(backTo); }}>
          <ArrowLeft size={18} aria-hidden="true" /><span>{backLabel}</span>
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
