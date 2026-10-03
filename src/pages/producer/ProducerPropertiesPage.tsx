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
  FileText,
  MapPinned,
  RefreshCw,
  Save,
  Sprout,
  Trash2,
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
  propertyIsViewOnly,
} from "../../../shared/contracts/ruralProperty";
import { OsmPinMap } from "../account/OsmPinMap";
import {
  DocumentsPanel,
  type PropertyDocumentSummary,
} from "../documents/DocumentsPanel";
import {
  estimatePropertyPerimeter,
  isEstimatedPerimeter,
} from "../../../shared/rural/estimatePropertyPerimeter";

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
  wizardVersion?: 6;
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
  wizardVersion: 6,
  step: 1,
  propertyName: "",
  registrationNumber: "",
  lineVicinal: "",
  ruralZoneSector: "",
  municipality: "",
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
  ["Documentos do imóvel", "Anexe e confira o CAR ou o CCIR do imóvel.", "Documentos"],
  ["Identificação e acesso", "Localize a propriedade", "Identificação"],
  ["Dimensões", "A área vem do documento", "Dimensões"],
  ["Segurança hídrica", "Escolha a fonte e a irrigação do imóvel", "Água"],
  ["Culturas e processamento", "Escolha a atividade principal", "Atividade"],
  ["Revisão e submissão", "Confira a ficha e envie para análise", "Revisão"],
] as const;

function formatHa(value: string) {
  const number = Number(value.trim().replace(",", "."));
  if (!value.trim() || !Number.isFinite(number)) return "Não informada";
  return `${number.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ha`;
}

function formatMeters(meters: number) {
  return `${Math.round(meters).toLocaleString("pt-BR")} m`;
}

function PerimeterSketch({ sideMeters }: { sideMeters: number }) {
  const label = formatMeters(sideMeters);
  return (
    <figure className="rural-perimeter-sketch">
      <svg viewBox="0 0 220 168" role="img" aria-label={`Contorno de ${label} de lado, centrado na sede`}>
        <rect x="48" y="28" width="124" height="112" rx="3" fill="#e8f5e9" stroke="#1b4d2e" strokeWidth="2" />
        <circle cx="110" cy="84" r="5" fill="#1b4d2e" />
        <text x="110" y="18" textAnchor="middle" fontSize="12" fill="#143d24" fontFamily="Inter, sans-serif">
          {label}
        </text>
        <text x="110" y="158" textAnchor="middle" fontSize="11" fill="#52645a" fontFamily="Inter, sans-serif">
          sede no centro
        </text>
      </svg>
    </figure>
  );
}

function named(value: string, labels: Record<string, string>) {
  if (!value) return "Não informado";
  return labels[value] ?? "Não informado";
}
function waterLabel(value: string) {
  return named(value, {
    poco_artesiano: "Poço artesiano",
    nascente_propria: "Nascente própria",
    rio_corrego: "Rio ou córrego",
    rede_tratada: "Rede tratada",
  });
}
function irrigationLabel(value: string) {
  return named(value, {
    gotejamento: "Gotejamento",
    microaspersao: "Microaspersão",
    aspersao_convencional: "Aspersão convencional",
    nenhum: "Nenhum",
  });
}
function activityLabel(value: string) {
  return named(value, {
    hortalicas_folhosas: "Hortaliças folhosas",
    legumes_picados: "Legumes picados",
    frutas_tropicais: "Frutas tropicais",
    ervas_temperos: "Ervas e temperos",
    misto: "Produção mista",
  });
}
function systemLabel(value: string) {
  return named(value, {
    organico_certificado: "Orgânico certificado",
    agroecologico_declarado: "Agroecológico declarado",
    hidroponia: "Hidroponia",
    convencional_transicao: "Convencional em transição",
  });
}

function commandId() {
  return crypto.randomUUID();
}

function localKey(userId: string, propertyId: string | null) {
  return `hvm:rural-property-draft:${userId}:${propertyId ?? "new"}`;
}

function statusLabel(status: RuralPropertySummary["status"]) {
  return {
    draft: "Rascunho",
    completed: "Concluído — pronto para enviar",
    submitted: "Enviado para análise",
    verified: "Verificado",
    rejected: "Revisão necessária",
    suspended: "Suspenso",
    withdrawn: "Excluído",
  }[status];
}

function isApproved(property: RuralPropertySummary) {
  if (property.status === "suspended" || property.status === "withdrawn") return false;
  return propertyIsViewOnly(property);
}

function situationLabel(property: RuralPropertySummary) {
  if (property.status === "withdrawn") return "Excluído";
  if (property.status === "suspended") return "Suspenso";
  if (
    property.status === "verified" ||
    property.queueStatus === "approved" ||
    property.reviewDecision === "approved"
  )
    return "Aprovado";
  if (property.queueStatus === "pending") return "Pendente";
  if (property.queueStatus === "claimed" || property.queueStatus === "in_review")
    return "Em análise";
  if (property.reviewDecision === "adjustments_required")
    return "Devolvido para correção";
  if (property.reviewDecision === "rejected" || property.status === "rejected")
    return "Recusado";
  return statusLabel(property.status);
}

