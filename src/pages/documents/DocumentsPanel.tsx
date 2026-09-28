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
  municipality: "Ariquemes",
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
    municipality: textOrEmpty(fields.municipality) || "Ariquemes",
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
    [form, setForm] = useState(blankForm);
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
      <header>
        <h2>Documentos do imóvel</h2>
        <p>
          CAR, CCIR e comprovantes em acesso privado. Arquivo conferido não
          significa aprovação do imóvel. Toque em Visualizar e conferir para
          ver o arquivo e informar os dados — a leitura automática é opcional.
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
            <h3>Dados do documento</h3>
            {notice && (
              <p role="alert" className="account-notice">
                {notice}
              </p>
            )}
            {!admin &&
            ["car_sicar", "ccir_incra"].includes(selected.document_type) ? (
              <>
                <p>
                  Copie os números do arquivo. Não é preciso leitura automática.
                  Ao salvar, o cadastro do imóvel é corrigido. O envio para
                  análise leva o cadastro e este documento juntos, só para uma
                  pessoa conferir e aprovar.
                </p>
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
                    Salvar dados e corrigir o cadastro
                  </button>
                </form>
                {extraction && extraction.discrepancies.length > 0 && (
                  <ul>
                    {extraction.discrepancies.map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                )}
                <details>
                  <summary>Tentar leitura automática (opcional)</summary>
                  <p>
                    {job === "processing"
                      ? "Leitura em andamento. Atualize a visualização em alguns instantes."
                      : ai === false
                        ? "A leitura automática não está configurada. O formulário acima já basta."
                        : "Se preferir, a leitura tenta preencher o formulário. Confira tudo antes de salvar."}
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || ai === false}
                    onClick={() => void action(selected, "extraction")}
                  >
                    Tentar leitura automática
                  </button>
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
              Nem o formulário nem a leitura automática consultam SICAR ou
              INCRA. Não comprovam titularidade, regularidade ambiental ou
              ausência de sobreposições. A aprovação é somente humana.
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
                  em tela cheia para você copiar os números no formulário.
                </p>
              </>
            ) : (
              <p>Visualização indisponível ou expirada.</p>
            )}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void open(selected)}
            >
              Renovar visualização
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
