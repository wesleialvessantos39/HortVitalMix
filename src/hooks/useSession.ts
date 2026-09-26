import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiFailure } from "../lib/api";

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
  const revision = useRef(0);

  const adoptSession = useCallback((next: ShellSession | null) => {
    revision.current++;
    setSession(next);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const next = await api<ShellSession>("/v1/auth/session");
      if (request === revision.current) setSession(next);
    } catch (error) {
      const status = (error as ApiFailure).status;
      if (request === revision.current && (status === 401 || status === 403)) setSession(null);
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const sync = () => void refresh();
    const clear = () => adoptSession(null);
    window.addEventListener("hvm:session-changed", sync);
    window.addEventListener("hvm:session-cleared", clear);
    return () => {
      revision.current++;
      window.removeEventListener("hvm:session-changed", sync);
      window.removeEventListener("hvm:session-cleared", clear);
    };
  }, [refresh, adoptSession]);

  return { session, loading, refresh, adoptSession };
}
