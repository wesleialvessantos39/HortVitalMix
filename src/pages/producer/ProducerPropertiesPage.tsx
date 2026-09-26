import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  MapPinned,
  RefreshCw,
  Save,
  Sprout,
  WifiOff,
} from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import type { ShellSession } from "../../hooks/useSession";
import {
  GeoJsonPolygonSchema,
  Step1IdentificationSchema,
  Step2DimensionsSchema,
  Step3WaterSchema,
  Step4ActivitySchema,
  type RuralPropertySummary,
  type RuralPropertyView,
} from "../../../shared/contracts/ruralProperty";
import { OsmPinMap } from "../account/OsmPinMap";

type Props = {
  path: string;
  session: ShellSession;
  onNavigate: (to: string) => void;
};

type PageState = "loading" | "ready" | "empty" | "error" | "conflict";
type SaveState = "idle" | "saving" | "saved" | "local" | "error";

type Draft = {
  propertyId: string | null;
  revision: number | null;
  step: number;
  propertyName: string;
  registrationNumber: string;
  lineVicinal: string;
  ruralZoneSector: string;
  municipality: string;
  state: "RO";
  latitudeSede: number | null;
  longitudeSede: number | null;
  accessDirections: string;
  totalAreaHectares: string;
  cultivatedAreaHectares: string;
  polygonGeojson: string;
  waterSource: string;
  irrigationSystem: string;
  activityCategory: string;
  productionSystem: string;
  hasWashingFacility: boolean;
  agroecologicalCommitment: boolean;
};

const blankDraft: Draft = {
  propertyId: null,
  revision: null,
  step: 1,
  propertyName: "",
  registrationNumber: "",
  lineVicinal: "",
  ruralZoneSector: "",
  municipality: "Ariquemes",
  state: "RO",
  latitudeSede: null,
  longitudeSede: null,
  accessDirections: "",
  totalAreaHectares: "",
  cultivatedAreaHectares: "",
  polygonGeojson: "",
  waterSource: "",
  irrigationSystem: "",
  activityCategory: "",
  productionSystem: "",
  hasWashingFacility: true,
  agroecologicalCommitment: false,
};

const steps = [
  ["Identificação e acesso", "Localize sua propriedade e descreva como chegar."],
  ["Dimensões", "Informe as áreas e, se desejar, o perímetro em GeoJSON."],
  ["Segurança hídrica", "Registre a fonte de água e o sistema de irrigação."],
  ["Culturas e processamento", "Descreva a atividade principal e a estrutura de lavagem."],
  ["Revisão e submissão", "Revise os dados e confirme o compromisso para enviar."],
] as const;

function commandId() {
  return crypto.randomUUID();
}

function localKey(userId: string, propertyId: string | null) {
  return `hvm:rural-property-draft:${userId}:${propertyId ?? "new"}`;
}

function statusLabel(status: RuralPropertySummary["status"]) {
  return {
    draft: "Rascunho",
    submitted: "Enviado para análise",
    verified: "Verificado",
    rejected: "Revisão necessária",
    suspended: "Suspenso",
  }[status];
}

function messageForFailure(error: unknown) {
  const failure = error as ApiFailure;
  if (failure.message === "RECENT_AUTH_REQUIRED")
    return "Sua confirmação de segurança venceu. Saia e entre novamente como Produtor antes de continuar salvando.";
  if (failure.message === "PROPERTY_REVISION_CONFLICT" || failure.status === 409)
    return "Este imóvel foi alterado em outra sessão. Recarregue os dados antes de continuar.";
  if (failure.message === "PROPERTY_INCOMPLETE")
    return "Complete as etapas anteriores antes de enviar o imóvel.";
  if (failure.message === "WASHING_FACILITY_REQUIRED")
    return "Legumes picados exigem uma instalação adequada para lavagem e higienização.";
  return "Não foi possível salvar agora. Seus dados continuam preservados neste aparelho.";
}

