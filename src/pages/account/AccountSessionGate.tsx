import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import type { ShellSession } from "../../hooks/useSession";
import { api } from "../../lib/api";
import { AccountHub } from "./AccountHub";

type Props = {
  path: string;
  publicSession: ShellSession | null;
  onNavigate: (to: string) => void;
  fallback: ReactNode;
};

function isPublicAccountSession(session: ShellSession | null) {
  return Boolean(
    session &&
      (session.activeRole === "consumer" || session.activeRole === "producer"),
  );
}

export function AccountSessionGate({
  path,
  publicSession,
  onNavigate,
  fallback,
}: Props) {
  const publicReady = isPublicAccountSession(publicSession);
  const [adminSession, setAdminSession] = useState<ShellSession | null>(null);
  const [checked, setChecked] = useState(publicReady);

  useEffect(() => {
    if (publicReady) {
      setAdminSession(null);
      setChecked(true);
      return;
    }

    const controller = new AbortController();
    setChecked(false);
    setAdminSession(null);

    api<AdminVerifySessionResponse>("/v1/admin/auth/verify-session", {
      signal: controller.signal,
    })
      .then((access) => {
        if (
          controller.signal.aborted ||
          !access.authorized ||
          !access.role ||
          !access.userId ||
          !access.email
        )
          return;

        setAdminSession({
          userId: access.userId,
          email: access.email,
          roles: [access.role],
          activeRole: access.role,
          portalKind: "administrative",
        });
      })
      .catch(() => {
        // A ausência de uma sessão administrativa válida apenas libera o
        // fallback público. Não consultamos /v1/auth/session neste handoff.
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecked(true);
      });

    return () => controller.abort();
  }, [publicReady, publicSession?.userId]);

  const accountSession = useMemo(
    () => (publicReady ? publicSession : adminSession),
    [publicReady, publicSession, adminSession],
  );

  if (accountSession)
    return (
      <AccountHub
        path={path}
        session={accountSession}
        onNavigate={onNavigate}
      />
    );

  if (!checked)
    return (
      <section className="account-hub" aria-live="polite">
        <p className="account-notice">Carregando sua conta…</p>
      </section>
    );

  return <>{fallback}</>;
}
