import { useCallback, useState } from "react";
import { api, type ApiFailure } from "../../../lib/api.ts";
import type { UpdateGlobalConfigInput } from "../../../../shared/contracts/adminConfig.ts";

export type UpdateOutcome =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; revision: number }
  | { kind: "conflict"; currentRevision: number }
  | { kind: "reauth_required" }
  | { kind: "error"; message: string };

export function useConfigUpdate() {
  const [outcome, setOutcome] = useState<UpdateOutcome>({ kind: "idle" });

  const submit = useCallback(
    async (
      payload: UpdateGlobalConfigInput["payload"],
      expectedRevision: number,
      commandId: string,
    ): Promise<UpdateOutcome> => {
      setOutcome({ kind: "submitting" });
      try {
        const result = await api<{
          status: "success" | "idempotent_replay" | "no_change";
          revision: number;
        }>("/v1/admin/configuration", {
          method: "PATCH",
          body: JSON.stringify({ expectedRevision, commandId, payload }),
        });
        const next: UpdateOutcome = {
          kind: "success",
          revision: Number(result.revision ?? expectedRevision),
        };
        setOutcome(next);
        return next;
      } catch (error) {
        const failure = error as ApiFailure;
        let next: UpdateOutcome;
        if (
          failure.status === 409 &&
          failure.message === "CONFIG_REVISION_CONFLICT"
        ) {
          next = {
            kind: "conflict",
            currentRevision: Number(failure.currentRevision ?? 0),
          };
        } else if (
          failure.status === 401 &&
          failure.message === "ADMIN_REAUTHENTICATION_REQUIRED"
        ) {
          next = { kind: "reauth_required" };
        } else {
          next = {
            kind: "error",
            message:
              failure.status === 422
                ? "Dados inválidos. Revise os campos informados."
                : failure.message === "NETWORK_UNAVAILABLE"
                  ? "Falha de rede ao salvar configuração."
                  : "Falha ao salvar configuração.",
          };
        }
        setOutcome(next);
        return next;
      }
    },
    [],
  );

  const reset = useCallback(() => setOutcome({ kind: "idle" }), []);
  return { outcome, submit, reset };
}
