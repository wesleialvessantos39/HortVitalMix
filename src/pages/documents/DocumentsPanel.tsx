import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ExternalLink,
  FileCheck,
  FileText,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { api, apiBase } from "../../lib/api";
import {
  documentLabels,
  type DocumentView,
  RequestUploadUrlSchema,
} from "../../../shared/contracts/documents";
import type { ExtractionView } from "../../../shared/contracts/aiExtraction";
import "./documents.css";
import { DocumentPreview } from "./DocumentPreview";
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
  PROPERTY_NOT_EDITABLE:
    "O cadastro deste imóvel não pode ser alterado agora.",
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
};
function textOrEmpty(value: unknown) {
  return value == null || value === "" ? "" : String(value);
}
function fieldsFromExtraction(extraction: ExtractionView | null) {
  const note = extraction?.review?.note ?? "";
  const split = note.indexOf("\n");
  if (
    note.startsWith(
      "Dados informados pelo produtor, sem leitura automática.",
    ) &&
    split > 0
  ) {
    try {
      const parsed = JSON.parse(note.slice(split + 1)) as Record<
        string,
        unknown
      >;
      if (parsed && typeof parsed.propertyRegisteredName === "string")
        return parsed;
    } catch {
      /* a primeira leitura continua disponível */
    }
  }
  return extraction?.payload_jsonb ?? null;
}
function formFromFields(fields: Record<string, unknown> | null) {
  if (!fields) return { ...blankForm };
  return {
    carNumber: textOrEmpty(fields.carNumber),
    ccirNumber: textOrEmpty(fields.ccirNumber),
    propertyRegisteredName: textOrEmpty(fields.propertyRegisteredName),
    holderName: textOrEmpty(fields.holderName),
    holderCpfNormalized: textOrEmpty(fields.holderCpfNormalized),
    municipality: textOrEmpty(fields.municipality),
    totalAreaHectares: textOrEmpty(fields.totalAreaHectares),
    legalReserveHectares: textOrEmpty(fields.legalReserveHectares),
    appHectares: textOrEmpty(fields.appHectares),
    consolidatedRuralAreaHectares: textOrEmpty(
      fields.consolidatedRuralAreaHectares,
    ),
    fiscalModules: textOrEmpty(fields.fiscalModules),
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
}: {
  propertyId: string;
  admin?: boolean;
  initialDocumentId?: string;
  onNavigate?: (url: string) => void;
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
    [reading, setReading] = useState(false);
  const uploadAttempt = useRef<{
      fingerprint: string;
      commandId: string;
      documentId?: string;
    } | null>(null),
    generation = useRef(0),
    comparison = useRef<HTMLElement | null>(null);
  async function load() {
    setLoading(true);
    try {
      const r = await api<{ documents: DocumentView[] }>(
        `${base}?propertyId=${encodeURIComponent(propertyId)}`,
      );
      setDocs(
        admin ? r.documents : r.documents.filter((d) => d.status !== "archived"),
      );
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
    if (!selected || selected.id !== d.id) setForm(blankForm);
    try {
      const meta = await api<{
        extraction: ExtractionView | null;
        ai: { enabled: boolean };
        job: { status: string; error_code?: string } | null;
      }>(`${base}/${d.id}/extraction`).catch(() => null);
      if (seq !== generation.current) return;
      if (meta) {
        setExtraction(meta.extraction);
        setAi(meta.ai.enabled);
        setJob(meta.job?.status ?? "");
        const fields = fieldsFromExtraction(meta.extraction);
        if (fields) setForm(formFromFields(fields));
      }
      requestAnimationFrame(() =>
        comparison.current?.scrollIntoView({ block: "start" }),
      );
      if (
        !admin &&
        !meta?.extraction &&
        ["car_sicar", "ccir_incra"].includes(d.document_type)
      )
        void readDocument(d, seq);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  async function readDocument(d: DocumentView, seq: number) {
    setReading(true);
    setNotice("Lendo o documento e preenchendo o cadastro…");
    try {
      const result = await api<{
        extraction?: ExtractionView;
        propertyUpdated?: boolean;
        areaApplied?: boolean;
      }>(`${base}/${d.id}/extraction`, {
        method: "POST",
        timeoutMs: 55000,
        body: JSON.stringify({ commandId: crypto.randomUUID() }),
      });
      if (seq !== generation.current) return;
      if (result.extraction) {
        setExtraction(result.extraction);
        const fields = fieldsFromExtraction(result.extraction);
        if (fields) setForm(formFromFields(fields));
        setJob("completed");
      }
      setNotice(
        result.propertyUpdated
          ? result.areaApplied
            ? "O documento foi lido e o cadastro do imóvel foi preenchido. A análise humana continua obrigatória."
            : "O documento foi lido. A área total não substituiu o cadastro porque ficou menor que a área cultivada."
          : result.extraction
            ? "O documento foi lido. Confira os dados ao lado do arquivo."
            : "Não foi possível ler este arquivo.",
      );
    } catch (e) {
      if (seq === generation.current) showError(e);
    } finally {
      if (seq === generation.current) setReading(false);
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
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{
        propertyUpdated: boolean;
        areaApplied: boolean;
      }>(`${base}/${selected.id}/declare`, {
        method: "POST",
        timeoutMs: 20000,
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
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
        }),
      });
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
    <section className="documents-panel">
      <header className="documents-panel-header">
        <div className="documents-header-main">
          {onNavigate && (
            <button
              className="rural-back-button"
              aria-label="Voltar para a lista de imóveis"
              onClick={() => onNavigate("/produtor/propriedades")}
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div className="documents-title-wrap">
            <span className="eyebrow">Ambiente do produtor · Custódia Digital</span>
            <h2>Documentos do imóvel</h2>
            <p>
              CAR, CCIR e comprovantes em acesso privado. Envie o PDF ou a foto da
              página inteira. O arquivo aparece na tela e o sistema preenche o
              cadastro. Arquivo conferido não significa aprovação do imóvel.
            </p>
          </div>
        </div>

        {onNavigate && (
          <button
            className="secondary rural-back-link"
            onClick={() => onNavigate("/produtor/propriedades")}
          >
            Voltar aos imóveis
          </button>
        )}
      </header>

      {notice && !selected && (
        <p role="alert" className="account-notice">
          {notice}
        </p>
      )}

      {busy && <p role="status" className="documents-busy-banner">Processando… Mantenha esta tela aberta.</p>}

      {!admin && (
        <fieldset disabled={busy} className="document-upload-fieldset">
          <legend>Enviar documento</legend>
          <div className="document-upload-body">
            <label className="document-type-picker">
              <span>Tipo de documento</span>
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
                <UploadCloud size={18} />
                <span>Selecionar PDF ou imagem</span>
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
              <label className="document-upload document-upload-camera">
                <Camera size={18} />
                <span>Tirar foto do documento</span>
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
          </div>
          <small>
            De 1 KB a 15 MB. O produtor só envia o arquivo. Até 20 documentos por imóvel.
          </small>
        </fieldset>
      )}

      {loading ? (
        <div className="document-state-card" role="status">
          <RefreshCw className="animate-spin" size={24} />
          <p>Carregando documentos…</p>
        </div>
      ) : docs.length === 0 ? (
        <div className="document-state-card document-empty-state">
          <FileText size={32} />
          <div>
            <p>Nenhum documento enviado para este imóvel.</p>
            <small>Envie o recibo do SICAR ou CCIR para leitura automatizada do imóvel rural.</small>
          </div>
        </div>
      ) : (
        <div className="document-list-container">
          <div className="document-list-header">
            <h3>Documentos arquivados e em custódia</h3>
            <span className="document-list-count">
              {docs.length} {docs.length === 1 ? "arquivo" : "arquivos"}
            </span>
          </div>
          <ul className="document-list">
            {docs.map((d) => (
              <li key={d.id} className="document-list-item">
                <div className="document-item-left">
                  <div className="document-item-icon" aria-hidden="true">
                    <FileText size={20} />
                  </div>
                  <div className="document-item-info">
                    <strong>
                      {fileTitle(d.file_name).base}
                      <span className="file-ext">{fileTitle(d.file_name).ext}</span>
                    </strong>
                    <small>
                      {documentLabels[d.document_type]} ·{" "}
                      {(Number(d.file_size_bytes) / 1024).toFixed(0)} KB
                    </small>
                    <span className={"document-status " + d.status}>
                      {statusLabels[d.status]}
                    </span>
                  </div>
                </div>
                <div className="document-actions">
                  {d.status === "clean" && (
                    <button
                      className="secondary document-open-btn"
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
                  {!admin && d.status === "quarantine" && (
                    <button
                      className="primary document-verify-btn"
                      disabled={busy}
                      onClick={() => void action(d, "confirm")}
                    >
                      Conferir envio
                    </button>
                  )}
                  {!admin && d.status !== "archived" && (
                    <button
                      className="secondary document-delete-btn"
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
                      <Trash2 size={15} />
                      Excluir
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selected && (
        <section className="document-comparison" ref={comparison}>
          <div className="document-sheet-bar">
            <div className="document-sheet-title-group">
              <span className="document-sheet-tag">Conferência ativa</span>
              <h3>Documento e cadastro</h3>
              <span className="document-active-filename">{selected.file_name}</span>
            </div>
            <div className="document-sheet-actions">
              <button
                type="button"
                className="secondary document-close-btn"
                onClick={() => {
                  setSelected(null);
                  setUrl("");
                }}
              >
                <X size={16} />
                Fechar
              </button>
            </div>
          </div>

          <div className="document-data">
            <h3>Dados lidos</h3>
            {notice && (
              <p role="alert" className="account-notice">
                {notice}
              </p>
            )}
            {reading && (
              <p role="status" className="document-reading-indicator">
                <RefreshCw className="animate-spin" size={16} />
                Lendo o documento e preenchendo o cadastro…
              </p>
            )}
            {!admin &&
            ["car_sicar", "ccir_incra"].includes(selected.document_type) ? (
              <>
                <p className="document-data-lead">
                  O produtor só envia o arquivo. O sistema lê o PDF ou a foto e
                  preenche o cadastro. A aprovação continua sendo de uma pessoa.
                </p>
                <dl className="document-data-grid">
                  {Object.entries({
                    CAR: form.carNumber,
                    "Código INCRA": form.ccirNumber,
                    Imóvel: form.propertyRegisteredName,
                    Titular: form.holderName,
                    CPF: form.holderCpfNormalized,
                    Município: form.municipality,
                    "Área total (ha)": form.totalAreaHectares,
                    "Reserva legal (ha)": form.legalReserveHectares,
                    "APP (ha)": form.appHectares,
                    "Área consolidada (ha)": form.consolidatedRuralAreaHectares,
                    "Módulos fiscais": form.fiscalModules,
                  }).map(([label, value]) => (
                    <div key={label} className="document-data-field">
                      <dt>{label}</dt>
                      <dd>{value || "Não encontrado no arquivo"}</dd>
                    </div>
                  ))}
                </dl>
                {extraction && extraction.discrepancies.length > 0 && (
                  <div className="document-discrepancies-box">
                    <span className="document-discrepancies-title">
                      <AlertTriangle size={16} /> Divergências detectadas
                    </span>
                    <ul>
                      {extraction.discrepancies.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <details className="document-correction-details">
                  <summary>Corrigir um dado lido errado</summary>
                  <form
                    className="document-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void declareData();
                    }}
                  >
                    <label>
                      <span>Número do CAR</span>
                      <input
                        value={form.carNumber}
                        autoComplete="off"
                        onChange={(e) =>
                          setForm({ ...form, carNumber: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Código INCRA / CCIR</span>
                      <input
                        value={form.ccirNumber}
                        autoComplete="off"
                        inputMode="numeric"
                        onChange={(e) =>
                          setForm({ ...form, ccirNumber: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Nome do imóvel no documento</span>
                      <input
                        required
                        minLength={2}
                        maxLength={128}
                        value={form.propertyRegisteredName}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            propertyRegisteredName: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Titular</span>
                      <input
                        maxLength={255}
                        value={form.holderName}
                        onChange={(e) =>
                          setForm({ ...form, holderName: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>CPF do titular</span>
                      <input
                        inputMode="numeric"
                        autoComplete="off"
                        value={form.holderCpfNormalized}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            holderCpfNormalized: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Município</span>
                      <input
                        required
                        minLength={2}
                        maxLength={100}
                        value={form.municipality}
                        onChange={(e) =>
                          setForm({ ...form, municipality: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Área total (ha)</span>
                      <input
                        required
                        inputMode="decimal"
                        value={form.totalAreaHectares}
                        onChange={(e) =>
                          setForm({ ...form, totalAreaHectares: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Reserva legal (ha)</span>
                      <input
                        inputMode="decimal"
                        value={form.legalReserveHectares}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            legalReserveHectares: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>APP (ha)</span>
                      <input
                        inputMode="decimal"
                        value={form.appHectares}
                        onChange={(e) =>
                          setForm({ ...form, appHectares: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Área consolidada (ha)</span>
                      <input
                        inputMode="decimal"
                        value={form.consolidatedRuralAreaHectares}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            consolidatedRuralAreaHectares: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Módulos fiscais</span>
                      <input
                        inputMode="decimal"
                        value={form.fiscalModules}
                        onChange={(e) =>
                          setForm({ ...form, fiscalModules: e.target.value })
                        }
                      />
                    </label>
                    <button className="document-save" type="submit" disabled={busy}>
                      Salvar correção
                    </button>
                  </form>
                </details>
              </>
            ) : admin ? (
              <>
                <p className="document-data-lead">Conferência humana. Estes dados não aprovam o imóvel.</p>
                <dl className="document-data-grid">
                  {Object.entries({
                    CAR: fieldsFromExtraction(extraction)?.carNumber,
                    "Código INCRA": fieldsFromExtraction(extraction)?.ccirNumber,
                    Imóvel:
                      fieldsFromExtraction(extraction)?.propertyRegisteredName,
                    Titular: fieldsFromExtraction(extraction)?.holderName,
                    CPF: fieldsFromExtraction(extraction)?.holderCpfNormalized,
                    Município: fieldsFromExtraction(extraction)?.municipality,
                    "Área total (ha)":
                      fieldsFromExtraction(extraction)?.totalAreaHectares,
                  }).map(([k, v]) => (
                    <div key={k} className="document-data-field">
                      <dt>{k}</dt>
                      <dd>{textOrEmpty(v) || "Não informado"}</dd>
                    </div>
                  ))}
                </dl>
                {extraction && (
                  <ul className="document-discrepancies-list">
                    {extraction.discrepancies.map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="document-data-lead">
                Este tipo fica anexado ao imóvel, mas não altera o cadastro.
                Use CAR ou CCIR para corrigir os dados.
              </p>
            )}
            <p className="document-disclaimer">
              A leitura não consulta SICAR nem INCRA e não comprova
              titularidade, regularidade ou ausência de sobreposição. A
              aprovação é somente humana.
            </p>
          </div>

          <div className="document-original">
            <div className="document-original-header">
              <h3>Documento original</h3>
              <div className="document-original-actions">
                {url && (
                  <a
                    className="document-open"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={15} />
                    Abrir em tela cheia
                  </a>
                )}
                <button
                  type="button"
                  className="secondary document-refresh-btn"
                  disabled={busy}
                  onClick={() => void open(selected)}
                >
                  <RefreshCw size={14} />
                  Atualizar leitura
                </button>
              </div>
            </div>

            {url ? (
              <div className="document-preview-frame">
                <DocumentPreview url={url} mime={selected.mime_type} />
              </div>
            ) : (
              <div className="document-preview-placeholder">
                <p>Visualização indisponível.</p>
              </div>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
