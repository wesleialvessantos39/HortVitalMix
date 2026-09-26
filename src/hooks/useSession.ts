import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

export type ShellSession = {
  userId: string;
  email: string | null;
  fullName?: string | null;
  roles: string[];
  activeRole?: string | null;
  portalKind?: "public" | "administrative";
};

export function useSession() {
  const [session, setSession] = useState<ShellSession | null>(null);
  const [loading, setLoading] = useState(true);

  const adoptSession = useCallback((next: ShellSession | null) => {
    setSession(next);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setSession(await api<ShellSession>("/v1/auth/session"));
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const sync = () => void refresh();
    window.addEventListener("hvm:session-changed", sync);
    return () => window.removeEventListener("hvm:session-changed", sync);
  }, [refresh]);

  return { session, loading, refresh, adoptSession };
}
