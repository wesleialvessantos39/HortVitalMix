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
    completed: "Concluído — pronto para enviar",
    submitted: "Enviado para análise",
    verified: "Verificado",
    rejected: "Revisão necessária",
    suspended: "Suspenso",
  }[status];
}

function messageForFailure(error: unknown) {
  const failure = error as ApiFailure;
  if (failure.message === "RECENT_AUTH_REQUIRED")
    return "Confirme sua senha abaixo para continuar. Seu rascunho está preservado.";
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
    ...(property.draftData ?? {}),
    propertyId: property.id, revision: property.revision,
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
  const [listNotice,setListNotice]=useState("");
  const [busyId,setBusyId]=useState<string|null>(null);
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

  async function deleteDraft(property:RuralPropertySummary){
    if(!confirm("Excluir este rascunho? Esta ação não pode ser desfeita."))return;
    setBusyId(property.id);setListNotice("");
    try{await api("/v1/producer/properties/"+property.id,{method:"DELETE",body:JSON.stringify({expectedRevision:property.revision,commandId:commandId()})});localStorage.removeItem(localKey(session.userId,property.id));await load();}
    catch(e){setListNotice((e as ApiFailure).message==="PROPERTY_HAS_DOCUMENTS"?"Este rascunho possui documentos com histórico de custódia e não pode ser excluído.":(e as ApiFailure).message==="RECENT_AUTH_REQUIRED"?"Entre novamente para confirmar a exclusão. Seu rascunho está salvo.":"Não foi possível excluir. Somente rascunhos nunca concluídos podem ser excluídos.");}finally{setBusyId(null);}
  }
  async function submitCompleted(property:RuralPropertySummary){
    setBusyId(property.id);setListNotice("");
    try{await api("/v1/producer/properties/"+property.id+"/submit",{method:"POST",body:JSON.stringify({expectedRevision:property.revision,commandId:commandId(),agroecologicalCommitment:true})});await load();}
    catch(e){setListNotice(messageForFailure(e));}finally{setBusyId(null);}
  }

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
                <MapPinned />
                <span className={"rural-status-badge is-" + property.status}>
                  {statusLabel(property.status)}
                </span>
              </div>
              <h2>{property.propertyName || "Imóvel sem nome — rascunho"}</h2>
              <p>
                {property.lineVicinal} · {property.municipality}/{property.state}
              </p>
              <div className="rural-progress-line" aria-label={`Etapa ${property.wizardCurrentStep} de 5`}>
                <span style={{ width: `${property.wizardCurrentStep * 20}%` }} />
              </div>
              <small>Etapa {property.wizardCurrentStep} de 5</small>
              {property.status !== "suspended" ? (
                <button
                  className="secondary"
                  onClick={() =>
                    onNavigate(
                      "/produtor/propriedades/novo?id=" +
                        encodeURIComponent(property.id),
                    )
                  }
                >
                  {property.status==="draft" ? "Continuar cadastro" : "Editar cadastro"}
                  <ChevronRight />
                </button>
              ) : (
                <p className="rural-readonly-note">
                  Cadastro suspenso para edição.
                </p>
              )}
              {property.status==="draft" && !property.completedAt && <button className="secondary" disabled={busyId===property.id} onClick={()=>void deleteDraft(property)}>Excluir rascunho</button>}
              {property.status==="completed" && <button className="primary" disabled={busyId===property.id} onClick={()=>void submitCompleted(property)}>Enviar para análise</button>}
              <button className="secondary" onClick={()=>onNavigate("/produtor/documentos?propertyId="+property.id)}>Documentos do imóvel</button>
              {property.completedAt && <small>Já concluído: não pode ser excluído. Edições exigem nova análise.</small>}
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
  const hydrated = useRef(false);
  const saving = useRef(false);
  const dirty = useRef(false);
  const editVersion = useRef(0);
  const pendingSave = useRef<{ payload: Record<string, unknown>; version: number } | null>(null);

  const step = draft.step;
  const stepMeta = steps[step - 1];

  function patch(values: Partial<Draft>) {
    dirty.current = true;
    editVersion.current += 1;
    setSaveState((current) => current === "error" ? "idle" : current);
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

    async function hydrate() {
      if (requestedId) {
        try {
          const result = await api<{ property: RuralPropertyView }>(
            "/v1/producer/properties/" + encodeURIComponent(requestedId),
          );
          if (cancelled) return;
          let next = draftFromProperty(result.property);
          let conflict = false;
          try {
            const raw = localStorage.getItem(localKey(session.userId, requestedId));
            const stored = raw ? JSON.parse(raw) as Draft : null;
            if (stored?.propertyId === requestedId && stored.step >= 1 && stored.step <= 5) {
              next = { ...next, ...stored };
              conflict = stored.revision !== result.property.revision;
              dirty.current = true;
              setNotice(conflict
                ? "Há um rascunho local e uma versão diferente no servidor. Copie suas alterações antes de recarregar."
                : "Rascunho local recuperado.");
            }
          } catch {}
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
          setDraft({ ...blankDraft, ...parsed, propertyId: null, revision: null });
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
  }, [requestedId, session.userId]);

  useEffect(() => {
    if (!hydrated.current) return;
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

  const pendingKey=`hvm:rural-pending:${session.userId}:${draft.propertyId??requestedId??"new"}`;
  const pendingDraft=useRef<{payload:Record<string,unknown>;version:number}|null>(null);
  const pendingLoaded=useRef(false);
  if(!pendingLoaded.current){pendingLoaded.current=true;try{const stored=JSON.parse(localStorage.getItem(pendingKey)||"null");if(stored?.payload?.commandId)pendingDraft.current={payload:stored.payload,version:-1};}catch{}}

  async function saveStep(_targetStep:number, automatic=false){
    if(saving.current || state!=="ready")return false;
    if(!online){persistLocal();return false;}
    saving.current=true;setSaveState("saving");
    const {propertyId,revision,...data}=draft;
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
    const missing = [1,2,3,4].filter(n => !buildStepData(n).success);
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
      for (const n of [1,2,3,4,5]) {
        const parsed=buildStepData(n);
        if (!parsed.success) throw new Error("PROPERTY_INCOMPLETE");
        await send({propertyId:propertyId??undefined,expectedRevision:propertyId?revision:undefined,step:n,stepData:parsed.data,completeOnly:n===5?completeOnly:undefined,commandId:commandId()});
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
    if (step===5) {await submitAll();return;}
    if (saving.current) return;
    const valid=buildStepData(step).success;
    await saveStep(step);
    setNotice(valid ? "" : "Etapa com pendências. Você pode voltar para completar antes de enviar.");
    setDraft(current=>({...current,step:Math.min(5,current.step+1)}));
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
    persistLocal();
    const saved=await saveStep(step, true);
    if(!saved){setNotice("O rascunho permanece neste aparelho. Tente salvar novamente antes de sair.");return;}
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
        <button className="secondary" disabled={saving.current} onClick={() => void continueLater()}>
          Continuar mais tarde
        </button>
      </header>

      <div className="rural-step-progress" aria-label={`Progresso: etapa ${step} de 5`}>
        {steps.map(([title], index) => (
          <button
            type="button"
            disabled={saving.current}
            onClick={()=>patch({step:index+1})}
            aria-label={`Etapa ${index+1}: ${title}${buildStepData(index+1).success ? ", completa" : ", pendente"}`}
            key={title}
            className={
              "rural-step-dot " +
              (buildStepData(index+1).success
                ? "is-complete"
                : index + 1 === step
                  ? "is-current"
                  : "")
            }
          >
            <span>{buildStepData(index+1).success ? "✓" : index + 1}</span>
            <small>{title}{!buildStepData(index+1).success ? " · Pendente" : ""}</small>
          </button>
        ))}
      </div>

      <p className="account-notice">Etapas pendentes: {[1,2,3,4].filter(n=>!buildStepData(n).success).join(", ") || "nenhuma"}. Toque em uma etapa para continuar o preenchimento.</p>

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
            <p>Copie suas alterações antes de descartar o rascunho local e abrir a versão do servidor.</p>
          </div>
          <button className="secondary" onClick={() => {
            try { localStorage.removeItem(localKey(session.userId, draft.propertyId)); } catch {}
            onNavigate("/produtor/propriedades");
          }}>
            Descartar rascunho local e voltar à lista
          </button>
        </div>
      )}

      {reauth && <div className="rural-state-card" role="alert"><label>Confirme sua senha para salvar<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="secondary" onClick={()=>void confirmPassword()}>Confirmar senha</button></div>}
      <div className="rural-wizard-card" inert={step===5 && saveState==="saving" ? true : undefined}>
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
          {step===5 && <button className="secondary" disabled={saving.current || state!=="ready"} onClick={()=>void submitAll(true)}>Concluir e salvar</button>}
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
