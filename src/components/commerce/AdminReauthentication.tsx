import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  withAdminIdentityConfirmation,
  type ApiFailure,
} from "../../lib/api";
import {
  saveAdminSession,
  clearAdminSession,
  readAdminSessionIdentityVersion,
} from "../../lib/adminSessionStore";
import type { ShellSession } from "../../hooks/useSession";
export function AdminReauthentication({
  session,
  expectedRole = session?.activeRole,
  expectedUserId = session?.userId,
  onConfirmed,
  onCancel,
  onBusyChange,
  onSessionExpired,
}: {
  session?: ShellSession;
  expectedRole?: string | null;
  expectedUserId?: string;
  onConfirmed: () => void | Promise<void>;
  onCancel?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onSessionExpired?: () => void;
}) {
  const [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const flight = useRef(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    const identityVersion = readAdminSessionIdentityVersion();
    const controller = new AbortController();
    request.current = controller;
    try {
      const confirmed = await withAdminIdentityConfirmation(async () => {
        const result = await api<{
          status: string;
          userId?: string;
          role?: string;
          accessToken?: string;
          refreshToken?: string;
          expiresIn?: number;
        }>("/v1/admin/auth/reauthenticate", {
          method: "POST",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20000),
          ]),
          // O servidor resolve o perfil administrativo da sessão atual e impede
          // que a confirmação troque de conta, e-mail ou papel.
          body: JSON.stringify({ password }),
        });
        if (!mounted.current || controller.signal.aborted) return false;
        if (identityVersion !== readAdminSessionIdentityVersion())
          throw Error("IDENTITY_CHANGED");
        setPassword("");
        if (
          result.status !== "session_created" ||
          !result.userId ||
          !result.accessToken ||
          !result.refreshToken
        )
          throw Error("AUTH_NOT_CONFIRMED");
        if (
          result.role !== expectedRole ||
          (expectedUserId && result.userId !== expectedUserId)
        ) {
          await api("/v1/auth/logout", { method: "POST", body: "{}" }).catch(
            () => undefined,
          );
          clearAdminSession();
          window.dispatchEvent(new Event("hvm:session-cleared"));
          throw Error("IDENTITY_MISMATCH");
        }
        saveAdminSession({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn ?? 3600,
        });
        return readAdminSessionIdentityVersion();
      });
      if (confirmed && confirmed !== readAdminSessionIdentityVersion())
        throw Error("IDENTITY_CHANGED");
      if (confirmed && mounted.current && !controller.signal.aborted)
        await onConfirmed();
    } catch (caught) {
      if (!mounted.current || controller.signal.aborted) return;
      setPassword("");
      const failure = caught as ApiFailure;
      if (failure.message === "UNAUTHORIZED") onSessionExpired?.();
      setError(
        ["IDENTITY_MISMATCH", "IDENTITY_CHANGED"].includes(failure.message)
          ? "A conta administrativa mudou. Entre novamente com a conta que iniciou esta operação."
          : failure.message === "UNAUTHORIZED"
            ? "Sua sessão expirou. Entre novamente pelo acesso administrativo."
            : failure.status === 429
              ? "Muitas tentativas. Aguarde alguns minutos antes de confirmar novamente."
              : failure.status === 403
                ? "Seu acesso administrativo não está disponível para esta operação."
                : failure.status === 503 ||
                    ["NETWORK_UNAVAILABLE", "REQUEST_TIMEOUT"].includes(
                      failure.message,
                    )
                  ? "A confirmação está indisponível agora. Seus dados foram preservados; tente novamente em instantes."
                  : "Não foi possível confirmar a identidade. Confira sua senha administrativa.",
      );
    } finally {
      flight.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }
  return (
    <form className="commerce-card" onSubmit={(event) => void confirm(event)}>
      <h3>Confirme sua sessão administrativa</h3>
      <p>Esta decisão exige confirmação recente da sua identidade.</p>
      <label>
        Senha administrativa
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          maxLength={128}
          disabled={busy}
          autoFocus
        />
      </label>
      {error && (
        <p role="alert" className="commerce-error">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Confirmando…" : "Confirmar identidade"}
      </button>
      {onCancel && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Voltar sem confirmar
        </button>
      )}
    </form>
  );
}
