import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiFailure } from "../../../lib/api.ts";
import {
  GlobalConfigAdminResponseSchema,
  type GlobalConfigAdminResponse,
} from "../../../../shared/contracts/adminConfig.ts";

type Status = "loading" | "ready" | "error" | "empty";
type State = { status: Status; config: GlobalConfigAdminResponse | null; errorMessage: string | null };

export function useConfigAdmin() {
  const [state, setState] = useState<State>({ status: "loading", config: null, errorMessage: null });
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const pending = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setRefreshing(true);
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState(current => ({ ...current, status: current.config ? "ready" : "loading", errorMessage: null }));
    try {
      const data = await api<unknown>("/v1/admin/configuration", { signal: controller.signal });
      if (!mounted.current || version !== requestVersion.current) return;
      if (!data) {
        setState({ status: "empty", config: null, errorMessage: null });
        return;
      }
      const parsed = GlobalConfigAdminResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error("INVALID_ADMIN_CONFIG");
      setState({ status: "ready", config: parsed.data, errorMessage: null });
    } catch (error) {
      if (!mounted.current || version !== requestVersion.current) return;
      const failure = error as ApiFailure;
      const message = failure.status === 401 ? "Sessão expirada. Faça login novamente."
        : failure.status === 403 ? "Seu perfil não possui permissão para configuração global."
        : failure.status === 503 ? "Serviço de configuração indisponível."
        : failure.message === "NETWORK_UNAVAILABLE" ? "Falha de rede ao carregar configuração."
        : failure.message === "INVALID_ADMIN_CONFIG" ? "Resposta administrativa inválida."
        : "Falha ao carregar configuração.";
      // Keep a previously loaded form visible, but explicitly report a failed refresh.
      setState(current => failure.status === 401 || failure.status === 403
        ? { status: "error", config: null, errorMessage: message }
        : { ...current, status: current.config ? "ready" : "error", errorMessage: message });
    } finally {
      if (version === requestVersion.current) {
        pending.current = null;
        if (mounted.current) setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      requestVersion.current++;
      pending.current?.abort();
    };
  }, [load]);

  return { state, reload: load, refreshing };
}
