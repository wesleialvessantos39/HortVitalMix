import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";

type Props = {
  onNavigate: (to: string) => void;
  requiredRole?: "platform_admin" | "platform_super_admin";
  requiredSector?: string;
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
  >({ kind: "loading" });

  useEffect(() => {
    const abort = new AbortController();
    api<AdminVerifySessionResponse>("/v1/admin/auth/verify-session", {
      signal: abort.signal,
    })
      .then((access) => {
        const roleDenied =
          requiredRole === "platform_super_admin" &&
          access.role !== "platform_super_admin";
        const sectorDenied =
          Boolean(requiredSector) &&
          access.role !== "platform_super_admin" &&
          !access.sectors.includes(requiredSector!);
        if (!access.authorized || !access.role || roleDenied || sectorDenied) {
          onNavigate("/admin/entrar");
          return;
        }
        setState({ kind: "ready", access });
      })
      .catch(() => {
        if (!abort.signal.aborted) onNavigate("/admin/entrar");
      });
    return () => abort.abort();
  }, [onNavigate, requiredRole, requiredSector]);

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
        <button className="admin-primary" onClick={() => location.reload()}>
          Tentar novamente
        </button>
      </section>
    );

  return <>{children(state.access)}</>;
}
