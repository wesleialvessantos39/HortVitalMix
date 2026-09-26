import { useSession } from "../../hooks/useSession";
import { AccountHub } from "../account/AccountHub";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";

export function AdminAccountPage({ path, access, onNavigate }: {
  path: string;
  access: AdminVerifySessionResponse;
  onNavigate: (to: string) => void;
}) {
  const { session, loading, refresh } = useSession();
  if (loading) return <p role="status">Carregando sua conta administrativa…</p>;
  if (!session || session.activeRole !== access.role)
    return <section className="admin-card"><p>Não foi possível confirmar os dados desta conta administrativa.</p><button className="admin-primary" onClick={() => void refresh()}>Tentar novamente</button></section>;
  return <AccountHub
    key={session.userId + ":" + session.activeRole}
    path={path.replace(/^\/admin\/conta/, "/conta")}
    session={session}
    onNavigate={(to) => onNavigate(to.startsWith("/conta") ? "/admin" + to : to)}
  />;
}
