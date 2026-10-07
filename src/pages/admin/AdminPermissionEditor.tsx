import { useEffect, useState, useRef, type FormEvent } from "react";
import { api, type ApiFailure } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import { ADMIN_SECTOR_LABELS } from "../../../shared/adminPermissions";
import type {
  AdminPermissionsView,
  AdminSectorCode,
} from "../../../shared/contracts/adminGovernance";

export function AdminPermissionEditor({
  userId,
  onClose,
  onSaved,
}: {
  userId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [view, setView] = useState<AdminPermissionsView | null>(null);
  const [selected, setSelected] = useState<AdminSectorCode[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<{
    commandId: string;
    sectors: AdminSectorCode[];
    expectedRevision: number;
  } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    api<AdminPermissionsView>(`/v1/admin/users/${userId}/permissions`, {
      signal: abort.signal,
    })
      .then((value) => {
        if (!abort.signal.aborted) {
          setView(value);
          setSelected(value.sectors);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("Não foi possível consultar os poderes desta conta.");
      });
    return () => abort.abort();
  }, [userId]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!view || busy) return;
    setBusy(true);
    setError("");
    const command = pending.current ?? {
      commandId: cryptoRandomUUID(),
      sectors: [...selected].sort(),
      expectedRevision: view.revision,
    };
    pending.current = command;
    try {
      await api(`/v1/admin/users/${userId}/permissions`, {
        method: "PATCH",
        body: JSON.stringify(command),
      });
      pending.current = null;
      await onSaved();
      onClose();
    } catch (cause) {
      const failure = cause as ApiFailure;
      if (failure.status && failure.status < 500) pending.current = null;
      setError(
        failure.message === "AUTHORIZATION_CONFLICT"
          ? "Os poderes foram alterados em outra sessão. Feche e abra novamente para consultar a versão atual."
          : failure.status === 409
            ? "A gestão do próprio acesso e o último Super administrador disponível são protegidos."
            : failure.status === 401
              ? "Confirme seu acesso novamente para salvar os poderes."
              : failure.status === 403
                ? "Você não tem mais permissão para gerir acessos."
                : "Não foi possível salvar. Tente novamente; esta operação não será duplicada.",
      );
    } finally {
      setBusy(false);
    }
  }
  const changed =
    view &&
    JSON.stringify([...selected].sort()) !==
      JSON.stringify([...view.sectors].sort());
  return (
    <form
      className="admin-card admin-form admin-permissions-form"
      onSubmit={submit}
    >
      <h2>Poderes de {view?.fullName ?? "esta conta"}</h2>
      {view && (
        <p>
          {view.role === "platform_super_admin"
            ? "O Super administrador recebe todos os poderes inicialmente. Desmarque um poder para retirá-lo e marque novamente para devolver."
            : "Marque os poderes que este administrador poderá exercer. Desmarcar retira o acesso ao setor."}
        </p>
      )}
      {error && (
        <p role="alert" className="admin-alert admin-alert--error">
          {error}
        </p>
      )}
      {!view && !error && <p role="status">Consultando poderes…</p>}
      {view && (
        <fieldset
          className="admin-sectors-fieldset"
          disabled={busy || !!pending.current}
        >
          <legend>Poderes administrativos</legend>
          {(Object.keys(ADMIN_SECTOR_LABELS) as AdminSectorCode[]).map(
            (code) => (
              <label className="admin-sector-checkbox" key={code}>
                <input
                  type="checkbox"
                  checked={selected.includes(code)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(code)
                        ? current.filter((value) => value !== code)
                        : [...current, code],
                    )
                  }
                />
                <span>{ADMIN_SECTOR_LABELS[code]}</span>
              </label>
            ),
          )}
        </fieldset>
      )}
      <p className="admin-muted">
        A alteração entra em vigor nas próximas consultas e ações da conta. O
        histórico de auditoria é preservado.
      </p>
      <div className="admin-button-row">
        <button className="admin-primary" disabled={!view || !changed || busy}>
          {busy ? "Salvando…" : "Salvar poderes"}
        </button>
        <button
          type="button"
          className="admin-secondary"
          disabled={busy}
          onClick={onClose}
        >
          Fechar
        </button>
      </div>
    </form>
  );
}
