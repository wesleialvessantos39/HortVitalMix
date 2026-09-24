import { useEffect, useState, type ReactNode } from "react";
import { api, type ApiFailure } from "../../lib/api";
import type { AdminSectorCode, AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";

type Props = {
  onNavigate: (to: string) => void;
  requiredRole?: "platform_admin" | "platform_super_admin";
  requiredSector?: AdminSectorCode;
  children: (access: AdminVerifySessionResponse) => ReactNode;
};

export function AdminAccessGate({
  onNavigate,
  requiredRole,
  requiredSector,
  children,
}: Props) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; access: AdminVerifySessionResponse }
    | { kind: "error" }
    | { kind: "denied" }
  >({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setState({ kind: "loading" });
    api<AdminVerifySessionResponse>("/v1/admin/auth/verify-session", {
      signal: abort.signal,
    })
      .then((access) => {
        if (abort.signal.aborted) return;
        const roleDenied =
          requiredRole === "platform_super_admin" &&
          access.role !== "platform_super_admin";
        const sectorDenied =
          Boolean(requiredSector) &&
          access.role !== "platform_super_admin" &&
          !access.sectors.includes(requiredSector!);
        if (!access.authorized || !access.role) {
          onNavigate("/admin/entrar");
          return;
        }
        if (roleDenied || sectorDenied) {
          setState({ kind: "denied" });
          return;
        }
        setState({ kind: "ready", access });
      })
      .catch((error: ApiFailure) => {
        if (abort.signal.aborted) return;
        if (error.status === 401) onNavigate("/admin/entrar");
        else setState({ kind: error.status === 403 ? "denied" : "error" });
      });
    return () => abort.abort();
  }, [onNavigate, requiredRole, requiredSector, attempt]);

  if (state.kind === "loading")
    return (
      <section className="admin-loading" aria-live="polite">
        <span className="admin-loading-spinner" />
        <strong>Validando acesso administrativo…</strong>
      </section>
    );

  if (state.kind === "error")
    return (
      <section className="admin-loading">
        <strong>Não foi possível validar a sessão.</strong>
        <p>Sua sessão será verificada novamente sem solicitar outro código.</p>
        <button className="admin-primary" onClick={() => setAttempt((value) => value + 1)}>
          Tentar novamente
        </button>
      </section>
    );

  if (state.kind === "denied")
    return <section className="admin-loading"><strong>Seu perfil não tem permissão para acessar esta área.</strong></section>;

  return <>{children(state.access)}</>;
}
