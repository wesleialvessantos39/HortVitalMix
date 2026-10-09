import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Ban, Search, ShieldOff, Undo2 } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import {
  AdminCommandConfirmation,
  useAdminConfirmedCommand,
} from "./useAdminConfirmedCommand";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import {
  PartialBlockListSchema,
  PartialBlockSubjectLookupSchema,
  PartialBlockMutationResultSchema,
  type AdminMunicipalityList,
  type PartialBlock,
  type PartialBlockScope,
  type PartialBlockSubject,
} from "../../../shared/contracts/locality";

type Props = {
  access: AdminVerifySessionResponse;
  onNavigate: (to: string) => void;
};

type SubjectLookup = {
  userId: string;
  fullName: string;
  cpf: string;
  email: string;
  municipalityName: string | null;
  municipalityState: string | null;
  publicRoles: string[];
};

type Property = {
  id: string;
  name: string;
  status: string;
  municipality: string;
  state: string;
};

const subjectLabels: Record<PartialBlockSubject, string> = {
  producer_publishing: "Bloquear publicação (produtor)",
  consumer_purchasing: "Bloquear compra (consumidor)",
};

export function AdminAccessBlocksPage({ access }: Props) {
  const [identifier, setIdentifier] = useState("");
  const [subject, setSubject] = useState<PartialBlockSubject>(
    "producer_publishing",
  );
  const [target, setTarget] = useState<SubjectLookup | null>(null);
  const [blocks, setBlocks] = useState<PartialBlock[]>([]);
  const [municipalities, setMunicipalities] = useState<
    AdminMunicipalityList["municipalities"]
  >([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [scope, setScope] = useState<PartialBlockScope>("all");
  const [reason, setReason] = useState("");
  const [chosenMunicipalities, setChosen] = useState<string[]>([]);
  const [chosenProperties, setChosenProperties] = useState<string[]>([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const lookupFlight = useRef(false);
  const pendingCommand = useRef<{ key: string; id: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadBlocks = useCallback(
    async (userId: string, signal?: AbortSignal) => {
      try {
        const result = await api<unknown>(
          `/v1/admin/access-blocks?userId=${encodeURIComponent(userId)}`,
          { signal },
        );
        const parsed = PartialBlockListSchema.safeParse(result);
        if (parsed.success) setBlocks(parsed.data.blocks);
      } catch {
        if (!signal?.aborted)
          setError("Não foi possível listar os bloqueios deste titular.");
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    api<unknown>("/v1/admin/localities", { signal: controller.signal })
      .then((result) => {
        const parsed = result as AdminMunicipalityList;
        if (controller.signal.aborted) return;
        setMunicipalities(parsed.municipalities);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  function handleFailure(failure: unknown) {
    const code = (failure as ApiFailure).message;
    if (
      ["UNAUTHORIZED", "SESSION_CHANGED", "SESSION_REQUIRED"].includes(code)
    ) {
      setError(
        "Sua sessão mudou ou expirou. Entre novamente com a conta administrativa que iniciou esta operação.",
      );
      return;
    }
    if (
      [
        "ADMIN_REAUTHENTICATION_REQUIRED",
        "REAUTH_REQUIRED",
        "RECENT_AUTH_REQUIRED",
      ].includes(code)
    ) {
      setError(
        "Não foi possível validar esta operação após a confirmação. Seus dados foram preservados; tente novamente.",
      );
      return;
    }
    if ((failure as ApiFailure).status === 422) {
      pendingCommand.current = null;
      setError(
        "Revise a seleção: bloqueio personalizado exige municípios e, para publicação, ao menos um imóvel.",
      );
      return;
    }
    if (code === "INVALID_MUNICIPALITY") {
      setError(
        "Um dos municípios escolhidos não existe mais. Revise a seleção.",
      );
      return;
    }
    if (code === "INVALID_PROPERTY") {
      setError("Um dos imóveis escolhidos não pertence a este titular.");
      return;
    }
    setError(
      (failure as ApiFailure).status === 403
        ? "Seu perfil não tem mais permissão para gerenciar estes bloqueios."
        : "Não foi possível concluir a operação agora. Seus dados foram preservados.",
    );
  }
  const {
    run: runCommand,
    busy: commandBusy,
    confirmation,
    confirm,
    cancel,
  } = useAdminConfirmedCommand(access.role, handleFailure);
  const busy = lookupBusy || commandBusy;
  const locked = busy || Boolean(confirmation);
  function commandId(path: string, payload: unknown) {
    const key = path + JSON.stringify(payload);
    if (pendingCommand.current?.key !== key)
      pendingCommand.current = { key, id: cryptoRandomUUID() };
    return pendingCommand.current.id;
  }

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lookupFlight.current || locked) return;
    lookupFlight.current = true;
    setLookupBusy(true);
    setError("");
    setNotice("");
    setTarget(null);
    setBlocks([]);
    setProperties([]);
    const digits = identifier.replace(/\D/g, "");
    const query =
      digits.length === 11
        ? `cpf=${digits}`
        : `email=${encodeURIComponent(identifier.trim())}`;
    try {
      const result = await api<unknown>(
        `/v1/admin/access-blocks/subject?${query}`,
      );
      const parsed = PartialBlockSubjectLookupSchema.safeParse(result);
      if (!parsed.success || !parsed.data.found || !parsed.data.user) {
        setError("Nenhum titular encontrado com esse CPF ou e-mail.");
        return;
      }
      const user = parsed.data.user;
      setTarget({
        userId: user.userId,
        fullName: user.fullName,
        cpf: user.cpf,
        email: user.email,
        municipalityName: user.municipalityName,
        municipalityState: user.municipalityState,
        publicRoles: user.publicRoles,
      });
      await loadBlocks(user.userId);
      const propertyList = await api<{ properties: Property[] }>(
        `/v1/admin/access-blocks/subject-properties?userId=${encodeURIComponent(user.userId)}`,
      ).catch(() => ({ properties: [] as Property[] }));
      setProperties(propertyList.properties);
    } catch (failure) {
      handleFailure(failure);
    } finally {
      lookupFlight.current = false;
      setLookupBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || locked) return;
    const userId = target.userId;
    const path = "/v1/admin/access-blocks";
    const input = {
      userId,
      subject,
      scope,
      reason: reason.trim(),
      municipalityIds: scope === "custom" ? [...chosenMunicipalities] : [],
      propertyIds:
        subject === "producer_publishing" && scope === "custom"
          ? [...chosenProperties]
          : [],
    };
    const payload = { ...input, commandId: commandId(path, input) };
    setError("");
    setNotice("");
    await runCommand(async (signal) => {
      const result = PartialBlockMutationResultSchema.parse(
        await api<unknown>(path, {
          method: "POST",
          body: JSON.stringify(payload),
          signal,
        }),
      );
      if (signal.aborted) return;
      pendingCommand.current = null;
      if (result.status === "created") {
        setNotice("Bloqueio parcial aplicado.");
        setReason("");
        setChosen([]);
        setChosenProperties([]);
      } else if (result.status === "already_active") {
        setNotice("Já existia um bloqueio ativo para este titular e assunto.");
      } else {
        setError("Não foi possível aplicar o bloqueio agora.");
      }
      await loadBlocks(userId, signal);
    });
  }

  async function revoke(block: PartialBlock) {
    if (!target || locked) return;
    const userId = target.userId;
    const path = `/v1/admin/access-blocks/${block.id}/revoke`;
    const input = { reason: "revisao_administrativa" };
    const payload = { ...input, commandId: commandId(path, input) };
    setError("");
    setNotice("");
    await runCommand(async (signal) => {
      const result = PartialBlockMutationResultSchema.parse(
        await api<unknown>(path, {
          method: "POST",
          body: JSON.stringify(payload),
          signal,
        }),
      );
      if (signal.aborted) return;
      pendingCommand.current = null;
      setNotice(
        result.status === "revoked"
          ? "Bloqueio revogado."
          : "O bloqueio já estava revogado.",
      );
      await loadBlocks(userId, signal);
    });
  }

  const isSuper = access.role === "platform_super_admin";
  const needsProperties =
    subject === "producer_publishing" && scope === "custom";

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-kicker">Cobertura</span>
          <h1>
            <Ban size={20} /> Bloqueios por localidade
          </h1>
          <p>
            O bloqueio parcial corta a publicação do produtor ou a compra do
            consumidor em regiões específicas sem bloquear a conta inteira.
          </p>
        </div>
      </header>

      {!isSuper && (
        <p className="admin-alert">
          Você possui o poder de gerenciar bloqueios por localidade. Cada
          alteração é registrada no histórico administrativo.
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

      <div className="admin-card">
        <h2>
          <Search size={17} /> Titular
        </h2>
        <form className="admin-form-grid" onSubmit={lookup}>
          <label>
            CPF ou e-mail
            <input
              disabled={locked}
              required
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="000.000.000-00 ou nome@exemplo.com"
            />
          </label>
          <label>
            Assunto do bloqueio
            <select
              disabled={locked}
              value={subject}
              onChange={(event) =>
                setSubject(event.target.value as PartialBlockSubject)
              }
            >
              <option value="producer_publishing">
                {subjectLabels.producer_publishing}
              </option>
              <option value="consumer_purchasing">
                {subjectLabels.consumer_purchasing}
              </option>
            </select>
          </label>
          <button className="admin-primary" type="submit" disabled={locked}>
            {busy ? "Consultando…" : "Localizar"}
          </button>
        </form>

        {target && (
          <div className="admin-card-heading">
            <div>
              <strong>{target.fullName}</strong>
              <span className="admin-table-sub">
                {target.email} · CPF {target.cpf}
              </span>
              <span className="admin-table-sub">
                Perfis públicos:{" "}
                {target.publicRoles.length
                  ? target.publicRoles
                      .map((role) =>
                        role === "producer"
                          ? "Produtor"
                          : role === "consumer"
                            ? "Consumidor"
                            : role,
                      )
                      .join(", ")
                  : "nenhum"}
                {target.municipalityName
                  ? ` · ${target.municipalityName} – ${target.municipalityState}`
                  : ""}
              </span>
            </div>
          </div>
        )}
      </div>

      {target && (
        <div className="admin-card">
          <h2>
            <ShieldOff size={17} /> Aplicar bloqueio
          </h2>
          <form className="admin-form" onSubmit={create}>
            <fieldset className="admin-sectors-fieldset">
              <legend>Alcance</legend>
              <label className="admin-sector-checkbox">
                <input
                  disabled={locked}
                  type="radio"
                  name="blockScope"
                  checked={scope === "all"}
                  onChange={() => setScope("all")}
                />
                <span>
                  {subject === "producer_publishing"
                    ? "Todos os imóveis do produtor"
                    : "Todas as regiões"}
                </span>
              </label>
              <label className="admin-sector-checkbox">
                <input
                  disabled={locked}
                  type="radio"
                  name="blockScope"
                  checked={scope === "custom"}
                  onChange={() => setScope("custom")}
                />
                <span>Personalizado</span>
              </label>
            </fieldset>

            {scope === "custom" && (
              <fieldset className="admin-sectors-fieldset">
                <legend>Municípios bloqueados</legend>
                {municipalities.map((municipality) => (
                  <label
                    className="admin-sector-checkbox"
                    key={municipality.id}
                  >
                    <input
                      disabled={locked}
                      type="checkbox"
                      checked={chosenMunicipalities.includes(municipality.id)}
                      onChange={() =>
                        setChosen((current) =>
                          current.includes(municipality.id)
                            ? current.filter((id) => id !== municipality.id)
                            : [...current, municipality.id],
                        )
                      }
                    />
                    <span>
                      {municipality.name} – {municipality.state}
                      {municipality.isActive ? "" : " (desativada)"}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {needsProperties && (
              <fieldset className="admin-sectors-fieldset">
                <legend>Imóveis bloqueados</legend>
                {properties.length === 0 ? (
                  <p className="admin-muted">
                    Este titular não possui imóveis rurais cadastrados. Use
                    “Todos os imóveis do produtor”.
                  </p>
                ) : (
                  properties.map((property) => (
                    <label className="admin-sector-checkbox" key={property.id}>
                      <input
                        disabled={locked}
                        type="checkbox"
                        checked={chosenProperties.includes(property.id)}
                        onChange={() =>
                          setChosenProperties((current) =>
                            current.includes(property.id)
                              ? current.filter((id) => id !== property.id)
                              : [...current, property.id],
                          )
                        }
                      />
                      <span>
                        {property.name} · {property.municipality} –{" "}
                        {property.state} ({property.status})
                      </span>
                    </label>
                  ))
                )}
              </fieldset>
            )}

            <label>
              Motivo
              <input
                disabled={locked}
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ex.: denúncia analisada pelo setor de qualidade"
              />
            </label>
            <button className="admin-primary" type="submit" disabled={locked}>
              {busy ? "Aplicando…" : "Aplicar bloqueio parcial"}
            </button>
          </form>
        </div>
      )}

      {target && (
        <div className="admin-card admin-card--table">
          <h2>
            <Ban size={17} /> Bloqueios ativos
          </h2>
          {blocks.length === 0 ? (
            <p className="admin-empty">
              Nenhum bloqueio parcial ativo para este titular.
            </p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table admin-data-table">
                <caption className="admin-visually-hidden">
                  Bloqueios ativos do titular selecionado
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Assunto</th>
                    <th scope="col">Alcance</th>
                    <th scope="col">Motivo</th>
                    <th scope="col">Criado em</th>
                    <th scope="col">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {blocks.map((block) => (
                    <tr key={block.id}>
                      <td data-label="Assunto">
                        <strong>{subjectLabels[block.subject]}</strong>
                      </td>
                      <td data-label="Alcance">
                        {block.scope === "all" ? "Total" : "Personalizado"}
                        <span className="admin-table-sub">
                          {block.municipalityIds.length} município(s)
                          {block.propertyIds.length
                            ? ` · ${block.propertyIds.length} imóvel(is)`
                            : ""}
                        </span>
                      </td>
                      <td data-label="Motivo">{block.reason}</td>
                      <td data-label="Criado em">
                        {new Date(block.createdAt).toLocaleString("pt-BR")}
                      </td>
                      <td data-label="Ação">
                        <button
                          className="admin-table-action"
                          type="button"
                          disabled={locked}
                          onClick={() => void revoke(block)}
                        >
                          <Undo2 size={13} /> Revogar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