function messageForFailure(error: unknown) {
  const failure = error as ApiFailure;
  if (failure.message === "RECENT_AUTH_REQUIRED")
    return "Confirme sua senha abaixo para continuar. Seu rascunho está preservado.";
  if (failure.message === "PROPERTY_NOT_EDITABLE")
    return "Este imóvel está aprovado. Você pode apenas visualizar.";
  if (failure.message === "PROPERTY_STATUS_CONFLICT")
    return "A exclusão da aprovação ainda não foi aplicada no banco. O imóvel continua só para visualização.";
  if (failure.message === "PROPERTY_REVISION_CONFLICT" || failure.status === 409)
    return "Este imóvel foi alterado em outra sessão. Recarregue os dados antes de continuar.";
  if (failure.message === "PROPERTY_INCOMPLETE")
    return "Complete as etapas anteriores antes de enviar o imóvel.";
  if (failure.message === "PROPERTY_DOCUMENTS_REQUIRED")
    return "Envie o CAR ou o CCIR do imóvel antes de mandar para análise.";
  if (failure.message === "PROPERTY_DOCUMENT_DATA_REQUIRED")
    return "Volte à etapa 1, abra o CAR ou CCIR e salve os dados documentais conferidos.";
  if (failure.message === "WASHING_FACILITY_REQUIRED")
    return "Legumes picados exigem uma instalação adequada para lavagem e higienização.";
  if (failure.message === "PROPERTY_ACTIVITY_REQUIRED")
    return "Escolha a atividade principal do imóvel antes de continuar.";
  if (failure.message === "PRODUCER_NOT_APPROVED")
    return "A loja e a publicação de produtos ficam disponíveis depois da aprovação do imóvel.";
  if (failure.status === 0)
    return "Sem conexão com o servidor. O rascunho desta etapa foi mantido neste aparelho.";
  if (failure.status && failure.status >= 500)
    return "O serviço de cadastro está temporariamente indisponível. O rascunho desta etapa foi mantido neste aparelho.";
  return `A etapa não foi aceita pelo servidor (${failure.message || "erro desconhecido"}). Confira os dados e tente novamente; o rascunho local foi mantido.`;
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

  const base: Draft = {
    wizardVersion: 6,
    step: Math.min(6, Math.max(1, property.wizardCurrentStep)),
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
    propertyId: property.id,
    revision: property.revision,
  };
  const extra = property.draftData;
  if (!extra || typeof extra !== "object") return base;
  for (const [key, value] of Object.entries(extra)) {
    if (!(key in base) || key === "propertyId" || key === "revision") continue;
    if (typeof value === "string") {
      if (!value.trim()) continue;
      if (key === "propertyName" && /^im[oó]vel sem nome/i.test(value)) continue;
      if (
        key === "municipality" &&
        value.trim() === "Ariquemes" &&
        base.municipality &&
        base.municipality !== "Ariquemes"
      )
        continue;
      (base as Record<string, unknown>)[key] = value;
    } else if (value != null) {
      (base as Record<string, unknown>)[key] = value;
    }
  }
  return base;
}

