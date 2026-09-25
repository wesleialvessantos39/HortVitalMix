import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiFailure } from "../../../lib/api.ts";
import {
  GlobalConfigAdminResponseSchema,
  type GlobalConfigAdminResponse,
} from "../../../../shared/contracts/adminConfig.ts";

type Status = "loading" | "ready" | "error" | "empty";

type State = {
  status: Status;
  config: GlobalConfigAdminResponse | null;
  errorMessage: string | null;
};

export function useConfigAdmin() {
  const [state, setState] = useState<State>({
    status: "loading",
    config: null,
    errorMessage: null,
  });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState((currentState) => ({
      ...currentState,
      status: "loading",
      errorMessage: null,
    }));


    try {
      const data = await api<unknown>("/v1/admin/configuration");
      if (!mounted.current) return;

      if (!data) {
        setState({ status: "empty", config: null, errorMessage: null });
        return;
      }

      const parsed = GlobalConfigAdminResponseSchema.safeParse(data);
      if (!parsed.success) {
        setState({
          status: "error",
          config: null,
          errorMessage: "Resposta administrativa inválida.",
        });
        return;
      }

      setState({ status: "ready", config: parsed.data, errorMessage: null });
    } catch (error) {
      if (!mounted.current) return;

      const failure = error as ApiFailure;
      const message =
        failure.status === 401
          ? "Sessão expirada. Faça login novamente."
          : failure.status === 403
            ? "Acesso restrito ao Super Administrador."
            : failure.status === 503
              ? "Serviço de configuração indisponível."
              : failure.message === "NETWORK_UNAVAILABLE"
                ? "Falha de rede ao carregar configuração."
                : "Falha ao carregar configuração.";

      setState({ status: "error", config: null, errorMessage: message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
