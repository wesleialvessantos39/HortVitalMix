import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiFailure } from "../lib/api";
import {
  clearProducerSnapshots,
  offlineTransport,
  readProducerSession,
  saveProducerSession,
} from "../lib/offlineDb";
import "../lib/sessionExit";

export type ShellSession = {
  userId: string;
  email: string | null;
  fullName?: string | null;
  roles: string[];
  activeRole?: string | null;
  portalKind?: "public" | "administrative";
  localityWarning?: string | null;
};

export function useSession() {
  const [session, setSession] = useState<ShellSession | null>(null);
  const [loading, setLoading] = useState(true);
  const revision = useRef(0);

  const adoptSession = useCallback((next: ShellSession | null) => {
    revision.current++;
    setSession(next);
    setLoading(false);
    void saveProducerSession(next).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      if (!navigator.onLine) {
        const cached = await readProducerSession().catch(() => null);
        if (request === revision.current && cached) setSession(cached);
        return;
      }
      const next = await api<ShellSession>("/v1/auth/session");
      if (request === revision.current) {
        setSession(next);
        void saveProducerSession(next).catch(() => {});
      }
    } catch (error) {
      const status = (error as ApiFailure).status;
      if (request === revision.current && (status === 401 || status === 403)) {
        setSession(null);
        void clearProducerSnapshots().catch(() => {});
      } else if (request === revision.current && offlineTransport(error)) {
        const cached = await readProducerSession().catch(() => null);
        if (request === revision.current && cached) setSession(cached);
      }
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const sync = () => void refresh();
    const clear = () => {
      adoptSession(null);
      void clearProducerSnapshots().catch(() => {});
    };
    const focus = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const timer = window.setInterval(focus, 30000);
    window.addEventListener("focus", focus);
    window.addEventListener("hvm:session-changed", sync);
    window.addEventListener("online", sync);
    window.addEventListener("hvm:session-cleared", clear);
    window.addEventListener("hvm:session-ending", clear);
    return () => {
      revision.current++;
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("hvm:session-changed", sync);
      window.removeEventListener("online", sync);
      window.removeEventListener("hvm:session-cleared", clear);
      window.removeEventListener("hvm:session-ending", clear);
    };
  }, [refresh, adoptSession]);

  return { session, loading, refresh, adoptSession };
}
