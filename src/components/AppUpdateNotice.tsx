import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import type { ShellSession } from "../hooks/useSession";
import { usePwa } from "../hooks/usePwa";
import { setPwaSafetyContext } from "../lib/pwaSafety";
import { isNativeApp } from "../lib/nativeTransport";
import "./appUpdateNotice.css";
export { appUpdateBlockReason } from "../lib/pwaSafety";

export function AppUpdateNotice({
  path,
  session,
  sessionLoading = false,
}: {
  path: string;
  session: ShellSession | null;
  sessionLoading?: boolean;
}) {
  const pwa = usePwa();
  useEffect(() => {
    setPwaSafetyContext(
      path,
      sessionLoading,
      session?.userId,
      session?.activeRole ?? "",
    );
  }, [path, sessionLoading, session?.userId, session?.activeRole]);
  if (
    isNativeApp() ||
    !["waiting", "preparing", "applying"].includes(pwa.updateState)
  )
    return null;
  const applying = pwa.updateState === "applying";
  return (
    <aside
      className="hvm-app-update-notice"
      aria-label="Atualização da plataforma"
      data-hvm-pwa-ui
    >
      <span className="hvm-app-update-mark">
        <RefreshCw size={19} aria-hidden="true" />
      </span>
      <div className="hvm-app-update-copy" role="status">
        <strong>
          {applying
            ? "Aplicando atualização"
            : pwa.updateState === "preparing"
              ? "Preparando nova versão"
              : "Atualização aguardando operação"}
        </strong>
        <p>
          {pwa.reason ??
            (applying
              ? "Os arquivos estão prontos. A plataforma será reaberta com segurança."
              : "A nova versão será aplicada automaticamente quando for seguro em todas as abas.")}
        </p>
      </div>
    </aside>
  );
}