function parseBoundary(raw: string) {
  if (!raw.trim()) return [];
  try {
    const json = JSON.parse(raw);
    const parsed = GeoJsonPolygonSchema.safeParse(json);
    if (!parsed.success) return null;
    return [
      {
        boundaryType: "perimeter" as const,
        polygonGeojson: parsed.data,
        calculatedAreaHa: null,
      },
    ];
  } catch {
    return null;
  }
}

function draftFromProperty(property: RuralPropertyView): Draft {
  const perimeter =
    property.boundaries.find((item) => item.boundaryType === "perimeter") ??
    property.boundaries[0];

  return {
    propertyId: property.id,
    revision: property.revision,
    step: Math.min(5, Math.max(1, property.wizardCurrentStep)),
    propertyName: property.propertyName,
    registrationNumber: property.registrationNumber ?? "",
    lineVicinal: property.lineVicinal,
    ruralZoneSector: property.ruralZoneSector,
    municipality: property.municipality,
    state: "RO",
    latitudeSede: property.latitudeSede,
    longitudeSede: property.longitudeSede,
    accessDirections: property.accessDirections ?? "",
    totalAreaHectares:
      property.totalAreaHectares === null
        ? ""
        : String(property.totalAreaHectares),
    cultivatedAreaHectares:
      property.cultivatedAreaHectares === null
        ? ""
        : String(property.cultivatedAreaHectares),
    polygonGeojson: perimeter
      ? JSON.stringify(perimeter.polygonGeojson, null, 2)
      : "",
    waterSource: property.waterSource ?? "",
    irrigationSystem: property.irrigationSystem ?? "",
    activityCategory: property.activity?.activityCategory ?? "",
    productionSystem: property.activity?.productionSystem ?? "",
    hasWashingFacility: property.activity?.hasWashingFacility ?? true,
    agroecologicalCommitment: property.status !== "draft",
  };
}

export function ProducerPropertiesPage({
  path,
  session,
  onNavigate,
}: Props) {
  if (path === "/produtor/propriedades/novo")
    return (
      <RuralPropertyWizard
        session={session}
        onNavigate={onNavigate}
      />
    );

  return (
    <PropertyList session={session} onNavigate={onNavigate} />
  );
}

