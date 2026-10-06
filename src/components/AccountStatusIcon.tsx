import { Check, UserRound } from "lucide-react";
import type { ShellSession } from "../hooks/useSession";
import "./accountStatusIcon.css";
export function accountSessionLabel(
  session: Pick<ShellSession, "activeRole" | "fullName"> | null,
) {
  if (!session) return "Conta";
  const roles: Record<string, string> = {
    consumer: "Consumidor",
    producer: "Produtor",
    platform_admin: "Administrador",
    platform_super_admin: "Super administrador",
  };
  return `Conta conectada: ${session.fullName ?? roles[session.activeRole ?? ""] ?? "usuário"} · ${roles[session.activeRole ?? ""] ?? "usuário"}`;
}
export function AccountStatusIcon({
  session,
  size = 22,
}: {
  session: Pick<ShellSession, "activeRole" | "fullName"> | null;
  size?: number;
}) {
  return (
    <span
      className={`account-status-icon ${session ? "is-connected" : ""} ${session?.activeRole?.startsWith("platform_") ? "is-administrative" : ""}`}
      role="img"
      aria-label={accountSessionLabel(session)}
      data-session-role={session?.activeRole ?? "guest"}
    >
      <UserRound size={size} aria-hidden="true" />
      {session && (
        <span className="account-connected-mark" aria-hidden="true">
          <Check size={10} strokeWidth={3} />
        </span>
      )}
    </span>
  );
}
