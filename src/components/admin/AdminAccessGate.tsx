import { hasAdminPermission } from "../../../shared/adminPermissions";
import { PageLoading } from "../PageLoading";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { takeAdminAccess } from "../../lib/adminAccessHandoff";
import { api, type ApiFailure } from "../../lib/api";
import type {
  AdminSectorCode,
  AdminVerifySessionResponse,
} from "../../../shared/contracts/adminGovernance";

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
  const [initialAccess] = useState(takeAdminAccess);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; access: AdminVerifySessionResponse }
    | { kind: "error" }
    | { kind: "denied" }
  >(
    initialAccess
      ? { kind: "ready", access: initialAccess }
      : { kind: "loading" },
  );
  const [attempt, setAttempt] = useState(0);
  const revision = useRef(0);
  const loggedOut = useRef(false);

  useEffect(() => {
    const ending = () => {
      loggedOut.current = true;
      revision.current++;
    };
    const clear = () => {
      ending();
      setState({ kind: "loading" });
      onNavigate("/admin/entrar");
    };
    window.addEventListener("hvm:session-ending", ending);
    window.addEventListener("hvm:session-cleared", clear);
    return () => {
      window.removeEventListener("hvm:session-ending", ending);
      window.removeEventListener("hvm:session-cleared", clear);
    };
  }, [onNavigate]);

  useEffect(() => {
    if (initialAccess && attempt === 0) return;
    const abort = new AbortController();
    const request = revision.current;
    setState({ kind: "loading" });
    api<AdminVerifySessionResponse>("/v1/admin/auth/verify-session", {
      signal: abort.signal,
    })
      .then((access) => {
        if (abort.signal.aborted || request !== revision.current) return;
        if (!access.authorized || !access.role) {
          onNavigate("/admin/entrar");
          return;
        }
        setState({ kind: "ready", access });
      })
      .catch((error: ApiFailure) => {
        if (abort.signal.aborted || request !== revision.current) return;
        if (error.status === 401) onNavigate("/admin/entrar");
        else setState({ kind: error.status === 403 ? "denied" : "error" });
      });
    return () => abort.abort();
  }, [onNavigate, attempt, initialAccess]);

  useEffect(() => {
    const abort = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (
        document.visibilityState === "hidden" ||
        inFlight ||
        loggedOut.current
      )
        return;
      inFlight = true;
      const request = revision.current;
      try {
        const access = await api<AdminVerifySessionResponse>(
          "/v1/admin/auth/verify-session",
          { signal: abort.signal },
        );
        if (!abort.signal.aborted && request === revision.current)
          setState(
            access.authorized && access.role
              ? { kind: "ready", access }
              : { kind: "denied" },
          );
      } catch (cause) {
        if (
          !abort.signal.aborted &&
          request === revision.current &&
          [401, 403].includes((cause as ApiFailure).status ?? 0)
        )
          setState({ kind: "denied" });
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 30000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    window.addEventListener("hvm:admin-permissions-changed", focus);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("hvm:admin-permissions-changed", focus);
    };
  }, []);

  if (state.kind === "loading")
    return <PageLoading label="Validando acesso administrativo…" />;

  if (state.kind === "error")
    return (
      <section className="admin-loading">
        <strong>Não foi possível validar a sessão.</strong>
        <p>Sua sessão será verificada novamente sem solicitar outro código.</p>
        <button
          className="admin-primary"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Tentar novamente
        </button>
      </section>
    );

  const permissionDenied =
    state.kind === "ready" &&
    ((requiredRole === "platform_super_admin" &&
      state.access.role !== "platform_super_admin") ||
      (requiredSector && !hasAdminPermission(state.access, requiredSector)));
  if (state.kind === "denied" || permissionDenied)
    return (
      <section className="admin-loading">
        <strong>Seu perfil não tem permissão para acessar esta área.</strong>
      </section>
    );

  return <>{children(state.access)}</>;
}
