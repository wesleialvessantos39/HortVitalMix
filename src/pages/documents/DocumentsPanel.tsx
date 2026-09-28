import { useEffect, useRef, useState } from "react";
import { api, apiBase } from "../../lib/api";
import {
  documentLabels,
  type DocumentView,
  RequestUploadUrlSchema,
} from "../../../shared/contracts/documents";
import type { ExtractionView } from "../../../shared/contracts/aiExtraction";
import "./documents.css";
const statusLabels = {
  quarantine: "Aguardando conferência do arquivo",
  clean: "Arquivo conferido",
  rejected: "Arquivo rejeitado",
  archived: "Arquivado",
};
const errors: Record<string, string> = {
  AI_NOT_CONFIGURED:
    "A leitura automática ainda não está configurada. Seus documentos estão preservados para conferência humana.",
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
};
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
    [note, setNote] = useState(""),
    [job, setJob] = useState(""),
    [previewKind, setPreviewKind] = useState<"pdf" | "image" | "">("");
  const uploadAttempt = useRef<{
      fingerprint: string;
      commandId: string;
      documentId?: string;
    } | null>(null),
    generation = useRef(0);
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
    setNote("");
    setJob("");
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
      }
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
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
      await load();
      uploadAttempt.current = null;
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
  async function review(decision: "confirmed" | "disputed") {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      await api(`${base}/${selected.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          note,
          commandId: crypto.randomUUID(),
        }),
      });
      await open(selected);
      setNotice(
        decision === "confirmed"
          ? "Sua conferência foi registrada. A decisão administrativa permanece separada."
          : "Divergência registrada para análise administrativa.",
      );
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="documents-panel">
      <header>
        <h2>Documentos do imóvel</h2>
        <p>
          CAR, CCIR e comprovantes em acesso privado. Arquivo conferido não
          significa aprovação do imóvel.
        </p>
      </header>
      {onNavigate && (
        <button
          className="secondary"
          onClick={() => onNavigate("/produtor/propriedades")}
        >
          Voltar aos imóveis
        </button>
      )}
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
            De 1 KB a 15 MB. Fotografe todas as informações com nitidez. Até 20
            documentos por imóvel.
          </small>
        </fieldset>
      )}
      {notice && (
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
                <strong>{d.file_name}</strong>
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
                    Visualizar e conferir
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
        <section className="document-comparison">
          <div>
            <h3>Documento original</h3>
            {url ? (
              <>
                <a
                  className="document-open"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir documento em outra aba
                </a>
                <a href={url} download={selected.file_name}>
                  Baixar original
                </a>
                {previewKind === "image" ||
                selected.mime_type.startsWith("image/") ? (
                  <img
                    alt="Documento original enviado"
                    referrerPolicy="no-referrer"
                    src={url}
                  />
                ) : (
                  <iframe
                    title="Documento original"
                    referrerPolicy="no-referrer"
                    src={url}
                  />
                )}
                <p className="document-phone-hint">
                  No celular, toque em Abrir documento em outra aba. O PDF abre
                  em tela cheia. A extração dos dados não depende dessa
                  pré-visualização.
                </p>
              </>
            ) : (
              <p>Visualização indisponível ou expirada.</p>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void open(selected)}
            >
              Renovar visualização
            </button>
          </div>
          <div>
            <h3>Conferência dos dados</h3>
            {extraction ? (
              <>
                <p>
                  {extraction.status === "flagged_discrepancy"
                    ? "Há dados que precisam de conferência."
                    : "Leitura concluída. Confira os dados com o original."}
                </p>
                <dl>
                  {Object.entries({
                    CAR: extraction.payload_jsonb.carNumber,
                    "Código INCRA": extraction.payload_jsonb.ccirNumber,
                    Imóvel: extraction.payload_jsonb.propertyRegisteredName,
                    Titular: extraction.payload_jsonb.holderName,
                    CPF: extraction.payload_jsonb.holderCpfNormalized,
                    Município: extraction.payload_jsonb.municipality,
                    "Área total (ha)":
                      extraction.payload_jsonb.totalAreaHectares,
                    "Reserva legal (ha)":
                      extraction.payload_jsonb.legalReserveHectares,
                    "APP (ha)": extraction.payload_jsonb.appHectares,
                    "Área consolidada (ha)":
                      extraction.payload_jsonb.consolidatedRuralAreaHectares,
                    "Módulos fiscais": extraction.payload_jsonb.fiscalModules,
                    "Diferença de área (%)": extraction.area_difference_percent,
                    "Confiança geral (%)": Math.round(
                      extraction.payload_jsonb.confidenceScore * 100,
                    ),
                  }).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v ?? "Não identificado"}</dd>
                    </div>
                  ))}
                </dl>
                <ul>
                  {extraction.discrepancies.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
                <details>
                  <summary>Texto extraído e confiança por campo</summary>
                  <pre>{extraction.payload_jsonb.rawText}</pre>
                  <pre>
                    {JSON.stringify(
                      extraction.payload_jsonb.fieldConfidence,
                      null,
                      2,
                    )}
                  </pre>
                </details>
                {extraction.review && (
                  <p>
                    Última conferência:{" "}
                    {extraction.review.decision === "confirmed"
                      ? "confirmada pelo produtor"
                      : "divergência sinalizada"}
                    . {extraction.review.note}
                  </p>
                )}
                {!admin && (
                  <>
                    <label>
                      Observação para conferência
                      <textarea
                        maxLength={2000}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                    <div className="document-actions">
                      <button
                        disabled={busy}
                        onClick={() => void review("confirmed")}
                      >
                        Confirmar dados
                      </button>
                      <button
                        className="secondary"
                        disabled={busy || note.trim().length < 5}
                        onClick={() => void review("disputed")}
                      >
                        Há divergência nos números
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <p>
                  {job === "processing"
                    ? "Leitura em andamento. Atualize a visualização em alguns instantes."
                    : ai === false
                      ? "Leitura automática ainda não configurada. Documento disponível para conferência humana."
                      : "A leitura automática auxilia a conferência de CAR e CCIR."}
                </p>
                {!admin &&
                  ["car_sicar", "ccir_incra"].includes(
                    selected.document_type,
                  ) && (
                    <button
                      disabled={busy || ai === false}
                      onClick={() => void action(selected, "extraction")}
                    >
                      Extrair dados do documento
                    </button>
                  )}
              </>
            )}
            <p className="document-disclaimer">
              A leitura não consulta SICAR/INCRA nem comprova titularidade,
              regularidade ambiental ou ausência de sobreposições. A decisão
              cabe à análise humana.
            </p>
          </div>
        </section>
      )}
    </section>
  );
}
