import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  saveAdminSession,
  clearAdminSession,
} from "../../lib/adminSessionStore";
import type { ShellSession } from "../../hooks/useSession";
export function AdminReauthentication({
  session,
  onConfirmed,
}: {
  session: ShellSession;
  onConfirmed: () => void;
}) {
  const [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        status: string;
        role?: string;
        accessToken?: string;
        refreshToken?: string;
        expiresIn?: number;
      }>("/v1/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: session.email,
          password,
          portalRole: session.activeRole,
        }),
      });
      setPassword("");
      if (
        result.status !== "session_created" ||
        result.role !== session.activeRole
      )
        throw Error("AUTH_NOT_CONFIRMED");
      if (result.accessToken && result.refreshToken)
        saveAdminSession({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn ?? 3600,
        });
      const current = await api<ShellSession>("/v1/auth/session");
      if (
        current.userId !== session.userId ||
        current.activeRole !== session.activeRole
      ) {
        await api("/v1/auth/logout", { method: "POST", body: "{}" });
        clearAdminSession();
        throw Error("IDENTITY_MISMATCH");
      }
      onConfirmed();
    } catch {
      setPassword("");
      setError(
        "Não foi possível confirmar a identidade. Confira sua senha administrativa.",
      );
    } finally {
      setBusy(false);
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
    </form>
  );
}
