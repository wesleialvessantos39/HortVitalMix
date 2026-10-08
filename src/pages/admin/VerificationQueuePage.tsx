import { PageLoading } from "../../components/PageLoading";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { readAdminAccessToken } from "../../lib/adminSessionStore";
import { isEstimatedPerimeter } from "../../../shared/rural/estimatePropertyPerimeter";
import "./verificationQueue.css";

type Tab = "pending" | "in_review" | "decided" | "archived";
type QueueDoc = { id: string; documentType: string; fileName: string; mimeType: string; status?: string };
type HistoryItem = { decision: string; technicalOpinion: string; decidedAt: string };
type QueueRow = {
  id: string; status: string; property_name: string; municipality: string; line_vicinal: string;
  total_area_hectares: string | number | null; cultivated_area_hectares: string | number | null;
  latitude_sede: string | number | null; longitude_sede: string | number | null; producer_name: string;
  draft_data: { polygonGeojson?: unknown } | null; perimeter: { polygon_geojson?: unknown } | null;
  documents: QueueDoc[] | null;
  extraction: { payload_jsonb?: Record<string, unknown> } | null;
  last_decision?: { decision?: string; technical_opinion?: string; decided_at?: string; checklist_environmental_ok?: boolean; checklist_land_tenure_ok?: boolean; checklist_water_quality_ok?: boolean } | null;
  archived_at?: string | null;
  superseded_at?: string | null;
  decision_history?: HistoryItem[] | null;
};

const fileUrl = (id: string) => "/api/v1/admin/documents/" + id + "/file";

const statusLabel: Record<string, string> = {
  pending: "Pendente",
  claimed: "Em análise",
  in_review: "Em análise",
  approved: "Aprovado",
  rejected: "Recusado",
  adjustments_required: "Ajustes solicitados",
  escalated: "Escalado",
};

const decisionLabel: Record<string, string> = {
  approved: "Aprovado",
  rejected: "Recusado",
  adjustments_required: "Ajustes solicitados",
};

const documentTypeLabel: Record<string, string> = {
  car_sicar: "CAR / SICAR",
  ccir_incra: "CCIR / INCRA",
  dap_caf: "DAP / CAF",
  laudo_agua: "Laudo de água",
  certidao_posse: "Certidão de posse",
  outro: "Outro documento",
  water_report: "Laudo de água",
  land_title: "Título ou posse",
  other: "Documento",
};