function PropertyList({
  session,
  onNavigate,
}: Omit<Props, "path">) {
  const [state, setState] = useState<PageState>("loading");
  const [properties, setProperties] = useState<RuralPropertySummary[]>([]);

  async function load() {
    setState("loading");
    try {
      const result = await api<{ properties: RuralPropertySummary[] }>(
        "/v1/producer/properties",
      );
      setProperties(result.properties);
      setState(result.properties.length ? "ready" : "empty");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, [session.userId]);

  return (
    <section className="rural-properties-page">
      <header className="rural-page-heading">
        <div>
          <span className="eyebrow">Ambiente do produtor</span>
          <h1>Meus imóveis rurais</h1>
          <p>
            Cadastre cada propriedade produtiva separadamente. Seus endereços
            pessoais continuam em Minha conta.
          </p>
        </div>
        <button
          className="primary rural-primary-action"
          onClick={() => onNavigate("/produtor/propriedades/novo")}
        >
          <Sprout />
          Novo imóvel rural
        </button>
      </header>

      {state === "loading" && (
        <div className="rural-properties-grid" aria-busy="true">
          {[0, 1].map((item) => (
            <div className="rural-property-card rural-card-skeleton" key={item}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      )}

      {state === "error" && (
        <div className="rural-state-card" role="alert">
          <AlertTriangle />
          <div>
            <h2>Não foi possível carregar seus imóveis</h2>
            <p>Confira a conexão. Nenhum dado foi alterado.</p>
          </div>
          <button className="secondary" onClick={() => void load()}>
            <RefreshCw />
            Tentar novamente
          </button>
        </div>
      )}

      {state === "empty" && (
        <div className="rural-state-card rural-empty-state">
          <MapPinned />
          <div>
            <h2>Nenhum imóvel rural cadastrado</h2>
            <p>
              Comece pela identificação da chácara, linha vicinal e ponto da sede.
            </p>
          </div>
        </div>
      )}

      {(state === "ready" || state === "conflict") && (
        <div className="rural-properties-grid">
          {properties.map((property) => (
            <article className="rural-property-card" key={property.id}>
              <div className="rural-property-card-top">
                <MapPinned />
                <span className={"rural-status-badge is-" + property.status}>
                  {statusLabel(property.status)}
                </span>
              </div>
              <h2>{property.propertyName}</h2>
              <p>
                {property.lineVicinal} · {property.municipality}/{property.state}
              </p>
              <div className="rural-progress-line" aria-label={`Etapa ${property.wizardCurrentStep} de 5`}>
                <span style={{ width: `${property.wizardCurrentStep * 20}%` }} />
              </div>
              <small>Etapa {property.wizardCurrentStep} de 5</small>
              <button
                className="secondary"
                onClick={() =>
                  onNavigate(
                    "/produtor/propriedades/novo?id=" +
                      encodeURIComponent(property.id),
                  )
                }
                disabled={
                  property.status === "verified" ||
                  property.status === "submitted" ||
                  property.status === "suspended"
                }
              >
                {property.status === "draft" || property.status === "rejected"
                  ? "Continuar cadastro"
                  : "Visualizar cadastro"}
                <ChevronRight />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function RuralPropertyWizard({
  session,
  onNavigate,
}: Omit<Props, "path">) {
  const requestedId =
    typeof location === "undefined"
      ? null
      : new URLSearchParams(location.search).get("id");
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [state, setState] = useState<PageState>(
    requestedId ? "loading" : "ready",
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const hydrated = useRef(false);
  const saving = useRef(false);

  const step = draft.step;
  const stepMeta = steps[step - 1];

  function patch(values: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...values }));
  }

  function persistLocal(next = draft, announce = true) {
    try {
      localStorage.setItem(
        localKey(session.userId, next.propertyId),
        JSON.stringify(next),
      );
      if (announce) setSaveState("local");
    } catch {}
  }

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      setNotice("Conexão restabelecida. O rascunho será sincronizado.");
    };
    const handleOffline = () => {
      setOnline(false);
      setNotice("Sem conexão. O rascunho está salvo localmente neste aparelho.");
      persistLocal();
    };
    addEventListener("online", handleOnline);
    addEventListener("offline", handleOffline);
    return () => {
      removeEventListener("online", handleOnline);
      removeEventListener("offline", handleOffline);
    };
  }, [draft]);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      if (requestedId) {
        try {
          const result = await api<{ property: RuralPropertyView }>(
            "/v1/producer/properties/" + encodeURIComponent(requestedId),
          );
          if (cancelled) return;
          const next = draftFromProperty(result.property);
          setDraft(next);
          setState("ready");
          hydrated.current = true;
          return;
        } catch {
          if (!cancelled) setState("error");
          return;
        }
      }

      try {
        const stored = localStorage.getItem(localKey(session.userId, null));
        if (stored) {
          const parsed = JSON.parse(stored) as Draft;
          setDraft({ ...blankDraft, ...parsed, propertyId: null, revision: null });
          setNotice("Rascunho local recuperado.");
        }
      } catch {}
      hydrated.current = true;
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [requestedId, session.userId]);

  useEffect(() => {
    if (!hydrated.current) return;
    persistLocal(draft, false);
  }, [draft]);

  const signature = useMemo(
    () =>
      JSON.stringify({
        step: draft.step,
        propertyId: draft.propertyId,
        revision: draft.revision,
        propertyName: draft.propertyName,
        registrationNumber: draft.registrationNumber,
        lineVicinal: draft.lineVicinal,
        ruralZoneSector: draft.ruralZoneSector,
        municipality: draft.municipality,
        latitudeSede: draft.latitudeSede,
        longitudeSede: draft.longitudeSede,
        accessDirections: draft.accessDirections,
        totalAreaHectares: draft.totalAreaHectares,
        cultivatedAreaHectares: draft.cultivatedAreaHectares,
        polygonGeojson: draft.polygonGeojson,
        waterSource: draft.waterSource,
        irrigationSystem: draft.irrigationSystem,
        activityCategory: draft.activityCategory,
        productionSystem: draft.productionSystem,
        hasWashingFacility: draft.hasWashingFacility,
      }),
    [draft],
  );

  function buildStepData(targetStep: number) {
    if (targetStep === 1) {
      return Step1IdentificationSchema.safeParse({
        propertyName: draft.propertyName,
        registrationNumber: draft.registrationNumber.trim() || null,
        lineVicinal: draft.lineVicinal,
        ruralZoneSector: draft.ruralZoneSector,
        municipality: draft.municipality,
        state: "RO",
        latitudeSede: draft.latitudeSede,
        longitudeSede: draft.longitudeSede,
        accessDirections: draft.accessDirections.trim() || null,
      });
    }
    if (targetStep === 2) {
      const boundaries = parseBoundary(draft.polygonGeojson);
      if (boundaries === null)
        return { success: false as const, error: null };
      return Step2DimensionsSchema.safeParse({
        totalAreaHectares: Number(draft.totalAreaHectares),
        cultivatedAreaHectares: Number(draft.cultivatedAreaHectares),
        boundaries,
      });
    }
    if (targetStep === 3)
      return Step3WaterSchema.safeParse({
        waterSource: draft.waterSource,
        irrigationSystem: draft.irrigationSystem,
      });
    if (targetStep === 4)
      return Step4ActivitySchema.safeParse({
        activityCategory: draft.activityCategory,
        productionSystem: draft.productionSystem,
        hasWashingFacility: draft.hasWashingFacility,
      });
    return {
      success: draft.agroecologicalCommitment,
      data: { agroecologicalCommitment: true },
      error: null,
    } as const;
  }

  async function saveStep(targetStep: number, automatic = false) {
    if (saving.current || targetStep === 5 && automatic) return false;

    const parsed = buildStepData(targetStep);
    if (!parsed.success) {
      if (!automatic)
        setNotice(
          targetStep === 2 && draft.polygonGeojson.trim()
            ? "Confira o GeoJSON. Use um Polygon fechado com coordenadas dentro de Rondônia."
            : "Preencha os campos obrigatórios desta etapa antes de continuar.",
        );
      return false;
    }

    if (!online) {
      persistLocal();
      setNotice("Sem conexão. Rascunho salvo localmente neste aparelho.");
      return false;
    }

    saving.current = true;
    setSaveState("saving");
    setNotice("");

    try {
      const payload = {
        propertyId: draft.propertyId ?? undefined,
        expectedRevision: draft.propertyId ? draft.revision ?? undefined : undefined,
        step: targetStep,
        stepData: parsed.data,
        commandId: commandId(),
      };
      const result = await api<{
        status: string;
        property: RuralPropertyView;
        nextStep: number;
      }>("/v1/producer/properties/wizard/save-step", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const next = draftFromProperty(result.property);
      next.step = targetStep === 5 ? 5 : draft.step;
      setDraft((current) => ({
        ...current,
        propertyId: next.propertyId,
        revision: next.revision,
      }));
      try {
        localStorage.removeItem(localKey(session.userId, null));
        localStorage.setItem(
          localKey(session.userId, result.property.id),
          JSON.stringify({ ...draft, propertyId: result.property.id, revision: result.property.revision }),
        );
      } catch {}
      setSaveState("saved");
      setNotice(
        targetStep === 5
          ? "Cadastro enviado para análise."
          : automatic
            ? "Rascunho salvo."
            : "Etapa salva.",
      );
      return true;
    } catch (error) {
      const failure = error as ApiFailure;
      if (failure.message === "PROPERTY_REVISION_CONFLICT" || failure.status === 409)
        setState("conflict");
      persistLocal();
      setSaveState("error");
      setNotice(messageForFailure(error));
      return false;
    } finally {
      saving.current = false;
    }
  }

  useEffect(() => {
    if (!hydrated.current || step === 5 || state !== "ready") return;
    const parsed = buildStepData(step);
    if (!parsed.success) return;
    const timer = setTimeout(() => {
      void saveStep(step, true);
    }, 2000);
    return () => clearTimeout(timer);
  }, [signature, online, state]);

  async function next() {
    const ok = await saveStep(step);
    if (!ok) return;
    if (step === 5) {
      try {
        localStorage.removeItem(localKey(session.userId, draft.propertyId));
      } catch {}
      onNavigate("/produtor/propriedades");
      return;
    }
    setDraft((current) => ({
      ...current,
      step: Math.min(5, current.step + 1),
    }));
  }

  async function continueLater() {
    persistLocal();
    if (step < 5) await saveStep(step, true);
    onNavigate("/produtor/propriedades");
  }

  if (state === "loading") {
    return (
      <section className="rural-wizard-page" aria-busy="true">
        <p className="account-notice">Carregando o rascunho do imóvel…</p>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className="rural-wizard-page">
        <div className="rural-state-card" role="alert">
          <AlertTriangle />
          <div>
            <h1>Não foi possível abrir este imóvel</h1>
            <p>O cadastro pode não existir ou não pertencer ao produtor desta sessão.</p>
          </div>
          <button className="secondary" onClick={() => onNavigate("/produtor/propriedades")}>
            Voltar aos imóveis
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rural-wizard-page">
      <header className="rural-wizard-heading">
        <button
          className="rural-back-button"
          aria-label="Voltar aos imóveis"
          onClick={() => onNavigate("/produtor/propriedades")}
        >
          <ArrowLeft />
        </button>
        <div>
          <span className="eyebrow">Cadastro de imóvel rural</span>
          <h1>{draft.propertyName || "Novo imóvel rural"}</h1>
          <p>Etapa {step} de 5 · {stepMeta[0]}</p>
        </div>
        <button className="secondary" onClick={() => void continueLater()}>
          Continuar mais tarde
        </button>
      </header>

      <div className="rural-step-progress" aria-label={`Progresso: etapa ${step} de 5`}>
        {steps.map(([title], index) => (
          <div
            key={title}
            className={
              "rural-step-dot " +
              (index + 1 < step
                ? "is-complete"
                : index + 1 === step
                  ? "is-current"
                  : "")
            }
          >
            <span>{index + 1 < step ? "✓" : index + 1}</span>
            <small>{title}</small>
          </div>
        ))}
      </div>

      {!online && (
        <div className="rural-connectivity-notice" role="status">
          <WifiOff />
          <span>Sem conexão. Alterações ficam salvas localmente até o sinal voltar.</span>
        </div>
      )}

      {state === "conflict" && (
        <div className="rural-state-card rural-conflict-state" role="alert">
          <AlertTriangle />
          <div>
            <h2>O imóvel mudou em outra sessão</h2>
            <p>Volte à lista e abra novamente para usar a revisão mais recente.</p>
          </div>
          <button className="secondary" onClick={() => onNavigate("/produtor/propriedades")}>
            Recarregar pela lista
          </button>
        </div>
      )}

      <div className="rural-wizard-card">
        <div className="rural-step-copy">
          <span>Passo {step}</span>
          <h2>{stepMeta[0]}</h2>
          <p>{stepMeta[1]}</p>
        </div>

        {step === 1 && (
          <div className="rural-form-grid">
            <label>
              Nome da propriedade ou chácara
              <input
                value={draft.propertyName}
                onChange={(event) => patch({ propertyName: event.target.value })}
                maxLength={128}
                placeholder="Ex.: Chácara Boa Colheita"
              />
            </label>
            <label>
              Inscrição / INCRA / CCIR <small>opcional</small>
              <input
                value={draft.registrationNumber}
                onChange={(event) => patch({ registrationNumber: event.target.value })}
                maxLength={64}
              />
            </label>
            <label>
              Linha vicinal / travessão
              <input
                value={draft.lineVicinal}
                onChange={(event) => patch({ lineVicinal: event.target.value })}
                maxLength={64}
                placeholder="Ex.: Linha C-65"
              />
            </label>
            <label>
              Setor rural / gleba
              <input
                value={draft.ruralZoneSector}
                onChange={(event) => patch({ ruralZoneSector: event.target.value })}
                maxLength={64}
                placeholder="Ex.: Gleba Jamari"
              />
            </label>
            <label>
              Município
              <input
                value={draft.municipality}
                onChange={(event) => patch({ municipality: event.target.value })}
                maxLength={100}
              />
            </label>
            <label>
              UF
              <input value="RO" disabled />
            </label>
            <label className="rural-wide-field">
              Orientações de acesso <small>opcional</small>
              <textarea
                value={draft.accessDirections}
                onChange={(event) => patch({ accessDirections: event.target.value })}
                maxLength={500}
                placeholder="Ex.: entrar no km 12, terceira porteira à direita"
              />
              <small>{draft.accessDirections.length}/500</small>
            </label>

            <section className="rural-map-section rural-wide-field">
              <div>
                <strong>Ponto da sede da propriedade</strong>
                <p>Toque no mapa para marcar a sede. O ponto precisa estar dentro de Rondônia.</p>
              </div>
              <OsmPinMap
                latitude={draft.latitudeSede}
                longitude={draft.longitudeSede}
                ariaLabel="Mapa para marcar a sede do imóvel rural"
                pinLabel="Sede do imóvel rural. Arraste para ajustar."
                emptyHelp="Toque no mapa para marcar a sede do imóvel rural."
                pinnedHelp="Arraste o marcador ou toque em outro ponto para ajustar a sede."
                initialCenter={{ latitude: -9.9132, longitude: -63.0408 }}
                initialZoom={11}
                onChange={(coordinates) =>
                  patch({
                    latitudeSede: coordinates.latitude,
                    longitudeSede: coordinates.longitude,
                  })
                }
              />
              {draft.latitudeSede !== null && draft.longitudeSede !== null && (
                <small>
                  {draft.latitudeSede.toFixed(6)}, {draft.longitudeSede.toFixed(6)}
                </small>
              )}
            </section>
          </div>
        )}

        {step === 2 && (
          <div className="rural-form-grid">
            <label>
              Área total (ha)
              <input
                type="number"
                inputMode="decimal"
                min="0.0001"
                step="0.0001"
                value={draft.totalAreaHectares}
                onChange={(event) => patch({ totalAreaHectares: event.target.value })}
              />
            </label>
            <label>
              Área cultivada ativa (ha)
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.0001"
                value={draft.cultivatedAreaHectares}
                onChange={(event) => patch({ cultivatedAreaHectares: event.target.value })}
              />
            </label>
            <label className="rural-wide-field">
              Perímetro GeoJSON <small>opcional</small>
              <textarea
                className="rural-geojson-input"
                value={draft.polygonGeojson}
                onChange={(event) => patch({ polygonGeojson: event.target.value })}
                placeholder={'{"type":"Polygon","coordinates":[[[-63.04,-9.91],[-63.03,-9.91],[-63.03,-9.92],[-63.04,-9.91]]]}'}
              />
              <small>
                Formato Polygon. Longitude vem antes da latitude e o anel deve ser fechado.
              </small>
            </label>
          </div>
        )}

        {step === 3 && (
          <div className="rural-form-grid">
            <label>
              Fonte principal de água
              <select
                value={draft.waterSource}
                onChange={(event) => patch({ waterSource: event.target.value })}
              >
                <option value="">Selecione</option>
                <option value="poco_artesiano">Poço artesiano</option>
                <option value="nascente_propria">Nascente própria</option>
                <option value="rio_corrego">Rio ou córrego</option>
                <option value="rede_tratada">Rede tratada</option>
              </select>
            </label>
            <label>
              Sistema de irrigação
              <select
                value={draft.irrigationSystem}
                onChange={(event) => patch({ irrigationSystem: event.target.value })}
              >
                <option value="">Selecione</option>
                <option value="gotejamento">Gotejamento</option>
                <option value="microaspersao">Microaspersão</option>
                <option value="aspersao_convencional">Aspersão convencional</option>
                <option value="nenhum">Nenhum</option>
              </select>
            </label>
          </div>
        )}

        {step === 4 && (
          <div className="rural-form-grid">
            <label>
              Atividade principal
              <select
                value={draft.activityCategory}
                onChange={(event) => patch({ activityCategory: event.target.value })}
              >
                <option value="">Selecione</option>
                <option value="hortalicas_folhosas">Hortaliças folhosas</option>
                <option value="legumes_picados">Legumes picados</option>
                <option value="frutas_tropicais">Frutas tropicais</option>
                <option value="ervas_temperos">Ervas e temperos</option>
                <option value="misto">Produção mista</option>
              </select>
            </label>
            <label>
              Sistema de produção
              <select
                value={draft.productionSystem}
                onChange={(event) => patch({ productionSystem: event.target.value })}
              >
                <option value="">Selecione</option>
                <option value="organico_certificado">Orgânico certificado</option>
                <option value="agroecologico_declarado">Agroecológico declarado</option>
                <option value="hidroponia">Hidroponia</option>
                <option value="convencional_transicao">Convencional em transição</option>
              </select>
            </label>
            <label className="account-toggle rural-wide-field">
              <input
                type="checkbox"
                checked={draft.hasWashingFacility}
                onChange={(event) => patch({ hasWashingFacility: event.target.checked })}
              />
              <span>
                O imóvel possui instalação adequada para lavagem e higienização
              </span>
            </label>
            {draft.activityCategory === "legumes_picados" && !draft.hasWashingFacility && (
              <p className="field-error rural-wide-field" role="alert">
                Para legumes picados, essa estrutura é obrigatória.
              </p>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="rural-review">
            <dl>
              <div><dt>Imóvel</dt><dd>{draft.propertyName}</dd></div>
              <div><dt>Acesso</dt><dd>{draft.lineVicinal} · {draft.ruralZoneSector}</dd></div>
              <div><dt>Município</dt><dd>{draft.municipality}/RO</dd></div>
              <div><dt>Área total</dt><dd>{draft.totalAreaHectares || "—"} ha</dd></div>
              <div><dt>Área cultivada</dt><dd>{draft.cultivatedAreaHectares || "—"} ha</dd></div>
              <div><dt>Fonte de água</dt><dd>{draft.waterSource || "—"}</dd></div>
              <div><dt>Irrigação</dt><dd>{draft.irrigationSystem || "—"}</dd></div>
              <div><dt>Atividade</dt><dd>{draft.activityCategory || "—"}</dd></div>
              <div><dt>Sistema</dt><dd>{draft.productionSystem || "—"}</dd></div>
            </dl>
            <label className="account-toggle rural-commitment">
              <input
                type="checkbox"
                checked={draft.agroecologicalCommitment}
                onChange={(event) =>
                  patch({ agroecologicalCommitment: event.target.checked })
                }
              />
              <span>
                Confirmo que revisei os dados e assumo o compromisso agroecológico declarado neste cadastro.
              </span>
            </label>
          </div>
        )}

        <footer className="rural-wizard-actions">
          <button
            className="secondary"
            disabled={step === 1 || saving.current}
            onClick={() => patch({ step: Math.max(1, step - 1) })}
          >
            Voltar
          </button>
          <div className={"rural-save-indicator is-" + saveState} aria-live="polite">
            {saveState === "saving" ? (
              <><Save /> Salvando…</>
            ) : saveState === "saved" ? (
              <><CheckCircle2 /> Rascunho salvo</>
            ) : saveState === "local" ? (
              <><WifiOff /> Rascunho salvo localmente</>
            ) : null}
          </div>
          <button
            className="primary"
            disabled={saving.current || state === "conflict"}
            onClick={() => void next()}
          >
            {step === 5 ? "Revisar e enviar" : "Salvar e continuar"}
            <ChevronRight />
          </button>
        </footer>

        {notice && (
          <p className="account-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
