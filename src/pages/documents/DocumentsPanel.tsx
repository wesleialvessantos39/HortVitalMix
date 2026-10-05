import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { api, apiBase } from "../../lib/api";
import {
  documentLabels,
  type DocumentView,
  RequestUploadUrlSchema,
} from "../../../shared/contracts/documents";
import type { ExtractionView } from "../../../shared/contracts/aiExtraction";
import "./documents.css";
import { DocumentPreview } from "./DocumentPreview";
import {
  parseRuralDocumentText,
  parseRuralLocation,
} from "../../../shared/documents/parseRuralDocument";
import {
  declaredDocumentFields,
  effectiveDocumentFields,
} from "../../../shared/documents/effectiveDocumentFields";
const statusLabels = {
  quarantine: "Aguardando conferência do arquivo",
  clean: "Arquivo conferido",
  rejected: "Arquivo rejeitado",
  archived: "Arquivado",
};
const errors: Record<string, string> = {
  DOCUMENT_UNREADABLE:
    "Não encontrei texto neste PDF. Envie o recibo do SICAR ou uma foto nítida da página inteira.",
  AI_NOT_CONFIGURED:
    "A foto ainda não pôde ser lida neste ambiente. Envie o PDF baixado do SICAR, que o sistema lê e preenche sozinho.",
  AI_RATE_LIMIT:
    "O limite temporário de leitura foi atingido. Aguarde antes de tentar novamente.",
  AI_TIMEOUT:
    "A leitura demorou mais que o permitido. Tente novamente em alguns instantes.",
  AI_OUTPUT_INCOMPLETE:
    "A leitura ficou incompleta. Envie uma digitalização legível e tente novamente.",
  AI_INVALID_OUTPUT:
    "A leitura não produziu dados confiáveis. Confira o documento original.",
  EXTRACTION_IN_PROGRESS:
    "Este documento já está sendo processado. Aguarde e atualize.",
  DOCUMENT_QUOTA_REACHED:
    "Limite de documentos atingido (20 por imóvel ou 150 MB por produtor).",
  DOCUMENT_NOT_AVAILABLE:
    "Este arquivo ainda não está disponível para visualização.",
  UPLOAD_NOT_RECEIVED:
    "O envio não foi concluído. Selecione o arquivo novamente.",
  AI_PROVIDER_UNAVAILABLE:
    "O serviço de leitura está temporariamente indisponível.",
  REQUEST_TIMEOUT:
    "A leitura demorou mais que o permitido. Tente novamente em alguns instantes.",
  EXTRACTION_TYPE_UNSUPPORTED:
    "Este tipo de documento não corrige o cadastro. Use CAR ou CCIR.",
  PROPERTY_NOT_EDITABLE: "O cadastro deste imóvel não pode ser alterado agora.",
  PROPERTY_REVISION_CONFLICT:
    "O imóvel mudou em outra sessão. Reabra o documento antes de salvar a correção.",
  PROPERTY_AREA_CONFLICT:
    "A área consolidada não pode ser maior que a área total. Confira as duas áreas.",
};
const blankForm = {
  carNumber: "",
  ccirNumber: "",
  propertyRegisteredName: "",
  holderName: "",
  holderCpfNormalized: "",
  municipality: "",
  totalAreaHectares: "",
  legalReserveHectares: "",
  appHectares: "",
  consolidatedRuralAreaHectares: "",
  fiscalModules: "",
  latitudeSede: "",
  longitudeSede: "",
};
export type PropertyDocumentSummary = {
  id: string;
  documentType: DocumentView["document_type"];
  fileName: string;
  status: DocumentView["status"];
  extractionStatus: string | null;
  dataSaved: boolean;
  extractedData: {
    propertyRegisteredName: string;
    municipality: string;
    totalAreaHectares: string;
    carNumber: string;
    ccirNumber: string;
  };
};
function textOrEmpty(value: unknown) {
  return value == null || value === "" ? "" : String(value);
}
const fieldsFromExtraction = effectiveDocumentFields;
function formFromFields(fields: object | null) {
  const source = (fields ?? {}) as Record<string, unknown>;
  return {
    carNumber: textOrEmpty(source.carNumber),
    ccirNumber: textOrEmpty(source.ccirNumber),
    propertyRegisteredName: textOrEmpty(source.propertyRegisteredName),
    holderName: textOrEmpty(source.holderName),
    holderCpfNormalized: textOrEmpty(source.holderCpfNormalized),
    municipality: textOrEmpty(source.municipality),
    totalAreaHectares: textOrEmpty(source.totalAreaHectares),
    legalReserveHectares: textOrEmpty(source.legalReserveHectares),
    appHectares: textOrEmpty(source.appHectares),
    consolidatedRuralAreaHectares: textOrEmpty(
      source.consolidatedRuralAreaHectares,
    ),
    fiscalModules: textOrEmpty(source.fiscalModules),
    latitudeSede: textOrEmpty(source.latitudeSede),
    longitudeSede: textOrEmpty(source.longitudeSede),
  };
}
function fileTitle(name: string) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}
export function DocumentsPanel({
  propertyId,
  admin = false,
  initialDocumentId,
  onNavigate,
  embedded = false,
  readOnly = false,
  onReadinessChange,
  onPropertyUpdated,
  propertyRevision,
}: {
  propertyId: string;
  admin?: boolean;
  initialDocumentId?: string;
  onNavigate?: (url: string) => void;
  embedded?: boolean;
  readOnly?: boolean;
  propertyRevision?: number | null;
  onPropertyUpdated?: (result: {
    areaApplied: boolean;
    locationApplied?: boolean;
    cultivatedApplied?: boolean;
  }) => Promise<void>;
  onReadinessChange?: (result: {
    documents: PropertyDocumentSummary[];
    requiredReady: boolean;
  }) => void;
}) {
  const base = admin ? "/v1/admin/documents" : "/v1/producer/documents";
  const [docs, setDocs] = useState<DocumentView[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [type, setType] = useState<keyof typeof documentLabels>("car_sicar"),
    [selected, setSelected] = useState<DocumentView | null>(null),
    [url, setUrl] = useState(""),
    [extraction, setExtraction] = useState<ExtractionView | null>(null),
    [ai, setAi] = useState<boolean | null>(null),
    [job, setJob] = useState(""),
    [previewKind, setPreviewKind] = useState<"pdf" | "image" | "">(""),
    [form, setForm] = useState(blankForm),
    [reading, setReading] = useState(false),
    [previewTick, setPreviewTick] = useState(0),
    [accountName, setAccountName] = useState(""),
    [accountCpf, setAccountCpf] = useState(""),
    [place, setPlace] = useState("");
  const uploadAttempt = useRef<{
      fingerprint: string;
      commandId: string;
      documentId?: string;
    } | null>(null),
    generation = useRef(0),
    comparison = useRef<HTMLElement | null>(null),
    readingDoc = useRef<DocumentView | null>(null),
    appliedLocal = useRef(false);
  const metadata = useRef<Promise<{
    extraction: ExtractionView | null;
    ai: { enabled: boolean };
    job: { status: string } | null;
    property?: {
      revision: number;
      latitudeSede: number | null;
      longitudeSede: number | null;
    };
  }> | null>(null);
  const documentRevision = useRef<number | undefined>(undefined);
  const editing = useRef(false);
  function editForm(next: typeof blankForm) {
    editing.current = true;
    setForm(next);
  }
  const correctionAttempt = useRef<{
    fingerprint: string;
    commandId: string;
  } | null>(null);
  async function load() {
    setLoading(true);
    try {
      const r = await api<{ documents: DocumentView[] }>(
        `${base}?propertyId=${encodeURIComponent(propertyId)}`,
      );
      const visible = admin
        ? r.documents
        : r.documents.filter((d) => d.status !== "archived");
      setDocs(visible);
      if (!admin && onReadinessChange) {
        const required = visible.filter(
          (document) =>
            document.status === "clean" &&
            ["car_sicar", "ccir_incra"].includes(document.document_type),
        );
        const extractions = await Promise.all(
          required.map(async (document) => {
            const result = await api<{
              extraction: ExtractionView | null;
            }>(`${base}/${document.id}/extraction`).catch(() => null);
            const extraction = result?.extraction ?? null;
            const fields = fieldsFromExtraction(extraction) as Record<
              string,
              unknown
            > | null;
            const extractedData = {
              propertyRegisteredName: textOrEmpty(
                fields?.propertyRegisteredName,
              ).trim(),
              municipality: textOrEmpty(fields?.municipality).trim(),
              totalAreaHectares: textOrEmpty(fields?.totalAreaHectares).trim(),
              carNumber: textOrEmpty(fields?.carNumber).trim(),
              ccirNumber: textOrEmpty(fields?.ccirNumber).trim(),
            };
            const dataSaved = Boolean(
              extractedData.propertyRegisteredName &&
              extractedData.municipality &&
              Number(extractedData.totalAreaHectares) > 0,
            );
            return {
              id: document.id,
              documentType: document.document_type,
              fileName: document.file_name,
              status: document.status,
              extractionStatus: extraction?.status ?? null,
              dataSaved,
              extractedData,
            } satisfies PropertyDocumentSummary;
          }),
        );
        onReadinessChange({
          documents: visible.map((document) => {
            const extraction = extractions.find(
              (item) => item.id === document.id,
            );
            return (
              extraction ?? {
                id: document.id,
                documentType: document.document_type,
                fileName: document.file_name,
                status: document.status,
                extractionStatus: null,
                dataSaved: false,
                extractedData: {
                  propertyRegisteredName: "",
                  municipality: "",
                  totalAreaHectares: "",
                  carNumber: "",
                  ccirNumber: "",
                },
              }
            );
          }),
          requiredReady: extractions.some(
            (item) =>
              item.status === "clean" &&
              item.dataSaved &&
              (item.extractionStatus === "completed" ||
                item.extractionStatus === "flagged_discrepancy"),
          ),
        });
      }
      return r.documents;
    } catch (e) {
      showError(e);
      return [];
    } finally {
      setLoading(false);
    }
  }
  function showError(e: unknown) {
    const code = e instanceof Error ? e.message : "";
    setNotice(
      errors[code] ??
        "Não foi possível concluir. Verifique sua conexão e tente novamente.",
    );
  }
  useEffect(() => {
    let cancelled = false;
    void api<{ fullName?: string; cpfMasked?: string }>("/v1/account/profile")
      .then((profile) => {
        if (cancelled) return;
        if (profile.fullName) setAccountName(profile.fullName);
        if (profile.cpfMasked) setAccountCpf(profile.cpfMasked);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    void load().then((rows) => {
      const d = rows.find((d) => d.id === initialDocumentId);
      if (d?.status === "clean") void open(d);
    });
    return () => {
      generation.current++;
    };
  }, [propertyId, base]);
  function fileHref(id: string) {
    return `${apiBase()}${base}/${id}/file`;
  }
  async function open(d: DocumentView) {
    editing.current = false;
    const seq = ++generation.current;
    setBusy(true);
    setNotice("");
    setSelected(d);
    setUrl(d.status === "clean" ? fileHref(d.id) : "");
    setPreviewKind(
      d.mime_type === "application/pdf"
        ? "pdf"
        : d.mime_type.startsWith("image/")
          ? "image"
          : "",
    );
    setExtraction(null);
    setAi(null);
    setJob("");
    setPlace("");
    readingDoc.current = d;
    appliedLocal.current = false;
    if (!selected || selected.id !== d.id) setForm(blankForm);
    try {
      metadata.current = api<{
        extraction: ExtractionView | null;
        ai: { enabled: boolean };
        job: { status: string; error_code?: string } | null;
        property?: {
          revision: number;
          latitudeSede: number | null;
          longitudeSede: number | null;
        };
      }>(`${base}/${d.id}/extraction`);
      const meta = await metadata.current;
      if (seq !== generation.current) return;
      if (meta) {
        setExtraction(meta.extraction);
        setAi(meta.ai.enabled);
        setJob(meta.job?.status ?? "");
        documentRevision.current = meta.property?.revision;
        const fields = fieldsFromExtraction(meta.extraction);
        if (fields && !appliedLocal.current) {
          const location = meta.property ?? {
            ...parseRuralLocation(fields.rawText),
            ...declaredDocumentFields(meta.extraction),
          };
          setForm(
            formFromFields({
              ...fields,
              latitudeSede: location.latitudeSede,
              longitudeSede: location.longitudeSede,
            }),
          );
          if (location.latitudeSede != null && location.longitudeSede != null)
            setPlace(
              `${Number(location.latitudeSede).toFixed(5)}, ${Number(location.longitudeSede).toFixed(5)}`,
            );
        }
      }
      requestAnimationFrame(() =>
        comparison.current?.scrollIntoView({ block: "nearest" }),
      );
      if (d.mime_type.startsWith("image/"))
        setNotice(
          "A foto fica anexada. Para preencher o cadastro, envie o PDF baixado do SICAR.",
        );
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  async function applyRead(d: DocumentView, text: string) {
    if (!["car_sicar", "ccir_incra"].includes(d.document_type)) return;
    const seq = generation.current;
    let saved: ExtractionView | null;
    try {
      saved = (await metadata.current)?.extraction ?? null;
    } catch {
      return;
    } // Uma falha de consulta não autoriza sobrescrever dados existentes.
    if (
      seq !== generation.current ||
      readingDoc.current?.id !== d.id ||
      admin ||
      readOnly
    )
      return;
    if (saved || editing.current) return;
    appliedLocal.current = true;
    if (text.trim().length < 8) {
      setNotice(
        "O PDF abriu, mas este arquivo não tem texto. Envie o PDF baixado do SICAR, não uma foto.",
      );
      return;
    }
    const parsed = parseRuralDocumentText(
      text,
      d.document_type as "car_sicar" | "ccir_incra",
    );
    const location = parseRuralLocation(text);
    setPlace(
      location.latitudeSede != null && location.longitudeSede != null
        ? `${location.latitudeSede.toFixed(5)}, ${location.longitudeSede.toFixed(5)}`
        : "",
    );
    if (
      !parsed?.propertyRegisteredName ||
      !parsed.municipality ||
      !parsed.totalAreaHectares
    ) {
      if (parsed) setForm(formFromFields(parsed));
      setNotice(
        "O PDF abriu. Não achei nome, município e área neste arquivo para preencher o cadastro.",
      );
      return;
    }
    setForm(
      formFromFields({
        ...parsed,
        holderName: parsed.holderName || accountName,
        ...location,
      }),
    );
    setReading(true);
    try {
      const result = await api<{
        propertyUpdated: boolean;
        areaApplied: boolean;
        locationApplied?: boolean;
        cultivatedApplied?: boolean;
        alreadySaved?: boolean;
      }>(`${base}/${d.id}/declare`, {
        method: "POST",
        timeoutMs: 20000,
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          source: "pdf_text",
          carNumber: parsed.carNumber,
          ccirNumber: parsed.ccirNumber,
          propertyRegisteredName: parsed.propertyRegisteredName,
          holderName: parsed.holderName,
          holderCpfNormalized: parsed.holderCpfNormalized,
          municipality: parsed.municipality,
          totalAreaHectares: parsed.totalAreaHectares,
          legalReserveHectares: parsed.legalReserveHectares,
          appHectares: parsed.appHectares,
          consolidatedRuralAreaHectares: parsed.consolidatedRuralAreaHectares,
          fiscalModules: parsed.fiscalModules,
          latitudeSede: location.latitudeSede,
          longitudeSede: location.longitudeSede,
        }),
      });
      if (result.propertyUpdated) await onPropertyUpdated?.(result);
      await load();
      await open(d);
      setNotice(
        result.alreadySaved
          ? "Dados conferidos recuperados. As correções salvas foram preservadas."
          : !result.propertyUpdated
            ? "O PDF foi lido. Este cadastro já foi aprovado ou está suspenso e não foi alterado."
            : result.areaApplied
              ? "O PDF foi lido e o cadastro do imóvel foi preenchido. Município, área e o ponto no mapa também. Nome e CPF do produtor continuam os da sua conta."
              : "O PDF foi lido. A área total não substituiu a área cultivada já informada.",
      );
    } catch (e) {
      showError(e);
    } finally {
      setReading(false);
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setNotice("");
    try {
      if (
        file.size < 1024 ||
        file.size > 15728640 ||
        !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
      ) {
        setNotice("Selecione um PDF, PNG ou JPEG entre 1 KB e 15 MB.");
        return;
      }
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
        ),
      )
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      const fingerprint = propertyId + type + file.name + hash;
      if (uploadAttempt.current?.fingerprint !== fingerprint)
        uploadAttempt.current = { fingerprint, commandId: crypto.randomUUID() };
      const attempt = uploadAttempt.current;
      const payload = RequestUploadUrlSchema.parse({
        propertyId,
        documentType: type,
        fileName: file.name,
        fileSizeBytes: file.size,
        mimeType: file.type,
        fileHashSha256: hash,
        commandId: attempt.commandId,
      });
      const signed = await api<{
        documentId: string;
        signedUrl: string | null;
        status: string;
      }>(`${base}/upload-url`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      attempt.documentId = signed.documentId;
      if (signed.signedUrl) {
        const form = new FormData();
        form.append("cacheControl", "0");
        form.append("", file);
        const r = await fetch(signed.signedUrl, {
          method: "PUT",
          body: form,
          credentials: "omit",
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          if (
            !["Duplicate", "409"].includes(String(body.error)) &&
            String(body.statusCode) !== "409"
          )
            throw new Error("UPLOAD_FAILED");
        }
      }
      const confirmed = await api<{ status: string }>(
        `${base}/${signed.documentId}/confirm`,
        {
          method: "POST",
          body: JSON.stringify({ commandId: crypto.randomUUID() }),
        },
      );
      const rows = await load();
      uploadAttempt.current = null;
      const created = rows.find((row) => row.id === signed.documentId);
      if (created && confirmed.status === "clean") {
        setNotice("Documento recebido. A leitura começa agora.");
        void open(created);
      } else
        setNotice(
          confirmed.status === "clean"
            ? "Documento recebido e integridade conferida."
            : "O arquivo não passou na conferência. Envie uma cópia válida.",
        );
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  async function action(
    d: DocumentView,
    kind: "confirm" | "archive" | "extraction",
  ) {
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{ extraction?: ExtractionView }>(
        `${base}/${d.id}/${kind}`,
        {
          method: "POST",
          body: JSON.stringify({ commandId: crypto.randomUUID() }),
          timeoutMs: kind === "extraction" ? 55000 : 20000,
        },
      );
      if (result.extraction) {
        setExtraction(result.extraction);
        setJob("completed");
        setForm(formFromFields(fieldsFromExtraction(result.extraction)));
      }
      if (kind === "archive") {
        setSelected(null);
        setUrl("");
        setDocs((rows) => rows.filter((row) => row.id !== d.id));
      }
      await load();
      if (kind !== "extraction")
        setNotice(
          kind === "archive"
            ? "Documento excluído da conferência. O histórico permanece no banco."
            : "Conferência concluída.",
        );
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  function optionalArea(value: string) {
    const text = value.trim().replace(",", ".");
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }
  async function declareData() {
    if (!selected) return;
    const area = Number(form.totalAreaHectares.trim().replace(",", "."));
    const cpf = form.holderCpfNormalized.replace(/\D/g, "");
    if (
      form.propertyRegisteredName.trim().length < 2 ||
      form.municipality.trim().length < 2 ||
      !(area > 0)
    ) {
      setNotice("Informe o nome do imóvel, o município e a área total.");
      return;
    }
    if (cpf && cpf.length !== 11) {
      setNotice("O CPF do titular precisa ter 11 dígitos ou ficar em branco.");
      return;
    }
    const latitudeSede = optionalArea(form.latitudeSede),
      longitudeSede = optionalArea(form.longitudeSede);
    if (
      (latitudeSede == null) !== (longitudeSede == null) ||
      (latitudeSede != null &&
        (latitudeSede < -14 ||
          latitudeSede > -7 ||
          longitudeSede! < -67 ||
          longitudeSede! > -59))
    ) {
      setNotice(
        "Informe latitude e longitude válidas em Rondônia, ou deixe as duas em branco.",
      );
      return;
    }
    const payload = {
      source: "producer_correction",
      expectedRevision: propertyRevision ?? documentRevision.current,
      carNumber: form.carNumber.trim() || null,
      ccirNumber: form.ccirNumber.trim() || null,
      propertyRegisteredName: form.propertyRegisteredName.trim(),
      holderName: form.holderName.trim() || null,
      holderCpfNormalized: cpf || null,
      municipality: form.municipality.trim(),
      totalAreaHectares: area,
      legalReserveHectares: optionalArea(form.legalReserveHectares),
      appHectares: optionalArea(form.appHectares),
      consolidatedRuralAreaHectares: optionalArea(
        form.consolidatedRuralAreaHectares,
      ),
      fiscalModules: optionalArea(form.fiscalModules),
      latitudeSede,
      longitudeSede,
    };
    const fingerprint = JSON.stringify(payload);
    if (correctionAttempt.current?.fingerprint !== fingerprint)
      correctionAttempt.current = {
        fingerprint,
        commandId: crypto.randomUUID(),
      };
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{
        propertyUpdated: boolean;
        areaApplied: boolean;
        locationApplied?: boolean;
        cultivatedApplied?: boolean;
      }>(`${base}/${selected.id}/declare`, {
        method: "POST",
        timeoutMs: 20000,
        body: JSON.stringify({
          ...payload,
          commandId: correctionAttempt.current.commandId,
        }),
      });
      if (result.propertyUpdated) await onPropertyUpdated?.(result);
      correctionAttempt.current = null;
      await load();
      await open(selected);
      setNotice(
        !result.propertyUpdated
          ? "Dados salvos no documento. Este cadastro já foi aprovado ou está suspenso e não foi alterado."
          : result.areaApplied
            ? "Dados salvos. O cadastro do imóvel foi corrigido com o documento e segue para a análise junto com o arquivo."
            : "Dados salvos. A área total não substituiu o cadastro porque ficou menor que a área cultivada já informada.",
      );
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={
        "documents-panel" + (embedded ? " documents-panel--embedded" : "")
      }
    >
      <header className="account-detail-top documents-head">
        {onNavigate && (
          <button
            className="rural-back-button"
            type="button"
            aria-label="Voltar aos imóveis"
            onClick={() => onNavigate("/produtor/propriedades")}
          >
            <ArrowLeft />
          </button>
        )}
        <div>
          <span className="eyebrow">
            {embedded ? "Etapa 1" : "Imóvel rural"}
          </span>
          {embedded ? (
            <h2>Documentos do imóvel</h2>
          ) : (
            <h1>Documentos do imóvel</h1>
          )}
        </div>
      </header>
      <p className="rural-page-lead">
        Envie o PDF do CAR ou do CCIR. O sistema lê o texto do arquivo e
        preenche o cadastro.
      </p>
      <div className="document-management">
        {!admin && !readOnly && (
          <fieldset className="account-panel" disabled={busy}>
            <div className="account-section-intro">
              <h2>Enviar documento</h2>
              <p>
                PDF do SICAR, ou uma foto só para anexar. A leitura do cadastro
                usa o texto do PDF.
              </p>
            </div>
            <label>
              Tipo de documento
              <select
                value={type}
                onChange={(e) =>
                  setType(e.target.value as keyof typeof documentLabels)
                }
              >
                {Object.entries(documentLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <div className="document-actions">
              <label className="document-upload">
                Selecionar PDF ou imagem
                <input
                  aria-label="Selecionar PDF ou imagem"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void upload(f);
                  }}
                />
              </label>
              <label className="document-upload">
                Tirar foto do documento
                <input
                  aria-label="Tirar foto do documento"
                  type="file"
                  accept="image/jpeg,image/png"
                  capture="environment"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void upload(f);
                  }}
                />
              </label>
            </div>
            <small>
              De 1 KB a 15 MB. O produtor só envia o arquivo. Até 20 documentos
              por imóvel.
            </small>
          </fieldset>
        )}
        {notice && !selected && (
          <p role="alert" className="account-notice">
            {notice}
          </p>
        )}
        {busy && <p role="status">Processando… Mantenha esta tela aberta.</p>}
        {loading ? (
          <p role="status">Carregando documentos…</p>
        ) : docs.length === 0 ? (
          <p>Nenhum documento enviado para este imóvel.</p>
        ) : (
          <ul className="document-list">
            {docs.map((d) => (
              <li key={d.id}>
                <span className="document-card-icon" aria-hidden="true">
                  <FileText />
                </span>
                <div>
                  <strong>{documentLabels[d.document_type]}</strong>
                  <small className="document-file-name">
                    {fileTitle(d.file_name).base}
                    <span className="file-ext">
                      {fileTitle(d.file_name).ext}
                    </span>
                    {" · "}
                    {(Number(d.file_size_bytes) / 1024).toFixed(0)} KB
                  </small>
                  <span className={"document-status " + d.status}>
                    {statusLabels[d.status]}
                  </span>
                </div>
                <div className="document-actions">
                  {d.status === "clean" && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        if (onNavigate)
                          history.replaceState(
                            {},
                            "",
                            `/produtor/documentos/${d.id}/extracao?propertyId=${propertyId}`,
                          );
                        void open(d);
                      }}
                    >
                      Ver documento
                    </button>
                  )}
                  {!admin && !readOnly && d.status === "quarantine" && (
                    <button
                      disabled={busy}
                      onClick={() => void action(d, "confirm")}
                    >
                      Conferir envio
                    </button>
                  )}
                  {!admin && !readOnly && d.status !== "archived" && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Excluir este documento da conferência? Ele sai da lista ativa e o histórico permanece no banco.",
                          )
                        )
                          void action(d, "archive");
                      }}
                    >
                      Excluir
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected && (
        <section className="document-comparison account-panel" ref={comparison}>
          <div className="document-sheet-bar">
            <div>
              <span className="eyebrow">Leitura do arquivo</span>
              <h2>Ver documento</h2>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setSelected(null);
                setUrl("");
                generation.current++;
                readingDoc.current = null;
              }}
            >
              Fechar
            </button>
          </div>
          <div className="document-data">
            <h3>Dados lidos</h3>
            {notice && (
              <p role="alert" className="account-notice">
                {notice}
              </p>
            )}
            {reading && (
              <p role="status">Lendo o documento e preenchendo o cadastro…</p>
            )}
            {!admin &&
            ["car_sicar", "ccir_incra"].includes(selected.document_type) ? (
              <>
                <p>
                  {accountName
                    ? `Produtor da conta: ${accountName}${accountCpf ? ` · CPF ${accountCpf}` : ""}. O documento não cria outro nome nem outro CPF.`
                    : "O nome e o CPF usados são os da sua conta. O documento não cria outro cadastro de pessoa."}
                </p>
                <dl>
                  {Object.entries({
                    CAR: form.carNumber,
                    Imóvel: form.propertyRegisteredName,
                    Titular: form.holderName || accountName,
                    "Código INCRA / CCIR": form.ccirNumber,
                    Município: form.municipality
                      ? `${form.municipality} — RO`
                      : "",
                    "Ponto no mapa": place,
                    "Área (ha)": form.totalAreaHectares,
                    "Cultivada (ha)": form.consolidatedRuralAreaHectares,
                    "Reserva (ha)": form.legalReserveHectares,
                    "APP (ha)": form.appHectares,
                    Módulos: form.fiscalModules,
                  })
                    .filter(([, value]) => String(value || "").trim())
                    .map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                </dl>
                {!readOnly && (
                  <details>
                    <summary>Corrigir um dado lido errado</summary>
                    <form
                      className="document-form"
                      aria-label="Correção dos dados do documento"
                      aria-busy={busy || reading}
                      inert={busy || reading ? true : undefined}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void declareData();
                      }}
                    >
                      <label>
                        Número do CAR
                        <input
                          value={form.carNumber}
                          autoComplete="off"
                          onChange={(e) =>
                            editForm({ ...form, carNumber: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Código INCRA / CCIR
                        <input
                          value={form.ccirNumber}
                          autoComplete="off"
                          inputMode="numeric"
                          onChange={(e) =>
                            editForm({ ...form, ccirNumber: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Nome do imóvel no documento
                        <input
                          required
                          minLength={2}
                          maxLength={128}
                          value={form.propertyRegisteredName}
                          onChange={(e) =>
                            editForm({
                              ...form,
                              propertyRegisteredName: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Titular
                        <input
                          maxLength={255}
                          value={form.holderName}
                          onChange={(e) =>
                            editForm({ ...form, holderName: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        CPF do titular
                        <input
                          inputMode="numeric"
                          autoComplete="off"
                          value={form.holderCpfNormalized}
                          onChange={(e) =>
                            editForm({
                              ...form,
                              holderCpfNormalized: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Município
                        <input
                          required
                          minLength={2}
                          maxLength={100}
                          value={form.municipality}
                          onChange={(e) =>
                            editForm({ ...form, municipality: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Área total (ha)
                        <input
                          required
                          inputMode="decimal"
                          value={form.totalAreaHectares}
                          onChange={(e) =>
                            editForm({
                              ...form,
                              totalAreaHectares: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Reserva legal (ha)
                        <input
                          inputMode="decimal"
                          value={form.legalReserveHectares}
                          onChange={(e) =>
                            editForm({
                              ...form,
                              legalReserveHectares: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        APP (ha)
                        <input
                          inputMode="decimal"
                          value={form.appHectares}
                          onChange={(e) =>
                            editForm({ ...form, appHectares: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Área consolidada (ha)
                        <input
                          inputMode="decimal"
                          value={form.consolidatedRuralAreaHectares}
                          onChange={(e) =>
                            editForm({
                              ...form,
                              consolidatedRuralAreaHectares: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Módulos fiscais
                        <input
                          inputMode="decimal"
                          value={form.fiscalModules}
                          onChange={(e) =>
                            editForm({ ...form, fiscalModules: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Latitude da sede
                        <input
                          inputMode="decimal"
                          value={form.latitudeSede}
                          onChange={(e) =>
                            editForm({ ...form, latitudeSede: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Longitude da sede
                        <input
                          inputMode="decimal"
                          value={form.longitudeSede}
                          onChange={(e) =>
                            editForm({ ...form, longitudeSede: e.target.value })
                          }
                        />
                      </label>
                      <button
                        className="document-save"
                        type="submit"
                        disabled={busy}
                      >
                        Salvar correção
                      </button>
                    </form>
                  </details>
                )}
              </>
            ) : admin ? (
              <>
                <p>Conferência humana. Estes dados não aprovam o imóvel.</p>
                <dl>
                  {Object.entries({
                    CAR: fieldsFromExtraction(extraction)?.carNumber,
                    "Código INCRA":
                      fieldsFromExtraction(extraction)?.ccirNumber,
                    Imóvel:
                      fieldsFromExtraction(extraction)?.propertyRegisteredName,
                    Titular: fieldsFromExtraction(extraction)?.holderName,
                    CPF: fieldsFromExtraction(extraction)?.holderCpfNormalized,
                    Município: fieldsFromExtraction(extraction)?.municipality,
                    "Área total (ha)":
                      fieldsFromExtraction(extraction)?.totalAreaHectares,
                  }).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{textOrEmpty(v) || "Não informado"}</dd>
                    </div>
                  ))}
                </dl>
                {extraction && (
                  <ul>
                    {(
                      extraction.effective_discrepancies ??
                      extraction.discrepancies
                    ).map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p>
                Este tipo fica anexado ao imóvel, mas não altera o cadastro. Use
                CAR ou CCIR para corrigir os dados.
              </p>
            )}
            <p className="document-disclaimer">
              A leitura usa o texto do PDF. Não consulta o SICAR e não aprova o
              imóvel.
            </p>
          </div>
          <div className="document-original">
            <h3>Documento original</h3>
            {url ? (
              <>
                <a
                  className="document-open"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir em tela cheia
                </a>
                <DocumentPreview
                  key={`${url}:${previewTick}`}
                  url={url}
                  mime={selected.mime_type}
                  onText={(text) => {
                    const current = readingDoc.current;
                    if (current && !current.mime_type.startsWith("image/"))
                      void applyRead(current, text);
                  }}
                />
              </>
            ) : (
              <p>Visualização indisponível.</p>
            )}
            <button
              type="button"
              className="secondary"
              disabled={busy || reading}
              onClick={() => {
                appliedLocal.current = false;
                setNotice("");
                setPreviewTick((value) => value + 1);
              }}
            >
              Atualizar leitura
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