function preferText(server: string, local: string) {
  const next = server.trim();
  return next || local.trim();
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
  const [listNotice,setListNotice]=useState("");
  const [busyId,setBusyId]=useState<string|null>(null);
  const [properties, setProperties] = useState<RuralPropertySummary[]>([]);

  async function load(background = false) {
    if (!background) setState("loading");
    try {
      const result = await api<{ properties: RuralPropertySummary[] }>(
        "/v1/producer/properties",
      );
      setProperties(result.properties);
      setState(result.properties.length ? "ready" : "empty");
    } catch {
      if (!background) setState("error");
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 12000);
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [session.userId]);

  async function deleteDraft(property:RuralPropertySummary){
    if(!confirm("Excluir este rascunho? Esta ação não pode ser desfeita."))return;
    setBusyId(property.id);setListNotice("");
    try{await api("/v1/producer/properties/"+property.id,{method:"DELETE",body:JSON.stringify({expectedRevision:property.revision,commandId:commandId()})});localStorage.removeItem(localKey(session.userId,property.id));await load();}
    catch(e){setListNotice((e as ApiFailure).message==="PROPERTY_HAS_DOCUMENTS"?"Este rascunho possui documentos com histórico de custódia e não pode ser excluído.":(e as ApiFailure).message==="RECENT_AUTH_REQUIRED"?"Entre novamente para confirmar a exclusão. Seu rascunho está salvo.":"Não foi possível excluir. Somente rascunhos nunca concluídos podem ser excluídos.");}finally{setBusyId(null);}
  }
  async function withdrawApproved(property: RuralPropertySummary) {
    if (!confirm("Se você excluir esta propriedade, perde a aprovação de produtor. Será preciso cadastrar uma nova propriedade e passar por uma nova aprovação.")) return;
    setBusyId(property.id);
    setListNotice("");
    try {
      await api("/v1/producer/properties/" + property.id + "/withdraw", {
        method: "POST",
        body: JSON.stringify({ expectedRevision: property.revision, commandId: commandId() }),
      });
      localStorage.removeItem(localKey(session.userId, property.id));
      await load();
    } catch (e) {
      setListNotice(messageForFailure(e));
    } finally {
      setBusyId(null);
    }
  }
  async function submitCompleted(property: RuralPropertySummary) {
    setBusyId(property.id);setListNotice("");
    try{await api("/v1/producer/properties/"+property.id+"/submit",{method:"POST",body:JSON.stringify({expectedRevision:property.revision,commandId:commandId(),agroecologicalCommitment:true})});await load();}
    catch(e){setListNotice(messageForFailure(e));}finally{setBusyId(null);}
  }

  return (
    <section className="rural-properties-page">
      <header className="account-detail-top rural-page-heading">
        <button
          className="rural-back-button"
          aria-label="Voltar para a conta"
          onClick={() => onNavigate("/conta")}
        >
          <ArrowLeft />
        </button>
        <div>
          <span className="eyebrow">Imóveis rurais</span>
          <h1>Meus imóveis rurais</h1>
        </div>
      </header>
      <p className="rural-page-lead">
        Cadastre cada propriedade produtiva separadamente. Seus endereços
        pessoais continuam em Minha conta.
      </p>
      {(state === "ready" || state === "empty") &&
        !properties.some(isApproved) && (
          <section className="rural-onboarding-guide" aria-labelledby="rural-onboarding-title">
            <h2 id="rural-onboarding-title">
              {properties.some((property) =>
                ["submitted", "verified"].includes(property.status) ||
                ["pending", "claimed", "in_review"].includes(property.queueStatus ?? ""),
              )
                ? "Seu imóvel está aguardando aprovação"
                : "Seu perfil ainda não está aprovado"}
            </h2>
            <ol>
              <li>Você está em <strong>Imóveis rurais</strong>, onde cada propriedade é cadastrada separadamente.</li>
              <li>
                {properties.some((property) => property.status === "draft")
                  ? "Continue o rascunho existente ou inicie outro imóvel."
                  : "Inicie um imóvel; a etapa 1 orienta o envio do CAR ou CCIR."}
              </li>
            </ol>
            {(() => {
              const draftProperty = properties.find((property) => property.status === "draft");
              return draftProperty ? (
                <button
                  type="button"
                  className="primary rural-onboarding-action"
                  onClick={() =>
                    onNavigate(
                      "/produtor/propriedades/novo?id=" + draftProperty.id +
                        "&step=" + Math.min(Math.max(draftProperty.wizardCurrentStep, 1), 6),
                    )
                  }
                >
                  Continuar cadastro do imóvel
                </button>
              ) : (
                <p className="rural-onboarding-action">
                  Use o botão <strong>Novo imóvel rural</strong> logo acima para iniciar.
                </p>
              );
            })()}
          </section>
        )}
      <button
        className="primary rural-primary-action"
        onClick={() => onNavigate("/produtor/propriedades/novo")}
      >
        <Sprout />
        Novo imóvel rural
      </button>

      {listNotice && <p className="account-notice" role="alert">{listNotice}</p>}
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
                <div className="rural-property-badge-wrap">
                  <span className="rural-property-icon" aria-hidden="true">
                    <MapPinned size={20} />
                  </span>
                  <div>
                    <h2>{property.propertyName || "Imóvel sem nome — rascunho"}</h2>
                    <p className="rural-property-location">
                      {property.lineVicinal} · {property.municipality}/{property.state}
                    </p>
                  </div>
                </div>
                <span className={"rural-status-badge is-" + property.status}>
                  {situationLabel(property)}
                </span>
              </div>

              <div className="rural-property-progress-section">
                <div className="rural-progress-header">
                  <small>Etapa {property.wizardCurrentStep} de 6</small>
                </div>
                <div className="rural-progress-line" aria-label={`Etapa ${property.wizardCurrentStep} de 6`}>
                  <span style={{ width: `${(property.wizardCurrentStep / 6) * 100}%` }} />
                </div>
              </div>

              <div className="rural-property-card-actions">
                {property.status === "completed" && (
                  <button
                    className="primary rural-submit-btn"
                    disabled={busyId === property.id}
                    onClick={() => void submitCompleted(property)}
                  >
                    Enviar para análise
                  </button>
                )}

                {isApproved(property) ? (
                  <button
                    className="primary"
                    onClick={() =>
                      onNavigate(
                        "/produtor/propriedades/novo?id=" +
                          encodeURIComponent(property.id),
                      )
                    }
                  >
                    Visualizar cadastro
                    <ChevronRight size={18} />
                  </button>
                ) : property.status !== "suspended" ? (
                  <button
                    className={property.status === "completed" ? "secondary" : "primary"}
                    onClick={() =>
                      onNavigate(
                        "/produtor/propriedades/novo?id=" +
                          encodeURIComponent(property.id),
                      )
                    }
                  >
                    {property.reviewDecision === "adjustments_required" || property.status === "rejected"
                      ? "Corrigir cadastro"
                      : property.status === "draft"
                        ? "Continuar cadastro"
                        : "Editar cadastro"}
                    <ChevronRight size={18} />
                  </button>
                ) : (
                  <p className="rural-readonly-note">
                    Cadastro suspenso para edição.
                  </p>
                )}

                <div className="rural-property-subactions">
                  <button
                    className="secondary rural-docs-btn"
                    onClick={() => onNavigate("/produtor/propriedades/novo?id=" + property.id + "&step=1")}
                  >
                    <FileText size={16} />
                    Documentos do imóvel
                  </button>

                  {property.status === "draft" && !property.completedAt && (
                    <button
                      className="secondary rural-delete-btn"
                      disabled={busyId === property.id}
                      onClick={() => void deleteDraft(property)}
                    >
                      <Trash2 size={16} />
                      Excluir rascunho
                    </button>
                  )}
                  {isApproved(property) && (
                    <button
                      className="secondary rural-delete-btn"
                      disabled={busyId === property.id}
                      onClick={() => void withdrawApproved(property)}
                    >
                      <Trash2 size={16} />
                      Excluir propriedade
                    </button>
                  )}
                </div>
              </div>

              {property.reviewOpinion &&
                (property.reviewDecision === "adjustments_required" ||
                  property.reviewDecision === "rejected" ||
                  property.queueStatus === "pending") && (
                <div className="rural-review-note">
                  <strong>
                    {property.queueStatus === "pending"
                      ? "Este imóvel já passou por análise. Parecer anterior"
                      : "Parecer técnico — o que corrigir"}
                  </strong>
                  <p>{property.reviewOpinion}</p>
                </div>
              )}

              {property.status === "completed" && (
                <small className="rural-helper-note">
                  O envio leva o cadastro e os documentos já com os dados preenchidos, só para verificação e aprovação.
                </small>
              )}
              {property.completedAt && !isApproved(property) && (
                <small className="rural-helper-note">
                  Já concluído: não pode ser excluído. Edições exigem nova análise.
                </small>
              )}
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
  const [requestedId] = useState(() =>
    typeof location === "undefined"
      ? null
      : new URLSearchParams(location.search).get("id"),
  );
  const [requestedStep] = useState(() => {
    if (typeof location === "undefined") return null;
    const value = Number(new URLSearchParams(location.search).get("step"));
    return Number.isInteger(value) && value >= 1 && value <= 6 ? value : null;
  });
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [state, setState] = useState<PageState>(
    requestedId ? "loading" : "ready",
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [notice, setNotice] = useState("");
  const [reauth, setReauth] = useState(false);
  const [password, setPassword] = useState("");
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [accountCpf, setAccountCpf] = useState("");
  const [documents, setDocuments] = useState<PropertyDocumentSummary[]>([]);
  const [documentsReady, setDocumentsReady] = useState(false);
  const hydrated = useRef(false);
  const saving = useRef(false);
  const dirty = useRef(false);
  const editVersion = useRef(0);
  const pendingSave = useRef<{ payload: Record<string, unknown>; version: number } | null>(null);
  const viewOnlyRef = useRef(false);
  const activityTouched = useRef(false);
  const activityDefaultRequested = useRef(false);
  const [viewOnly, setViewOnly] = useState(false);
  viewOnlyRef.current = viewOnly;

  const step = draft.step;
  const stepMeta = steps[step - 1];

  function patch(values: Partial<Draft>) {
    if (Object.prototype.hasOwnProperty.call(values, "activityCategory"))
      activityTouched.current = true;
    dirty.current = true;
    editVersion.current += 1;
    setSaveState((current) => current === "error" ? "idle" : current);
    setDraft((current) => ({ ...current, ...values }));
  }

  function persistLocal(next = draft, announce = true) {
    if (viewOnlyRef.current) return;
    try {
      localStorage.setItem(
        localKey(session.userId, next.propertyId),
        JSON.stringify(next),
      );
      if (announce) setSaveState("local");
    } catch {}
  }

  function updateDocumentReadiness(result: {
    documents: PropertyDocumentSummary[];
    requiredReady: boolean;
  }) {
    setDocuments(result.documents);
    setDocumentsReady(result.requiredReady);
    const extracted = result.documents.find(
      (document) =>
        document.status === "clean" &&
        document.dataSaved &&
        (document.extractionStatus === "completed" ||
          document.extractionStatus === "flagged_discrepancy"),
    )?.extractedData;
    if (!extracted) return;
    setDraft((current) => {
      const next = {
        ...current,
        propertyName: preferText(current.propertyName, extracted.propertyRegisteredName),
        registrationNumber: preferText(
          current.registrationNumber,
          extracted.carNumber || extracted.ccirNumber,
        ),
        municipality: preferText(current.municipality, extracted.municipality),
        totalAreaHectares: preferText(
          current.totalAreaHectares,
          extracted.totalAreaHectares,
        ),
      };
      if (
        next.propertyName === current.propertyName &&
        next.registrationNumber === current.registrationNumber &&
        next.municipality === current.municipality &&
        next.totalAreaHectares === current.totalAreaHectares
      )
        return current;
      dirty.current = true;
      editVersion.current += 1;
      return next;
    });
  }

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      setSaveState("idle");
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
    void api<{ fullName?: string; cpfMasked?: string }>("/v1/account/profile")
      .then((profile) => {
        if (!cancelled && profile.cpfMasked) setAccountCpf(profile.cpfMasked);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      if (requestedId) {
        try {
          const result = await api<{ property: RuralPropertyView }>(
            "/v1/producer/properties/" + encodeURIComponent(requestedId),
          );
          if (cancelled) return;
          const locked = propertyIsViewOnly(result.property);
          viewOnlyRef.current = locked;
          setViewOnly(locked);
          if (locked) {
            try { localStorage.removeItem(`hvm:rural-pending:${session.userId}:${requestedId}`); } catch {}
            const lockedDraft = draftFromProperty(result.property);
            setDraft(
              requestedStep
                ? { ...lockedDraft, step: requestedStep }
                : lockedDraft,
            );
            dirty.current = false;
            setNotice(result.property.status === "suspended"
              ? "Este imóvel está suspenso. Você pode ver as etapas, mas não alterar os dados."
              : "Este imóvel está aprovado. A visualização não salva nada: ao entrar e sair, o cadastro continua igual.");
            setState("ready");
            hydrated.current = true;
            return;
          }
          let next = draftFromProperty(result.property);
          let conflict = false;
          try {
            const raw = localStorage.getItem(localKey(session.userId, requestedId));
            const stored = raw ? JSON.parse(raw) as Draft : null;
            if (stored?.propertyId === requestedId && stored.step >= 1 && stored.step <= 6) {
              const server = next;
              const localRevisionIsCurrent =
                stored.revision === result.property.revision;
              const preferDraftText = (serverValue: string, localValue: string) =>
                localRevisionIsCurrent
                  ? preferText(localValue, serverValue)
                  : preferText(serverValue, localValue);
              next = {
                ...server,
                wizardVersion: 6,
                step: stored.wizardVersion === 6
                  ? stored.step
                  : Math.min(6, stored.step + 1),
                lineVicinal: stored.lineVicinal.trim() ? stored.lineVicinal : server.lineVicinal,
                ruralZoneSector: stored.ruralZoneSector.trim() ? stored.ruralZoneSector : server.ruralZoneSector,
                accessDirections: stored.accessDirections.trim() ? stored.accessDirections : server.accessDirections,
                polygonGeojson: stored.polygonGeojson.trim() ? stored.polygonGeojson : server.polygonGeojson,
                waterSource: stored.waterSource || server.waterSource,
                irrigationSystem: stored.irrigationSystem || server.irrigationSystem,
                activityCategory: stored.activityCategory || server.activityCategory,
                productionSystem: stored.productionSystem || server.productionSystem,
                hasWashingFacility: stored.hasWashingFacility,
                propertyName: preferDraftText(server.propertyName, stored.propertyName),
                municipality: preferDraftText(server.municipality, stored.municipality),
                registrationNumber: preferDraftText(server.registrationNumber, stored.registrationNumber),
                totalAreaHectares: preferDraftText(server.totalAreaHectares, stored.totalAreaHectares),
                cultivatedAreaHectares: preferDraftText(server.cultivatedAreaHectares, stored.cultivatedAreaHectares),
                latitudeSede: localRevisionIsCurrent
                  ? stored.latitudeSede ?? server.latitudeSede
                  : server.latitudeSede ?? stored.latitudeSede,
                longitudeSede: localRevisionIsCurrent
                  ? stored.longitudeSede ?? server.longitudeSede
                  : server.longitudeSede ?? stored.longitudeSede,
                state: "RO",
                revision: server.revision,
                propertyId: server.propertyId,
              };
              dirty.current = localRevisionIsCurrent;
              setNotice(
                localRevisionIsCurrent
                  ? "Rascunho local recuperado."
                  : "O documento atualizou nome, município, área e o ponto no mapa. Confira as etapas. Nome e CPF continuam os da sua conta.",
              );
            }
          } catch {}
          if (requestedStep) next.step = requestedStep;
          setDraft(next);
          setState(conflict ? "conflict" : "ready");
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
          setDraft({
            ...blankDraft,
            ...parsed,
            wizardVersion: 6,
            step:
              parsed.wizardVersion === 6
                ? parsed.step
                : Math.min(6, parsed.step + 1),
            propertyId: null,
            revision: null,
          });
          dirty.current = true;
          setNotice("Rascunho local recuperado.");
        }
      } catch {}
      hydrated.current = true;
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [requestedId, requestedStep, session.userId]);

  useEffect(() => {
    if (
      !hydrated.current ||
      requestedId ||
      draft.activityCategory ||
      activityTouched.current ||
      activityDefaultRequested.current
    )
      return;
    activityDefaultRequested.current = true;
    let cancelled = false;
    void api<{ activityCategory: string | null }>(
      "/v1/producer/properties/activity-default",
    )
      .then(({ activityCategory }) => {
        if (!activityCategory || cancelled || activityTouched.current) return;
        setDraft((current) =>
          current.activityCategory || activityTouched.current
            ? current
            : { ...current, activityCategory },
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [draft.activityCategory, requestedId]);

  useEffect(() => {
    if (!hydrated.current || viewOnlyRef.current) return;
    const hectares = Number(draft.totalAreaHectares.trim().replace(",", "."));
    const estimate =
      draft.latitudeSede != null && draft.longitudeSede != null && hectares > 0
        ? estimatePropertyPerimeter(draft.latitudeSede, draft.longitudeSede, hectares)
        : null;
    const raw = draft.polygonGeojson.trim();
    let nextJson = raw;
    if (estimate && (!raw || isEstimatedPerimeter(raw) || parseBoundary(raw) === null))
      nextJson = estimate.json;
    else if (raw && parseBoundary(raw) === null) nextJson = "";
    if (nextJson === raw) return;
    try {
      if (raw && JSON.stringify(JSON.parse(raw)) === nextJson) return;
    } catch {}
    dirty.current = true;
    setDraft((current) =>
      current.polygonGeojson.trim() === raw ? { ...current, polygonGeojson: nextJson } : current,
    );
  }, [draft.latitudeSede, draft.longitudeSede, draft.totalAreaHectares, draft.polygonGeojson]);

  useEffect(() => {
    if (!hydrated.current || viewOnlyRef.current) return;
    persistLocal(draft, false);
  }, [draft]);

  const signature = useMemo(
    () =>
      JSON.stringify({
        step: draft.step,
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
      return {
        success: documentsReady,
        data: { documentsProcessed: documentsReady },
        error: null,
      } as const;
    }
    if (targetStep === 2) {
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
    if (targetStep === 3) {
      if (
        !draft.totalAreaHectares.trim() ||
        !draft.cultivatedAreaHectares.trim()
      )
        return { success: false as const, error: null };
      const boundaries = parseBoundary(draft.polygonGeojson);
      if (boundaries === null)
        return { success: false as const, error: null };
      return Step2DimensionsSchema.safeParse({
        totalAreaHectares: Number(draft.totalAreaHectares),
        cultivatedAreaHectares: Number(draft.cultivatedAreaHectares),
        boundaries,
      });
    }
    if (targetStep === 4)
      return Step3WaterSchema.safeParse({
        waterSource: draft.waterSource,
        irrigationSystem: draft.irrigationSystem,
      });
    if (targetStep === 5)
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

  const pendingKey=`hvm:rural-pending:${session.userId}:${draft.propertyId??requestedId??"new"}`;
  const pendingDraft=useRef<{payload:Record<string,unknown>;version:number}|null>(null);
  const pendingLoaded=useRef(false);
  if(!pendingLoaded.current){pendingLoaded.current=true;try{const stored=JSON.parse(localStorage.getItem(pendingKey)||"null");if(stored?.payload?.commandId)pendingDraft.current={payload:stored.payload,version:-1};}catch{}}

  async function saveStep(_targetStep:number, automatic=false){
    if (viewOnlyRef.current) return false;
    if(saving.current || state!=="ready")return false;
    if(!online){persistLocal();return false;}
    saving.current=true;setSaveState("saving");
    const {propertyId,revision,...data}=draft;
    delete data.wizardVersion;
    const attempt=pendingDraft.current ?? {version:editVersion.current,payload:{propertyId:propertyId??undefined,expectedRevision:propertyId?revision:undefined,commandId:commandId(),draft:data}};
    pendingDraft.current=attempt;
    try{localStorage.setItem(pendingKey,JSON.stringify(attempt));}catch{}
    try{
      const result=await api<{property:RuralPropertyView}>("/v1/producer/properties/wizard/draft",{method:"POST",body:JSON.stringify(attempt.payload)});
      pendingDraft.current=null;try{localStorage.removeItem(pendingKey);}catch{}
      const changed=editVersion.current!==attempt.version;
      setDraft(current=>({...current,propertyId:result.property.id,revision:result.property.revision}));
      history.replaceState(history.state,"","/produtor/propriedades/novo?id="+result.property.id);
      localStorage.removeItem(localKey(session.userId,null));
      persistLocal({...draft,propertyId:result.property.id,revision:result.property.revision},false);
      dirty.current=changed;setSaveState("saved");if(!automatic)setNotice("Rascunho salvo na sua conta.");return !changed;
    }catch(e){const failure=e as ApiFailure;if(failure.status && failure.status>=400 && failure.status<500){pendingDraft.current=null;try{localStorage.removeItem(pendingKey);}catch{}}if(failure.status===409)setState("conflict");persistLocal();setSaveState("error");setNotice(messageForFailure(e));return false;}
    finally{saving.current=false;}
  }

  useEffect(() => {
    if (
      !hydrated.current ||
      viewOnlyRef.current ||
      !dirty.current ||
      state !== "ready" ||
      saveState === "saving" || saveState === "error"
    )
      return;
    const timer = setTimeout(() => {
      void saveStep(step, true);
    }, 2000);
    return () => clearTimeout(timer);
  }, [signature, online, state, saveState]);

  async function submitAll(completeOnly=false) {
    const missing = [1,2,3,4,5].filter(n => !buildStepData(n).success);
    if (missing.length || !draft.agroecologicalCommitment) {
      setNotice(missing.length ? "Complete as etapas pendentes: " + missing.join(", ") + ". Você pode voltar a elas pelos botões acima." : "Confirme o compromisso antes de enviar.");
      return;
    }
    if (!online) { persistLocal(); setNotice("Conecte-se à internet para enviar o imóvel."); return; }
    if (saving.current || state !== "ready") return;
    if(pendingDraft.current){setNotice("Salve o rascunho novamente antes de concluir.");return;}
    saving.current = true; setSaveState("saving"); setNotice("");
    let propertyId = draft.propertyId, revision = draft.revision;
    async function send(payload: Record<string,unknown>) {
      pendingSave.current = {payload,version:editVersion.current};
      const result = await api<{property:RuralPropertyView}>("/v1/producer/properties/wizard/save-step",{method:"POST",body:JSON.stringify(payload)});
      pendingSave.current = null;
      propertyId=result.property.id;revision=result.property.revision;
      setDraft(current=>({...current,propertyId,revision}));
      persistLocal({...draft,propertyId,revision},false);
      history.replaceState(history.state,"","/produtor/propriedades/novo?id="+propertyId);
    }
    try {
      // Recover an uncertain response with its original command before sending new edits.
      if (pendingSave.current) await send(pendingSave.current.payload);
      for (const n of [2,3,4,5,6]) {
        const parsed=buildStepData(n);
        if (!parsed.success) throw new Error("PROPERTY_INCOMPLETE");
        await send({propertyId:propertyId??undefined,expectedRevision:propertyId?revision:undefined,step:n,stepData:parsed.data,completeOnly:n===6?completeOnly:undefined,commandId:commandId()});
      }
      try {localStorage.removeItem(localKey(session.userId,null));localStorage.removeItem(localKey(session.userId,propertyId))}catch{}
      dirty.current=false;setSaveState("saved");onNavigate("/produtor/propriedades");
    } catch(error) {
      const failure=error as ApiFailure;
      if(failure.message==="RECENT_AUTH_REQUIRED")setReauth(true);
      if(failure.status && failure.status>=400 && failure.status<500)pendingSave.current=null;
      if(failure.status===409)setState("conflict");
      setSaveState("error");setNotice(messageForFailure(error));
    } finally {saving.current=false;}
  }

  async function next() {
    if (viewOnlyRef.current) {
      if (step === 6) { onNavigate("/produtor/propriedades"); return; }
      setDraft((current) => ({ ...current, step: Math.min(6, current.step + 1) }));
      return;
    }
    if (step===6) {await submitAll();return;}
    if (saving.current) return;
    const valid=buildStepData(step).success;
    if (step === 1 && !valid) {
      setNotice("Anexe e processe um CAR ou CCIR, confira os dados documentais e salve-os antes de avançar.");
      return;
    }
    await saveStep(step);
    setNotice(valid ? "" : "Etapa com pendências. Você pode voltar para completar antes de enviar.");
    setDraft(current=>({...current,step:Math.min(6,current.step+1)}));
  }

  async function confirmPassword() {
    if(!password)return;
    try {
      const response=await api<ShellSession>("/v1/auth/login",{method:"POST",body:JSON.stringify({email:session.email,password,portalRole:"producer"})});
      if(response.userId!==session.userId)throw new Error("IDENTITY_MISMATCH");
      setPassword("");setReauth(false);setSaveState("idle");setNotice("Identidade confirmada. Clique novamente em enviar para concluir.");
    }catch{setNotice("Não foi possível confirmar sua senha. Confira e tente novamente.");}
  }

  async function continueLater() {
    if (viewOnlyRef.current) { onNavigate("/produtor/propriedades"); return; }
    persistLocal();
    const saved=await saveStep(step, true);
    if(!saved){setNotice("O rascunho permanece neste aparelho. Tente salvar novamente antes de sair.");return;}
    onNavigate("/produtor/propriedades");
  }

  const areaHectares = Number(draft.totalAreaHectares.trim().replace(",", "."));
  const estimatedPerimeter =
    draft.latitudeSede != null && draft.longitudeSede != null && areaHectares > 0
      ? estimatePropertyPerimeter(draft.latitudeSede, draft.longitudeSede, areaHectares)
      : null;
  const storedPerimeter = draft.polygonGeojson.trim();
  const showingEstimate =
    estimatedPerimeter != null &&
    (!storedPerimeter || isEstimatedPerimeter(storedPerimeter));

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
      <header className="account-detail-top rural-wizard-heading">
        <button
          className="rural-back-button"
          aria-label="Voltar aos imóveis"
          onClick={() => onNavigate("/produtor/propriedades")}
        >
          <ArrowLeft />
        </button>
        <div>
          <span className="eyebrow">Cadastro do imóvel</span>
          <h1>{draft.propertyName || "Novo imóvel rural"}</h1>
        </div>
      </header>
      <div className="rural-wizard-tools">
        <p>Etapa {step} de 6</p>
        <button className="secondary" disabled={saving.current} onClick={() => void continueLater()}>
          {viewOnly ? "Voltar aos imóveis" : "Continuar mais tarde"}
        </button>
      </div>

      <nav className="rural-step-progress account-section-nav" aria-label={`Progresso: etapa ${step} de 6`}>
        {steps.map(([title, , pill], index) => (
          <button
            type="button"
            disabled={saving.current}
            onClick={() => viewOnly ? setDraft((current) => ({ ...current, step: index + 1 })) : patch({ step: index + 1 })}
            aria-label={`Etapa ${index+1}: ${title}${buildStepData(index+1).success ? ", completa" : ", pendente"}`}
            key={title}
            className={
              "rural-step-dot" +
              (index + 1 === step
                ? " active is-current"
                : buildStepData(index + 1).success
                  ? " is-complete"
                  : "")
            }
          >
            <span>{buildStepData(index+1).success ? "✓" : index + 1}</span>
            <small>{pill}</small>
          </button>
        ))}
      </nav>

      <p className="account-notice rural-pending-steps" role="status">
        {(() => {
          const pending = [1, 2, 3, 4, 5, 6].filter((n) => !buildStepData(n).success);
          if (!pending.length) return "Todas as etapas estão completas.";
          return (
            <>
              Etapas pendentes:{" "}
              {pending.map((n, i) => (
                <span key={n}>
                  <button
                    type="button"
                    className="rural-pending-link"
                    aria-label={`Ir para a etapa ${n}: ${steps[n - 1][0]}`}
                    onClick={() => viewOnly ? setDraft((c) => ({ ...c, step: n })) : patch({ step: n })}
                  >
                    {n}
                  </button>
                  {i < pending.length - 2 ? ", " : i === pending.length - 2 ? " e " : ""}
                </span>
              ))}
              . Toque em uma etapa para continuar o preenchimento.
            </>
          );
        })()}
      </p>

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
            <h2>O cadastro foi atualizado</h2>
            <p>Confira os dados reconhecidos pelo documento e continue o preenchimento das demais seções.</p>
          </div>
          <button className="secondary" onClick={() => {
            try { localStorage.removeItem(localKey(session.userId, draft.propertyId)); } catch {}
            onNavigate("/produtor/propriedades");
          }}>
            Descartar rascunho deste aparelho
          </button>
        </div>
      )}

      {reauth && <div className="rural-state-card" role="alert"><label>Confirme sua senha para salvar<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="secondary" onClick={()=>void confirmPassword()}>Confirmar senha</button></div>}
      {step !== 1 && draft.propertyId && (
        <div hidden>
          <DocumentsPanel
            propertyId={draft.propertyId}
            embedded
            readOnly={viewOnly}
            onReadinessChange={({ documents: nextDocuments, requiredReady }) => {
              updateDocumentReadiness({ documents: nextDocuments, requiredReady });
            }}
          />
        </div>
      )}
      <div className="account-panel rural-wizard-card" inert={step===6 && saveState==="saving" ? true : undefined}>
        <div className="account-section-intro rural-step-copy">
          <span>Passo {step}</span>
          <h2>{stepMeta[0]}</h2>
          <p>{stepMeta[1]}</p>
        </div>

        <fieldset className="rural-lock" disabled={viewOnly && step !== 1} inert={viewOnly && step !== 1 ? true : undefined}>
        {step === 1 && (
        <div className="rural-form-grid rural-document-step">
          {draft.propertyId ? (
            <DocumentsPanel
              propertyId={draft.propertyId}
              embedded
              readOnly={viewOnly}
              onReadinessChange={({ documents: nextDocuments, requiredReady }) => {
                updateDocumentReadiness({ documents: nextDocuments, requiredReady });
              }}
            />
          ) : (
            <div className="rural-document-start rural-wide-field">
              <FileText aria-hidden="true" />
              <div>
                <h3>Comece anexando o CAR ou CCIR</h3>
                <p>O sistema cria um rascunho seguro para guardar os documentos deste imóvel.</p>
              </div>
              <button
                type="button"
                className="primary"
                disabled={!online || saving.current}
                onClick={() => void saveStep(1, true)}
              >
                Iniciar etapa de documentos
              </button>
            </div>
          )}
          {documents.length > 0 && (
            <p className="rural-document-readiness rural-wide-field" role="status">
              {documentsReady
                ? "Documento CAR/CCIR processado e dados documentais salvos."
                : "Para avançar, processe um CAR ou CCIR e salve os dados documentais obrigatórios."}
            </p>
          )}
        </div>
        )}

        {step === 2 && (
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
                onChange={(coordinates) => {
                  if (viewOnly) return;
                  patch({
                    latitudeSede: coordinates.latitude,
                    longitudeSede: coordinates.longitude,
                  });
                }}
              />
              {draft.latitudeSede !== null && draft.longitudeSede !== null && (
                <small>
                  {draft.latitudeSede.toFixed(6)}, {draft.longitudeSede.toFixed(6)}
                </small>
              )}
            </section>
          </div>
        )}

        {step === 3 && (
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
            {areaHectares > 0 &&
              Number(draft.cultivatedAreaHectares.replace(",", ".")) > areaHectares && (
              <p className="field-error rural-wide-field" role="alert">
                A área cultivada não pode ser maior que a área total.
              </p>
            )}
            <article className="rural-dimension-sheet rural-wide-field" aria-label="Ficha de dimensões">
              <div className="rural-dimension-head">
                <span className="rural-property-icon" aria-hidden="true">
                  <MapPinned size={20} />
                </span>
                <div>
                  <strong>Ficha de dimensões</strong>
                  <p>Gerada com a área e o ponto da sede. O produtor não desenha mapa nem cola código.</p>
                </div>
              </div>
              <dl>
                <div><dt>Área total</dt><dd>{formatHa(draft.totalAreaHectares)}</dd></div>
                <div><dt>Área cultivada</dt><dd>{formatHa(draft.cultivatedAreaHectares)}</dd></div>
                <div>
                  <dt>Sede</dt>
                  <dd>
                    {draft.latitudeSede != null && draft.longitudeSede != null
                      ? `${draft.latitudeSede.toFixed(5)}, ${draft.longitudeSede.toFixed(5)}`
                      : "Ainda não marcada"}
                  </dd>
                </div>
                <div>
                  <dt>Contorno</dt>
                  <dd>
                    {showingEstimate && estimatedPerimeter
                      ? `Quadrado de ${formatMeters(estimatedPerimeter.sideMeters)} de lado · volta de ${formatMeters(estimatedPerimeter.perimeterMeters)}`
                      : storedPerimeter && parseBoundary(storedPerimeter)
                        ? "Perímetro já registrado neste cadastro"
                        : "Informe a área e a sede para o sistema desenhar"}
                  </dd>
                </div>
              </dl>
              {showingEstimate && estimatedPerimeter ? (
                <PerimeterSketch sideMeters={estimatedPerimeter.sideMeters} />
              ) : draft.latitudeSede == null || draft.longitudeSede == null ? (
                <button type="button" className="secondary" onClick={() => patch({ step: 2 })}>
                  Marcar a sede no mapa
                </button>
              ) : null}
              <p className="rural-readonly-note">
                O contorno é a área total em volta da sede, para a ficha do cadastro. O polígono oficial continua no PDF do CAR.
              </p>
            </article>
          </div>
        )}

        {step === 4 && (
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

        {step === 5 && (
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

        {step === 6 && (
          <div className="rural-review">
            <dl>
              <div><dt>Produtor</dt><dd>{session.fullName || "Conta já cadastrada"}{accountCpf ? ` · ${accountCpf}` : ""}</dd></div>
              <div><dt>Imóvel</dt><dd>{draft.propertyName || "Não informado"}</dd></div>
              <div><dt>CAR / inscrição</dt><dd>{draft.registrationNumber || "Não informado"}</dd></div>
              <div><dt>Município</dt><dd>{draft.municipality || "Não informado"}/RO</dd></div>
              <div><dt>Sede</dt><dd>{draft.latitudeSede != null && draft.longitudeSede != null ? `${draft.latitudeSede.toFixed(5)}, ${draft.longitudeSede.toFixed(5)}` : "Não marcada no mapa"}</dd></div>
              <div><dt>Área total</dt><dd>{draft.totalAreaHectares || "Não informada"} ha</dd></div>
              <div><dt>Área cultivada</dt><dd>{draft.cultivatedAreaHectares || "Não informada"} ha</dd></div>
              <div>
                <dt>Contorno</dt>
                <dd>
                  {showingEstimate && estimatedPerimeter
                    ? `Quadrado de ${formatMeters(estimatedPerimeter.sideMeters)}`
                    : storedPerimeter && parseBoundary(storedPerimeter)
                      ? "Registrado no cadastro"
                      : "Não gerado"}
                </dd>
              </div>
              <div><dt>Acesso</dt><dd>{[draft.lineVicinal, draft.ruralZoneSector].filter(Boolean).join(" · ") || "Não informado"}</dd></div>
              <div><dt>Fonte de água</dt><dd>{waterLabel(draft.waterSource)}</dd></div>
              <div><dt>Irrigação</dt><dd>{irrigationLabel(draft.irrigationSystem)}</dd></div>
              <div><dt>Atividade</dt><dd>{activityLabel(draft.activityCategory)}</dd></div>
              <div><dt>Sistema</dt><dd>{systemLabel(draft.productionSystem)}</dd></div>
            </dl>
            <section className="rural-document-review" aria-labelledby="rural-document-review-title">
              <div>
                <h3 id="rural-document-review-title">Documentos do imóvel — etapa 1</h3>
                <p>
                  {documentsReady
                    ? "Documento exigido processado; dados documentais salvos."
                    : "Falta processar e salvar os dados documentais exigidos."}
                </p>
              </div>
              {documents.length ? (
                <ul>
                  {documents.map((document) => (
                    <li key={document.id}>
                      <strong>{document.documentType === "car_sicar" ? "CAR / SICAR" : document.documentType === "ccir_incra" ? "CCIR / INCRA" : document.documentType}</strong>
                      <span>{document.fileName}</span>
                      <span>
                        Envio: {document.status}; processamento: {document.extractionStatus ?? "não concluído"}; dados: {document.dataSaved ? "salvos" : "pendentes"}.
                      </span>
                      {document.dataSaved && (
                        <span>
                          Dados extraídos: {document.extractedData.propertyRegisteredName} · {document.extractedData.municipality}/RO · {formatHa(document.extractedData.totalAreaHectares)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Nenhum documento exigido foi anexado a este imóvel.</p>
              )}
              <button type="button" className="secondary" onClick={() => patch({ step: 1 })}>
                Corrigir documentos
              </button>
            </section>
            <nav className="rural-review-shortcuts" aria-label="Corrigir seção do imóvel">
              {steps.slice(1, 5).map(([title], index) => (
                <button
                  key={title}
                  type="button"
                  className="secondary"
                  onClick={() => patch({ step: index + 2 })}
                >
                  Corrigir {title.toLowerCase()}
                </button>
              ))}
            </nav>
            <label className="account-toggle rural-commitment">
              <input
                type="checkbox"
                disabled={saveState === "saving"}
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

        </fieldset>
        <footer className="rural-wizard-actions">
          <button
            className="secondary"
            disabled={step === 1 || saving.current}
            onClick={() => viewOnly ? setDraft((current) => ({ ...current, step: Math.max(1, current.step - 1) })) : patch({ step: Math.max(1, step - 1) })}
          >
            Voltar
          </button>
          <div className={"rural-save-indicator is-" + saveState} aria-live="polite">
            {viewOnly ? null : saveState === "saving" ? (
              <><Save /> Salvando…</>
            ) : saveState === "saved" ? (
              <><CheckCircle2 /> Rascunho salvo</>
            ) : saveState === "local" ? (
              <><WifiOff /> Rascunho salvo localmente</>
            ) : null}
          </div>
          {step===6 && !viewOnly && <button type="button" className="secondary" disabled={saving.current || state!=="ready"} onClick={()=>void submitAll(true)}>Concluir e salvar</button>}
          <button
            type="button"
            className="primary"
            disabled={saving.current || state === "conflict"}
            onClick={() => void next()}
          >
            {viewOnly ? (step === 6 ? "Voltar aos imóveis" : "Ver próxima etapa") : step === 6 ? "Revisar e enviar" : "Salvar e continuar"}
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
