import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";

type Props = {
  onNavigate: (to: string) => void;
  children: (access: AdminVerifySessionResponse) => ReactNode;
};

export function AdminAccessGate({ onNavigate, children }: Props) {
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
        if (!access.authorized) {
          onNavigate("/admin/entrar");
          return;
        }
        setState({ kind: "ready", access });
      })
      .catch(() => {
        if (!abort.signal.aborted) onNavigate("/admin/entrar");
      });
    return () => abort.abort();
  }, [onNavigate]);

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
