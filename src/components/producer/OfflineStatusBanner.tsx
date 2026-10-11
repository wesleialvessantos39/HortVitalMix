import { useEffect, useState } from "react";
import type { ShellSession } from "../../hooks/useSession";
import { listPending, type PendingCommand } from "../../lib/offlineDb";
import { PortalOfflineStatus } from "../PortalOfflineStatus";

export function useOfflineCommands(userId: string) {
  const [entries, setEntries] = useState<PendingCommand[]>([]);
  useEffect(() => {
    let alive = true;
    const update = () => void listPending(userId).then((value) => { if (alive) setEntries(value); }).catch(() => {});
    update(); window.addEventListener("hvm:offline-changed", update);
    return () => { alive = false; window.removeEventListener("hvm:offline-changed", update); };
  }, [userId]);
  return entries;
}
export function OfflineStatusBanner({ session, onNavigate }: { session: ShellSession | null; onNavigate: (path: string) => void }) {
  return <PortalOfflineStatus session={session} onNavigate={onNavigate} />;
}
