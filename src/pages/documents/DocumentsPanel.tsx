import { useEffect, useRef, useState } from "react";
import { api, apiBase } from "../../lib/api";
import {
  documentLabels,
  type DocumentView,
  RequestUploadUrlSchema,
} from "../../../shared/contracts/documents";
import type { ExtractionView } from "../../../shared/contracts/aiExtraction";
import "./documents.css";
import { DocumentPreview } from "./DocumentPreview";
import { parseRuralDocumentText } from "../../../shared/documents/parseRuralDocument";
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
    [reading, setReading] = useState(false),
    [previewTick, setPreviewTick] = useState(0);
  const uploadAttempt = useRef<{
      fingerprint: string;
      commandId: string;
      documentId?: string;
    } | null>(null),
    generation = useRef(0),
    comparison = useRef<HTMLElement | null>(null),
    readingDoc = useRef<DocumentView | null>(null),
    appliedLocal = useRef(false);
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
    readingDoc.current = d;
    appliedLocal.current = false;
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
        if (fields && !appliedLocal.current) setForm(formFromFields(fields));
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
    setForm(formFromFields(parsed));
    setReading(true);
    try {
      const result = await api<{
        propertyUpdated: boolean;
        areaApplied: boolean;
      }>(`${base}/${d.id}/declare`, {
        method: "POST",
        timeoutMs: 20000,
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
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
        }),
      });
      setNotice(
        !result.propertyUpdated
          ? "O PDF foi lido. Este cadastro já foi aprovado ou está suspenso e não foi alterado."
          : result.areaApplied
            ? "O PDF foi lido e o cadastro do imóvel foi preenchido."
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
      <header className="documents-head">
        <div>
          <h2>Documentos do imóvel</h2>
          <p>
            Envie o PDF do CAR ou do CCIR. O sistema lê o texto do arquivo e preenche o cadastro.
          </p>
        </div>
        {onNavigate && (
          <button
            className="secondary"
            type="button"
            onClick={() => onNavigate("/produtor/propriedades")}
          >
            Voltar
          </button>
        )}
      </header>
      {!admin && (
        <fieldset disabled={busy}>
          <legend>Enviar documento</legend>
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
              <div>
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
                {!admin && d.status === "quarantine" && (
                  <button
                    disabled={busy}
                    onClick={() => void action(d, "confirm")}
                  >
                    Conferir envio
                  </button>
                )}
                {!admin && d.status !== "archived" && (
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
      {selected && (
        <section className="document-comparison" ref={comparison}>
          <div className="document-sheet-bar">
            <h3>Documento e cadastro</h3>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setSelected(null);
                setUrl("");
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
                <p>O texto do PDF preenche estes dados. Você não precisa digitar.</p>
                <dl>
                  {Object.entries({
                    CAR: form.carNumber,
                    INCRA: form.ccirNumber,
                    Imóvel: form.propertyRegisteredName,
                    Titular: form.holderName,
                    CPF: form.holderCpfNormalized,
                    Município: form.municipality,
                    "Área (ha)": form.totalAreaHectares,
                    "Reserva (ha)": form.legalReserveHectares,
                    "APP (ha)": form.appHectares,
                    "Consolidada (ha)": form.consolidatedRuralAreaHectares,
                    "Módulos": form.fiscalModules,
                  })
                    .filter(([, value]) => String(value || "").trim())
                    .map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <details>
                  <summary>Corrigir um dado lido errado</summary>
                <form
                  className="document-form"
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
                        setForm({ ...form, carNumber: e.target.value })
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
                        setForm({ ...form, ccirNumber: e.target.value })
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
                        setForm({
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
                        setForm({ ...form, holderName: e.target.value })
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
                        setForm({
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
                        setForm({ ...form, municipality: e.target.value })
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
                        setForm({ ...form, totalAreaHectares: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Reserva legal (ha)
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
                    APP (ha)
                    <input
                      inputMode="decimal"
                      value={form.appHectares}
                      onChange={(e) =>
                        setForm({ ...form, appHectares: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Área consolidada (ha)
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
                    Módulos fiscais
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
                <p>Conferência humana. Estes dados não aprovam o imóvel.</p>
                <dl>
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
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{textOrEmpty(v) || "Não informado"}</dd>
                    </div>
                  ))}
                </dl>
                {extraction && (
                  <ul>
                    {extraction.discrepancies.map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p>
                Este tipo fica anexado ao imóvel, mas não altera o cadastro.
                Use CAR ou CCIR para corrigir os dados.
              </p>
            )}
            <p className="document-disclaimer">
              A leitura usa o texto do PDF. Não consulta o SICAR e não aprova o imóvel.
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
              disabled={busy}
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
