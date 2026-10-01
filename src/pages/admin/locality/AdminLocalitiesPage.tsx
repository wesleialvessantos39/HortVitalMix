import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MapPin, Plus, Power, RefreshCw } from "lucide-react";
import { api, type ApiFailure } from "../../../lib/api";
import { cryptoRandomUUID } from "../../../lib/uuid";
import type { AdminVerifySessionResponse } from "../../../../shared/contracts/adminGovernance";
import type {
  AdminMunicipality,
  AdminMunicipalityList,
  LocalityMutationResult,
  MunicipalityImpact,
} from "../../../../shared/contracts/locality";

type Props = {
  access: AdminVerifySessionResponse;
  onNavigate: (to: string) => void;
};

type LoadState = "loading" | "ready" | "error";

function normalizedKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\̀-\ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function AdminLocalitiesPage({ access, onNavigate }: Props) {
  const [state, setState] = useState<LoadState>("loading");
  const [municipalities, setMunicipalities] = useState<AdminMunicipality[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [uf, setUf] = useState("RO");
  const [ibgeCode, setIbgeCode] = useState("");
  const [pending, setPending] = useState<{
    municipality: AdminMunicipality;
    nextActive: boolean;
    impact: MunicipalityImpact | null;
  } | null>(null);

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
      code === "ADMIN_REAUTHENTICATION_REQUIRED" ||
      code === "REAUTH_REQUIRED" ||
      code === "SESSION_REQUIRED"
    ) {
      setNotice(
        "Sua sessão administrativa precisa ser confirmada novamente. Redirecionando para o acesso.",
      );
      window.setTimeout(() => onNavigate("/entrar/super-administrador?reason=reauth"), 2500);
      return;
    }
    if (code === "LOCALITY_DUPLICATE") {
      setError("Já existe um município cadastrado com esse código IBGE ou nome.");
      return;
    }
    if (code === "LOCALITY_REVISION_CONFLICT") {
      setError("O cadastro mudou em outra sessão. Recarregue a lista antes de tentar novamente.");
      void load();
      return;
    }
    setError("Não foi possível concluir a operação agora.");
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<LocalityMutationResult>("/v1/admin/localities", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          state: uf.trim().toUpperCase(),
          ibgeCode: ibgeCode.trim(),
          commandId: cryptoRandomUUID(),
        }),
      });
      if (result.status === "created") {
        setNotice(`${result.municipality.name} – ${result.municipality.state} cadastrado.`);
        setName("");
        setIbgeCode("");
      } else if (result.status === "duplicate") {
        setError("Já existe um município cadastrado com esse código IBGE ou nome.");
      } else {
        setError("Não foi possível cadastrar o município agora.");
      }
      await load();
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setBusy(false);
    }
  }

  async function askChange(municipality: AdminMunicipality, nextActive: boolean) {
    setError("");
    setNotice("");
    if (!nextActive) {
      try {
        const impact = await api<MunicipalityImpact>(
          `/v1/admin/localities/${municipality.id}/impact`,
        );
        setPending({ municipality, nextActive, impact });
        return;
      } catch {
        setError("Não foi possível medir o impacto da desativação agora.");
        return;
      }
    }
    setPending({ municipality, nextActive, impact: null });
  }

  async function confirmChange() {
    if (!pending) return;
    const { municipality, nextActive } = pending;
    setBusy(true);
    setPending(null);
    setError("");
    setNotice("");
    try {
      const result = await api<LocalityMutationResult>(
        `/v1/admin/localities/${municipality.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            isActive: nextActive,
            expectedRevision: municipality.revision,
            commandId: cryptoRandomUUID(),
          }),
        },
      );
      if (result.status === "updated") {
        setNotice(
          `${result.municipality.name} – ${result.municipality.state} ${
            result.municipality.isActive ? "reativado" : "desativado"
          }.`,
        );
      } else if (result.status === "conflict") {
        setError("O cadastro mudou em outra sessão. Recarregue a lista.");
      } else {
        setError("Não foi possível atualizar o município agora.");
      }
      await load();
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setBusy(false);
    }
  }

  const isSuper = access.role === "platform_super_admin";

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-kicker">Cobertura</span>
          <h1>
            <MapPin size={20} /> Localidades
          </h1>
          <p>
            Só os municípios ativos aparecem na vitrine, aceitam novo cadastro e
            permanecem publicando. Desativar corta a operação sem apagar
            histórico.
          </p>
        </div>
        <button
          className="admin-table-action"
          type="button"
          onClick={() => void load()}
        >
          <RefreshCw size={14} /> Recarregar
        </button>
      </header>

      {!isSuper && (
        <p className="admin-alert">
          Você opera a gestão de localidades pelo setor
          <strong> location_management</strong>. O Super administrador sempre
          pode.
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

      <div className="admin-card">
        <h2>
          <Plus size={17} /> Cadastrar município
        </h2>
        <form className="admin-form-grid" onSubmit={create}>
          <label>
            Nome do município
            <input
              required
              minLength={3}
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {name.trim() && (
              <small className="admin-table-sub">
                Chave normalizada: {normalizedKey(name)}
              </small>
            )}
          </label>
          <label>
            UF
            <input
              required
              minLength={2}
              maxLength={2}
              value={uf}
              onChange={(event) => setUf(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            Código IBGE
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{7}"
              maxLength={7}
              value={ibgeCode}
              onChange={(event) =>
                setIbgeCode(event.target.value.replace(/\D/g, ""))
              }
            />
          </label>
          <button className="admin-primary" type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Cadastrar"}
          </button>
        </form>
      </div>

      <div className="admin-card admin-card--table">
        <h2>
          <MapPin size={17} /> Municípios cadastrados
        </h2>
        {state === "loading" ? (
          <p className="admin-empty" role="status">
            Carregando localidades…
          </p>
        ) : municipalities.length === 0 ? (
          <p className="admin-empty">
            Nenhum município cadastrado. Sem localidade ativa a plataforma não
            aceita cadastro nem publicação.
          </p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Município</th>
                  <th>UF</th>
                  <th>IBGE</th>
                  <th>Situação</th>
                  <th>Revisão</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {municipalities.map((municipality) => (
                  <tr key={municipality.id}>
                    <td>
                      <strong>{municipality.name}</strong>
                      <span className="admin-table-sub">{municipality.id}</span>
                    </td>
                    <td>{municipality.state}</td>
                    <td>{municipality.ibgeCode}</td>
                    <td>
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
                    <td>{municipality.revision}</td>
                    <td>
                      <button
                        className="admin-table-action"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void askChange(municipality, !municipality.isActive)
                        }
                      >
                        <Power size={13} />
                        {municipality.isActive ? "Desativar" : "Reativar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pending && (
        <div className="admin-card admin-alert admin-alert--error" role="alertdialog">
          <h2>
            <Power size={17} />
            {pending.nextActive ? "Reativar" : "Desativar"} {pending.municipality.name}
          </h2>
          {pending.nextActive ? (
            <p>
              O município volta a aparecer na vitrine e aceita novos cadastros e
              publicações.
            </p>
          ) : (
            <>
              <p>
                Ao desativar, produtores e consumidores deste município recebem:
                “essa região está desativada, dúvidas entre em contato conosco
                hortivitalmix@gmail.com”.
              </p>
              <ul>
                <li>Pessoas vinculadas: {pending.impact?.people ?? 0}</li>
                <li>Imóveis cadastrados: {pending.impact?.properties ?? 0}</li>
                <li>Escopos de entrega: {pending.impact?.deliveryScopes ?? 0}</li>
                <li>Bloqueios parciais: {pending.impact?.partialBlocks ?? 0}</li>
              </ul>
            </>
          )}
          <div className="admin-button-row">
            <button
              className="admin-primary"
              type="button"
              disabled={busy}
              onClick={() => void confirmChange()}
            >
              Confirmar
            </button>
            <button
              className="admin-table-action"
              type="button"
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
