import { ChevronDown, MapPin } from "lucide-react";
import "./locationSelector.css";

/** The same region picker entry point in the desktop and mobile headers. */
export function LocationSelector({
  region,
  expanded,
  onOpen,
}: {
  region: string | null;
  expanded: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="location-selector"
      aria-label={
        region ? `Alterar localização: ${region}` : "Selecionar localização"
      }
      aria-haspopup="dialog"
      aria-controls="shell-dialog"
      aria-expanded={expanded}
      title={region ?? undefined}
      onClick={onOpen}
    >
      <span className="location-selector-icon" aria-hidden="true">
        <MapPin size={18} />
      </span>
      <span className="location-selector-text">
        <small>Região da vitrine</small>
        <strong>{region ?? "Escolher região"}</strong>
      </span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
  );
}
