import { PageLoading } from "../../../components/PageLoading";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ChevronUp,
  MapPin,
  Plus,
  Power,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api, type ApiFailure } from "../../../lib/api";
import { cryptoRandomUUID } from "../../../lib/uuid";
import {
  AdminCommandConfirmation,
  useAdminConfirmedCommand,
} from "../useAdminConfirmedCommand";
import type { AdminVerifySessionResponse } from "../../../../shared/contracts/adminGovernance";
import type {
  AdminMunicipality,
  AdminMunicipalityList,
  LocalityMutationResult,
  MunicipalityImpact,
} from "../../../../shared/contracts/locality";
import {
  findRoMunicipality,
  normalizeMunicipalityName,
  RO_MUNICIPALITIES,
} from "../../../../shared/localities/roMunicipalities";

type Props = {
  access: AdminVerifySessionResponse;
  onNavigate: (to: string) => void;
};

type LoadState = "loading" | "ready" | "error";

export function AdminLocalitiesPage({ access }: Props) {
  const [state, setState] = useState<LoadState>("loading");
  const [municipalities, setMunicipalities] = useState<AdminMunicipality[]>([]);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const editor = useRef<HTMLFormElement>(null);
  const showCreate =
    createOpen || (state === "ready" && municipalities.length === 0);
  useEffect(() => {
    if (!createOpen) return;
    editor.current?.scrollIntoView({ block: "start" });
    editor.current
      ?.querySelector<HTMLSelectElement>("select")
      ?.focus({ preventScroll: true });
  }, [createOpen]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [impactBusy, setImpactBusy] = useState(false);
  const pendingCommand = useRef<{ key: string; id: string } | null>(null);
  const [name, setName] = useState("");
  const [ibgeCode, setIbgeCode] = useState("");
  const [pending, setPending] = useState<{
    municipality: AdminMunicipality;
    nextActive: boolean;
    impact: MunicipalityImpact | null;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    municipality: AdminMunicipality;
    impact: MunicipalityImpact;
  } | null>(null);
  const duplicate = municipalities.some(
    (row) =>
      row.ibgeCode === ibgeCode ||
      (Boolean(name) &&
        normalizeMunicipalityName(row.name) ===
          normalizeMunicipalityName(name)),
  );

  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    try {
      const result = await api<AdminMunicipalityList>("/v1/admin/localities", {
        signal,
      });
      if (signal?.aborted) return;
      setMunicipalities(result.municipalities);
      setState("ready");
      setError("");
    } catch (failure) {
      if (signal?.aborted) return;
      const code = (failure as ApiFailure).message;
      if (code === "FORBIDDEN") {
        setError("Seu perfil não tem o setor de gestão de localidades.");
      } else {
        setError("Não foi possível carregar as localidades agora.");
      }
      setState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function handleFailure(failure: unknown) {
    const code = (failure as ApiFailure).message;
    if (
      ["UNAUTHORIZED", "SESSION_CHANGED", "SESSION_REQUIRED"].includes(code)
    ) {
      setError(
        "Sua sessão mudou ou expirou. Entre novamente com a conta administrativa que iniciou esta operação.",
      );
    } else if (
      [
        "ADMIN_REAUTHENTICATION_REQUIRED",
        "REAUTH_REQUIRED",
        "RECENT_AUTH_REQUIRED",
      ].includes(code)
    ) {
      setError(
        "Não foi possível validar esta operação após a confirmação. Seus dados foram preservados; tente novamente.",
      );
    } else if (code === "LOCALITY_DUPLICATE") {
      pendingCommand.current = null;
      setError("Município já cadastrado.");
    } else if (code === "LOCALITY_REVISION_CONFLICT") {
      pendingCommand.current = null;
      void load().then(() =>
        setError(
          "O cadastro mudou em outra sessão. Confira a lista antes de tentar novamente.",
        ),
      );
    } else {
      setError(
        (failure as ApiFailure).status === 403
          ? "Seu perfil não tem mais permissão para gerenciar localidades."
          : "Não foi possível concluir a operação agora. Seus dados foram preservados.",
      );
    }
  }
  const {
    run: runCommand,
    busy: commandBusy,
    confirmation,
    confirm,
    cancel,
  } = useAdminConfirmedCommand(access.role, handleFailure);
  const busy = impactBusy || commandBusy;
  const locked = busy || Boolean(confirmation);
  function commandId(path: string, payload: unknown) {
    const key = path + JSON.stringify(payload);
    if (pendingCommand.current?.key !== key)
      pendingCommand.current = { key, id: cryptoRandomUUID() };
    return pendingCommand.current.id;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const path = "/v1/admin/localities";
    const input = { name: name.trim(), state: "RO", ibgeCode: ibgeCode.trim() };
    const payload = { ...input, commandId: commandId(path, input) };
    setError("");
    setNotice("");
    await runCommand(async (signal) => {
      const result = await api<LocalityMutationResult>(path, {
        method: "POST",
        body: JSON.stringify(payload),
        signal,
      });
      if (signal.aborted) return;
      pendingCommand.current = null;
      if (result.status === "created") {
        setNotice(
          `${result.municipality.name} – ${result.municipality.state} cadastrado.`,
        );
        setName("");
        setIbgeCode("");
        setCreateOpen(false);
        await load(signal);
      } else if (result.status === "duplicate") {
        setError("Município já cadastrado.");
      } else {
        setError("Não foi possível cadastrar o município agora.");
      }
    });
  }

  async function askChange(
    municipality: AdminMunicipality,
    nextActive: boolean,
  ) {
    if (locked) return;
    setError("");
    setNotice("");
    if (!nextActive) {
      setImpactBusy(true);
      try {
        const impact = await api<MunicipalityImpact>(
          `/v1/admin/localities/${municipality.id}/impact`,
        );
        setPending({ municipality, nextActive, impact });
        return;
      } catch {
        setError("Não foi possível medir o impacto da desativação agora.");
        return;
      } finally {
        setImpactBusy(false);
      }
    }
    setPending({ municipality, nextActive, impact: null });
  }

  async function askDelete(municipality: AdminMunicipality) {
    if (locked) return;
    setError("");
    setNotice("");
    setImpactBusy(true);
    try {
      const impact = await api<MunicipalityImpact>(
        `/v1/admin/localities/${municipality.id}/impact`,
      );
      setPending(null);
      setPendingDelete({ municipality, impact });
    } catch {
      setError("Não foi possível medir o impacto da exclusão agora.");
    } finally {
      setImpactBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || locked) return;
    const { municipality } = pendingDelete;
    const path = `/v1/admin/localities/${municipality.id}`;
    const input = { expectedRevision: municipality.revision };
    const payload = { ...input, commandId: commandId(path, input) };
    setError("");
    setNotice("");
    await runCommand(async (signal) => {
      const result = await api<LocalityMutationResult>(path, {
        method: "DELETE",
        body: JSON.stringify(payload),
        signal,
      });
      if (signal.aborted) return;
      pendingCommand.current = null;
      if (result.status === "deleted") {
        setPendingDelete(null);
        setNotice(
          `${municipality.name} – ${municipality.state} foi excluído da cobertura. Usuários vinculados passam a receber o aviso de região fora de cobertura.`,
        );
        await load(signal);
      } else if (result.status === "conflict") {
        setPendingDelete(null);
        await load(signal);
        if (!signal.aborted)
          setError(
            "O cadastro mudou em outra sessão. Confira a lista antes de tentar novamente.",
          );
      } else {
        setError("Não foi possível excluir o município agora.");
      }
    });
  }

  async function confirmChange() {
    if (!pending || locked) return;
    const { municipality, nextActive } = pending;
    const path = `/v1/admin/localities/${municipality.id}`;
    const input = {
      isActive: nextActive,
      expectedRevision: municipality.revision,
    };
    const payload = { ...input, commandId: commandId(path, input) };
    setError("");
    setNotice("");
    await runCommand(async (signal) => {
      const result = await api<LocalityMutationResult>(path, {
        method: "PATCH",
        body: JSON.stringify(payload),
        signal,
      });
      if (signal.aborted) return;
      pendingCommand.current = null;
      if (result.status === "updated") {
        setPending(null);
        setNotice(
          `${result.municipality.name} – ${result.municipality.state} ${result.municipality.isActive ? "reativado" : "desativado"}.`,
        );
        await load(signal);
      } else if (result.status === "conflict") {
        setPending(null);
        await load(signal);
        if (!signal.aborted)
          setError(
            "O cadastro mudou em outra sessão. Confira a lista antes de tentar novamente.",
          );
      } else {
        setError("Não foi possível atualizar o município agora.");
      }
    });
  }

  const isSuper = access.role === "platform_super_admin";
  const visibleMunicipalities = municipalities.filter((municipality) =>
    `${municipality.name} ${municipality.ibgeCode}`
      .toLocaleLowerCase("pt-BR")
      .includes(search.trim().toLocaleLowerCase("pt-BR")),
  );

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-kicker">Cobertura</span>
          <h1>
            <MapPin size={20} /> Localidades
          </h1>
          <p>
            Municípios ativos operam normalmente. Bloquear interrompe compras e
            publicações sem apagar o cadastro; excluir remove a localidade da
            cobertura e reconcilia automaticamente os usuários afetados.
          </p>
        </div>
        <nav className="admin-button-row" aria-label="Ações de localidades">
          {municipalities.length > 0 && (
            <button
              className="admin-primary"
              type="button"
              disabled={locked}
              aria-expanded={showCreate}
              aria-controls="admin-municipality-editor"
              onClick={() => setCreateOpen(!showCreate)}
            >
              {showCreate ? (
                <ChevronUp size={17} aria-hidden="true" />
              ) : (
                <Plus size={17} aria-hidden="true" />
              )}
              {showCreate ? "Recolher formulário" : "Novo município"}
            </button>
          )}
          <button
            className="admin-secondary"
            type="button"
            disabled={locked}
            onClick={() => void load()}
          >
            <RefreshCw size={14} /> Recarregar
          </button>
        </nav>
      </header>

      {!isSuper && (
        <p className="admin-alert">
          Você possui o poder de gerenciar localidades. As alterações de
          cobertura são registradas no histórico administrativo.
        </p>
      )}
      {notice && (
        <p role="status" className="admin-alert admin-alert--success">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="admin-alert admin-alert--error">
          {error}
        </p>
      )}

      <AdminCommandConfirmation
        confirmation={confirmation}
        onConfirmed={confirm}
        onCancel={cancel}
      />

      {showCreate && (
        <div className="admin-card admin-department-editor">
          <h2>
            <Plus size={17} /> Cadastrar município
          </h2>
          <form
            ref={editor}
            id="admin-municipality-editor"
            className="admin-form-grid"
            onSubmit={create}
          >
            <label>
              Nome do município
              <select
                disabled={locked}
                required
                value={name}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  const municipality = findRoMunicipality({
                    name: value,
                  });
                  setName(municipality?.name ?? value);
                  setIbgeCode(municipality?.ibgeCode ?? "");
                }}
              >
                <option value="">Escolha o município</option>
                {RO_MUNICIPALITIES.map((municipality) => (
                  <option key={municipality.ibgeCode} value={municipality.name}>
                    {municipality.name}
                  </option>
                ))}
              </select>
              {name.trim() && (
                <small className="admin-table-sub">UF: Rondônia (RO)</small>
              )}
            </label>
            <label>
              UF
              <input value="RO — Rondônia" disabled />
            </label>
            <label>
              Código IBGE
              <input
                disabled={locked}
                required
                inputMode="numeric"
                pattern="[0-9]{7}"
                maxLength={7}
                value={ibgeCode}
                onChange={(event) => {
                  const code = event.currentTarget.value.replace(/\D/g, "");
                  const municipality = findRoMunicipality({ ibgeCode: code });
                  setIbgeCode(code);
                  setName(municipality?.name ?? "");
                }}
              />
            </label>
            {duplicate && (
              <p className="admin-alert admin-alert--error" role="alert">
                Município já cadastrado.
              </p>
            )}
            <button
              className="admin-primary"
              type="submit"
              disabled={locked || duplicate}
            >
              {busy ? "Salvando…" : "Cadastrar"}
            </button>
          </form>
        </div>
      )}

      <div className="admin-card admin-card--table">
        <h2>
          <MapPin size={17} /> Municípios cadastrados
        </h2>
        {municipalities.length > 0 && (
          <div className="admin-records-toolbar">
            <label>
              Buscar município
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nome ou código IBGE"
              />
            </label>
            <p className="admin-record-count" role="status">
              {visibleMunicipalities.length} de {municipalities.length}{" "}
              municípios ·{" "}
              {
                municipalities.filter((municipality) => municipality.isActive)
                  .length
              }{" "}
              ativos
            </p>
          </div>
        )}
        {state === "loading" && municipalities.length === 0 ? (
          <PageLoading label="Carregando localidades…" compact />
        ) : municipalities.length === 0 ? (
          <p className="admin-empty">
            Nenhum município cadastrado. Sem localidade ativa a plataforma não
            aceita cadastro nem publicação.
          </p>
        ) : visibleMunicipalities.length === 0 ? (
          <p className="admin-empty">
            Nenhum município corresponde a esta busca.
          </p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table admin-data-table">
              <caption className="admin-visually-hidden">
                Municípios e situação da cobertura
              </caption>
              <thead>
                <tr>
                  <th scope="col">Município</th>
                  <th scope="col">UF</th>
                  <th scope="col">IBGE</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Revisão</th>
                  <th scope="col">Ação</th>
                </tr>
              </thead>
              <tbody>
                {visibleMunicipalities.map((municipality) => (
                  <tr key={municipality.id}>
                    <td data-label="Município">
                      <strong>{municipality.name}</strong>
                    </td>
                    <td data-label="UF">{municipality.state}</td>
                    <td data-label="IBGE">{municipality.ibgeCode}</td>
                    <td data-label="Situação">
                      <span
                        className={
                          municipality.isActive
                            ? "admin-badge admin-badge--ok"
                            : "admin-badge"
                        }
                      >
                        {municipality.isActive ? "Ativa" : "Desativada"}
                      </span>
                    </td>
                    <td data-label="Revisão">{municipality.revision}</td>
                    <td data-label="Ações">
                      <div className="admin-button-row">
                        <button
                          className="admin-table-action"
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            void askChange(municipality, !municipality.isActive)
                          }
                        >
                          <Power size={13} />
                          {municipality.isActive ? "Bloquear" : "Desbloquear"}
                        </button>
                        <button
                          className="admin-table-action admin-danger-text"
                          type="button"
                          disabled={locked}
                          onClick={() => void askDelete(municipality)}
                        >
                          <Trash2 size={13} />
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pendingDelete && (
        <div
          className="admin-card admin-alert admin-alert--error"
          role="alertdialog"
        >
          <h2>
            <Trash2 size={17} /> Excluir {pendingDelete.municipality.name}
          </h2>
          <p>
            Esta ação remove o município do catálogo de cobertura. Pessoas
            vinculadas passarão a receber “Sua região está fora de cobertura.
            Dúvidas, entre em contato conosco: hortivitalmix@gmail.com.” Compras
            e publicações nessa região deixam de ser permitidas até que o
            município seja cadastrado novamente.
          </p>
          <ul>
            <li>Pessoas afetadas: {pendingDelete.impact.people}</li>
            <li>Imóveis afetados: {pendingDelete.impact.properties}</li>
            <li>
              Escopos de entrega afetados: {pendingDelete.impact.deliveryScopes}
            </li>
            <li>Bloqueios vinculados: {pendingDelete.impact.partialBlocks}</li>
          </ul>
          <div className="admin-button-row">
            <button
              className="admin-primary admin-danger"
              type="button"
              disabled={locked}
              onClick={() => void confirmDelete()}
            >
              Excluir localidade
            </button>
            <button
              className="admin-table-action"
              type="button"
              disabled={locked}
              onClick={() => setPendingDelete(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {pending && (
        <div
          className="admin-card admin-alert admin-alert--error"
          role="alertdialog"
        >
          <h2>
            <Power size={17} />
            {pending.nextActive ? "Desbloquear" : "Bloquear"}{" "}
            {pending.municipality.name}
          </h2>
          {pending.nextActive ? (
            <p>
              O município volta à cobertura ativa, com compras e publicações
              novamente liberadas conforme os demais controles de acesso.
            </p>
          ) : (
            <>
              <p>
                Ao bloquear, produtores e consumidores vinculados recebem: “Sua
                região está bloqueada. Dúvidas, entre em contato conosco:
                hortivitalmix@gmail.com.”
              </p>
              <ul>
                <li>Pessoas vinculadas: {pending.impact?.people ?? 0}</li>
                <li>Imóveis cadastrados: {pending.impact?.properties ?? 0}</li>
                <li>
                  Escopos de entrega: {pending.impact?.deliveryScopes ?? 0}
                </li>
                <li>
                  Bloqueios parciais: {pending.impact?.partialBlocks ?? 0}
                </li>
              </ul>
            </>
          )}
          <div className="admin-button-row">
            <button
              className="admin-primary"
              type="button"
              disabled={locked}
              onClick={() => void confirmChange()}
            >
              Confirmar
            </button>
            <button
              className="admin-table-action"
              type="button"
              disabled={locked}
              onClick={() => setPending(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