export function VerificationQueuePage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [active, setActive] = useState<QueueRow | null>(null);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [opinion, setOpinion] = useState("");
  const [checks, setChecks] = useState({ environmental: false, land: false, water: false });
  const [busy, setBusy] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");

  async function load(next = tab) {
    setLoading(true);
    try {
      const r = await api<{ requests: QueueRow[] }>("/v1/admin/verification-queue?tab=" + next);
      setRows(r.requests);
      setActive((current) => current ? r.requests.find((item) => item.id === current.id) ?? null : null);
    } catch { setNotice("Não foi possível carregar a fila de auditoria."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(tab); }, [tab]);

  useEffect(() => {
    const docs = active?.documents ?? [];
    if (!docs.length) { setSelectedDocId(""); return; }
    if (!docs.some((doc) => doc.id === selectedDocId)) setSelectedDocId(docs[0].id);
  }, [active, selectedDocId]);

  const estimated = useMemo(() => {
    if (!active) return false;
    const raw = active.perimeter?.polygon_geojson ?? active.draft_data?.polygonGeojson;
    if (!raw) return false;
    return isEstimatedPerimeter(typeof raw === "string" ? raw : JSON.stringify(raw));
  }, [active]);

  const ready = checks.environmental && checks.land && checks.water && opinion.trim().length >= 10;
  const selectedDoc = (active?.documents ?? []).find((doc) => doc.id === selectedDocId) ?? null;
  const documents = active?.documents ?? [];

  useEffect(() => {
    if (!selectedDoc) {
      setPreviewUrl("");
      setPreviewError("");
      return;
    }
    const controller = new AbortController();
    let objectUrl = "";
    setPreviewError("");
    setPreviewUrl("");
    const token = readAdminAccessToken();
    fetch("/api/v1/admin/documents/" + selectedDoc.id + "/file", {
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        "X-HVM-Request": "1",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("documento");
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((error: { name?: string }) => {
        if (error?.name === "AbortError") return;
        setPreviewError("Não foi possível abrir este documento. Use Abrir em outra aba.");
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedDoc?.id]);

  async function claim(row: QueueRow) {
    setBusy(row.id); setNotice("");
    try {
      await api("/v1/admin/verification-queue/" + row.id + "/claim", { method: "POST", body: JSON.stringify({ commandId: crypto.randomUUID() }) });
      setTab("in_review");
      setActive({ ...row, status: "in_review" });
    } catch (e) {
      const err = e as { status?: number };
      setNotice(err.status === 403 ? "Sem permissão no setor de verificação documental." : err.status === 409 ? "Este chamado já está em análise." : err.status === 401 ? "Entre novamente com e-mail e senha. O acesso de administrador vale em qualquer aparelho." : "Não foi possível colocar em análise.");
    } finally { setBusy(""); }
  }

  async function decide(decision: "approved" | "rejected" | "adjustments_required") {
    if (!active) return;
    setBusy(decision); setNotice("");
    try {
      await api("/v1/admin/verification-queue/" + active.id + "/decide", {
        method: "POST",
        body: JSON.stringify({
          commandId: crypto.randomUUID(), decision, technicalOpinion: opinion, assignedTrustLevel: 3,
          checklistEnvironmentalOk: checks.environmental, checklistLandTenureOk: checks.land, checklistWaterQualityOk: checks.water,
        }),
      });
      const nextTab: Tab = decision === "approved" ? "archived" : "decided";
      setNotice(decision === "approved" ? "Imóvel aprovado e arquivado em modo somente leitura. O produtor já vê a situação Aprovado." : decision === "rejected" ? "Imóvel recusado. O parecer técnico foi enviado ao produtor, informando o que precisa ser corrigido." : "Imóvel devolvido para correção. Ele foi para Decididos e o produtor vê o parecer técnico com o que corrigir.");
      setActive(null); setOpinion(""); setChecks({ environmental: false, land: false, water: false }); setTab(nextTab); await load(nextTab);
    } catch (e) {
      setNotice((e as { status?: number }).status === 422 ? "Aprovação exige checklist completo e parecer." : (e as { status?: number }).status === 409 ? "Abra o chamado em análise antes de decidir." : "Não foi possível registrar a decisão.");
    } finally { setBusy(""); }
  }

  const payload = active?.extraction?.payload_jsonb ?? {};
  const history = active?.decision_history ?? [];
  return (
    <section className="admin-page verification-queue">
      <header className="admin-page-header">
        <div><h1>Fila de auditoria humana</h1><p>Pendências, análises, decisões e imóveis aprovados arquivados.</p></div>
        <button className="admin-secondary verification-refresh" disabled={loading} onClick={() => void load()}>Atualizar</button>
      </header>
      {notice && <p className="admin-alert" role="status">{notice}</p>}
      <div className="verification-tabs" role="tablist">
        {([["pending", "Pendentes"], ["in_review", "Em análise"], ["decided", "Decididos"], ["archived", "Arquivados"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => { setTab(id); setActive(null); }}>{label}</button>
        ))}
      </div>
      {loading ? <PageLoading label="Carregando fila…" /> : (
        <div className="verification-layout">
          <aside className="admin-card verification-list">
            {rows.length === 0 ? <p className="admin-empty">Nenhum chamado nesta aba.</p> : rows.map((row) => (
              <button key={row.id} className={"verification-item" + (active?.id === row.id ? " is-active" : "")} onClick={() => setActive(row)}>
                <strong>{row.property_name}</strong>
                <span>{row.municipality} · {row.line_vicinal}</span>
                <small>{row.producer_name} · {tab === "archived" ? "Arquivado — aprovado" : statusLabel[row.status] ?? row.status}</small>
                {tab === "pending" && <span className="admin-table-action" onClick={(event) => { event.stopPropagation(); void claim(row); }}>{busy === row.id ? "Enviando…" : "Colocar em análise"}</span>}
              </button>
            ))}
          </aside>
          {active ? (
            <div className="verification-triple">
              <article className="admin-card">
                <h2>1. Dados do imóvel</h2>
                <dl className="verification-dl">
                  <div><dt>Nome</dt><dd>{active.property_name}</dd></div>
                  <div><dt>Linha vicinal</dt><dd>{active.line_vicinal}</dd></div>
                  <div><dt>Município</dt><dd>{active.municipality}</dd></div>
                  <div><dt>Área total</dt><dd>{active.total_area_hectares} ha</dd></div>
                  <div><dt>Área cultivada</dt><dd>{active.cultivated_area_hectares} ha</dd></div>
                  <div><dt>Sede GPS</dt><dd>{active.latitude_sede}, {active.longitude_sede}</dd></div>
                  <div><dt>Situação</dt><dd>{statusLabel[active.status] ?? active.status}</dd></div>
                </dl>
                {estimated && <p className="admin-badge admin-badge--pending">Contorno geodésico estimado</p>}
                {history.length > 0 && (
                  <div className="verification-history">
                    <h3>Histórico deste imóvel</h3>
                    {history.map((item, index) => (
                      <article key={item.decidedAt + index}>
                        <strong>{decisionLabel[item.decision] ?? item.decision}</strong>
                        <small>{new Date(item.decidedAt).toLocaleString("pt-BR")}</small>
                        <p>{item.technicalOpinion}</p>
                      </article>
                    ))}
                  </div>
                )}
              </article>
              <article className="admin-card">
                <h2>2. Documentos enviados</h2>
                {documents.length > 1 && (
                  <label>Selecionar documento
                    <select value={selectedDocId} onChange={(event) => setSelectedDocId(event.target.value)}>
                      {documents.map((doc, index) => (
                        <option key={doc.id} value={doc.id}>{index + 1}. {documentTypeLabel[doc.documentType] ?? "Documento"} — {doc.fileName}</option>
                      ))}
                    </select>
                  </label>
                )}
                {selectedDoc ? (
                  <div className="verification-file">
                    <p>{documentTypeLabel[selectedDoc.documentType] ?? "Documento"} · {selectedDoc.fileName}</p>
                    {previewError && <p className="admin-alert">{previewError}</p>}
                    {previewUrl && selectedDoc.mimeType === "application/pdf" && <iframe title={selectedDoc.fileName} src={previewUrl} className="verification-frame" />}
                    {previewUrl && selectedDoc.mimeType !== "application/pdf" && <img alt={selectedDoc.fileName} src={previewUrl} className="verification-frame" />}
                    <a className="admin-secondary compact" href={previewUrl || fileUrl(selectedDoc.id)} target="_blank" rel="noreferrer">Abrir em outra aba</a>
                  </div>
                ) : <p className="admin-muted">Nenhum documento enviado com este cadastro.</p>}
                {documents.length > 0 && <p className="admin-muted">{documents.length} documento{documents.length > 1 ? "s" : ""} neste imóvel.</p>}
              </article>
              <article className="admin-card">
                {tab === "archived" ? (
                  <>
                    <h2>3. Resultado arquivado</h2>
                    <p className="verification-archive-badge">Aprovado · somente leitura</p>
                    <dl className="verification-dl">
                      <div><dt>Situação</dt><dd>Arquivado — aprovado</dd></div>
                      <div><dt>Decidido em</dt><dd>{active.last_decision?.decided_at ? new Date(active.last_decision.decided_at).toLocaleString("pt-BR") : "—"}</dd></div>
                      <div><dt>Parecer técnico</dt><dd>{active.last_decision?.technical_opinion ?? "—"}</dd></div>
                      <div><dt>Checklist ambiental</dt><dd>{active.last_decision?.checklist_environmental_ok ? "Conferido" : "—"}</dd></div>
                      <div><dt>Checklist fundiário</dt><dd>{active.last_decision?.checklist_land_tenure_ok ? "Conferido" : "—"}</dd></div>
                      <div><dt>Checklist hídrico</dt><dd>{active.last_decision?.checklist_water_quality_ok ? "Conferido" : "—"}</dd></div>
                    </dl>
                    <p className="verification-readonly">Este imóvel foi aprovado e está arquivado apenas para consulta. Nenhuma decisão ou dado pode ser alterado por esta tela.</p>
                  </>
                ) : tab === "decided" ? (
                  <>
                    <h2>3. Resultado da análise</h2>
                    <dl className="verification-dl">
                      <div><dt>Decisão</dt><dd>{decisionLabel[active.last_decision?.decision ?? active.status] ?? statusLabel[active.status] ?? active.status}</dd></div>
                      <div><dt>Decidido em</dt><dd>{active.last_decision?.decided_at ? new Date(active.last_decision.decided_at).toLocaleString("pt-BR") : "—"}</dd></div>
                      <div><dt>Parecer técnico</dt><dd>{active.last_decision?.technical_opinion ?? "—"}</dd></div>
                    </dl>
                    <p className="verification-readonly">Decisão concluída. O parecer continua disponível ao produtor e no histórico do imóvel.</p>
                  </>
                ) : active.status === "pending" ? (
                  <>
                    <h2>3. Iniciar análise</h2>
                    <p className="admin-muted">Coloque o imóvel em análise para habilitar checklist, parecer e decisão.</p>
                    <div className="verification-actions">
                      <button className="admin-primary" disabled={Boolean(busy)} onClick={() => void claim(active)}>{busy === active.id ? "Enviando…" : "Colocar em análise"}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <h2>3. Conferência e parecer</h2>
                    <dl className="verification-dl">
                      <div><dt>CAR / registro</dt><dd>{String(payload.carNumber ?? payload.car_number ?? "—")}</dd></div>
                      <div><dt>Área no recibo</dt><dd>{String(payload.totalAreaHectares ?? payload.total_area_hectares ?? "—")}</dd></div>
                      <div><dt>Titular no documento</dt><dd>{String(payload.holderName ?? payload.holder_name ?? "—")}</dd></div>
                    </dl>
                    <label className="verification-check"><input type="checkbox" checked={checks.environmental} onChange={(e) => setChecks((c) => ({ ...c, environmental: e.target.checked }))} /> CAR regular sem sobreposições</label>
                    <label className="verification-check"><input type="checkbox" checked={checks.land} onChange={(e) => setChecks((c) => ({ ...c, land: e.target.checked }))} /> Posse ou CCIR regular</label>
                    <label className="verification-check"><input type="checkbox" checked={checks.water} onChange={(e) => setChecks((c) => ({ ...c, water: e.target.checked }))} /> Laudo de água potável / irrigação</label>
                    <label>Parecer técnico para o produtor<textarea value={opinion} onChange={(e) => setOpinion(e.target.value)} minLength={10} rows={5} placeholder="Escreva o motivo e o que o produtor precisa corrigir. Este texto aparece no cadastro dele." /></label>
                    <div className="verification-actions">
                      <button className="admin-primary" disabled={!ready || Boolean(busy)} onClick={() => void decide("approved")}>Aprovar imóvel</button>
                      <button className="admin-secondary" disabled={opinion.trim().length < 10 || Boolean(busy)} onClick={() => void decide("adjustments_required")}>Devolver para correção</button>
                      <button className="admin-secondary" disabled={opinion.trim().length < 10 || Boolean(busy)} onClick={() => void decide("rejected")}>Recusar</button>
                    </div>
                  </>
                )}
              </article>
            </div>
          ) : <p className="admin-muted">Selecione um chamado para abrir o comparador triplo.</p>}
        </div>
      )}
    </section>
  );
}
