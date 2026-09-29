import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { isEstimatedPerimeter } from "../../../shared/rural/estimatePropertyPerimeter";
import "./verificationQueue.css";

type Tab = "pending" | "in_review" | "decided";
type QueueRow = {
  id: string; status: string; property_name: string; municipality: string; line_vicinal: string;
  total_area_hectares: string | number | null; cultivated_area_hectares: string | number | null;
  latitude_sede: string | number | null; longitude_sede: string | number | null; producer_name: string;
  draft_data: { polygonGeojson?: unknown } | null; perimeter: { polygon_geojson?: unknown } | null;
  documents: Array<{ id: string; documentType: string; fileName: string; mimeType: string }> | null;
  extraction: { extraction_engine?: string; payload_jsonb?: Record<string, unknown> } | null;
};

const fileUrl = (id: string) => "/api/v1/admin/documents/" + id + "/file";

export function VerificationQueuePage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [active, setActive] = useState<QueueRow | null>(null);
  const [opinion, setOpinion] = useState("");
  const [trust, setTrust] = useState(3);
  const [checks, setChecks] = useState({ environmental: false, land: false, water: false });
  const [busy, setBusy] = useState("");

  async function load(next = tab) {
    setLoading(true);
    try {
      const r = await api<{ requests: QueueRow[] }>("/v1/admin/verification-queue?tab=" + next);
      setRows(r.requests);
    } catch { setNotice("Não foi possível carregar a fila de auditoria."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(tab); }, [tab]);

  const estimated = useMemo(() => {
    if (!active) return false;
    const raw = active.perimeter?.polygon_geojson ?? active.draft_data?.polygonGeojson;
    if (!raw) return false;
    return isEstimatedPerimeter(typeof raw === "string" ? raw : JSON.stringify(raw));
  }, [active]);

  const ready = checks.environmental && checks.land && checks.water && opinion.trim().length >= 10;

  async function claim(row: QueueRow) {
    setBusy(row.id); setNotice("");
    try {
      await api("/v1/admin/verification-queue/" + row.id + "/claim", { method: "POST", body: JSON.stringify({ commandId: crypto.randomUUID() }) });
      setTab("in_review"); setActive(row);
    } catch (e) {
      const err = e as { status?: number };
      setNotice(err.status === 403 ? "Sem permissão no setor de verificação documental." : err.status === 409 ? "Este chamado já foi capturado." : "Não foi possível capturar o chamado.");
    } finally { setBusy(""); }
  }

  async function decide(decision: "approved" | "rejected" | "adjustments_required") {
    if (!active) return;
    setBusy(decision); setNotice("");
    try {
      await api("/v1/admin/verification-queue/" + active.id + "/decide", {
        method: "POST",
        body: JSON.stringify({
          commandId: crypto.randomUUID(), decision, technicalOpinion: opinion, assignedTrustLevel: trust,
          checklistEnvironmentalOk: checks.environmental, checklistLandTenureOk: checks.land, checklistWaterQualityOk: checks.water,
        }),
      });
      setNotice(decision === "approved" ? "Imóvel homologado pelo analista humano." : decision === "rejected" ? "Imóvel recusado." : "Imóvel devolvido para ajustes.");
      setActive(null); setOpinion(""); setChecks({ environmental: false, land: false, water: false }); setTab("decided"); await load("decided");
    } catch (e) {
      setNotice((e as { status?: number }).status === 422 ? "Aprovação exige checklist completo e parecer." : "Não foi possível registrar a decisão.");
    } finally { setBusy(""); }
  }

  const payload = active?.extraction?.payload_jsonb ?? {};
  return (
    <section className="admin-page verification-queue">
      <header className="admin-page-header">
        <div><h1>Fila de auditoria humana</h1><p>Comparador triplo. A aprovação é exclusiva do analista.</p></div>
        <button className="admin-secondary verification-refresh" disabled={loading} onClick={() => void load()}>Atualizar</button>
      </header>
      {notice && <p className="admin-alert" role="status">{notice}</p>}
      <div className="verification-tabs" role="tablist">
        {([["pending", "Pendentes"], ["in_review", "Em análise"], ["decided", "Decididos"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => { setTab(id); setActive(null); }}>{label}</button>
        ))}
      </div>
      {loading ? <p role="status">Carregando fila…</p> : (
        <div className="verification-layout">
          <aside className="admin-card verification-list">
            {rows.length === 0 ? <p className="admin-empty">Nenhum chamado nesta aba.</p> : rows.map((row) => (
              <button key={row.id} className={"verification-item" + (active?.id === row.id ? " is-active" : "")} onClick={() => setActive(row)}>
                <strong>{row.property_name}</strong>
                <span>{row.municipality} · {row.line_vicinal}</span>
                <small>{row.producer_name} · {row.status}</small>
                {tab === "pending" && <span className="admin-table-action" onClick={(event) => { event.stopPropagation(); void claim(row); }}>{busy === row.id ? "Capturando…" : "Capturar"}</span>}
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
                </dl>
                {estimated && <p className="admin-badge admin-badge--pending">Contorno Geodésico Estimado</p>}
              </article>
              <article className="admin-card">
                <h2>2. Documento original</h2>
                {(active.documents ?? []).map((doc) => (
                  <div key={doc.id} className="verification-file">
                    <p>{doc.documentType} · {doc.fileName}</p>
                    {doc.mimeType === "application/pdf" ? <iframe title={doc.fileName} src={fileUrl(doc.id)} className="verification-frame" /> : <img alt="" src={fileUrl(doc.id)} className="verification-frame" />}
                    <a className="admin-secondary compact" href={fileUrl(doc.id)} target="_blank" rel="noreferrer">Abrir documento em outra aba</a>
                  </div>
                ))}
                {!active.documents?.length && <p className="admin-muted">Sem arquivo conferido.</p>}
              </article>
              <article className="admin-card">
                <h2>3. Evidência e checklist</h2>
                <p className="admin-muted">Motor: {active.extraction?.extraction_engine ?? "sem extração"}</p>
                <dl className="verification-dl">
                  <div><dt>CAR / registro</dt><dd>{String(payload.carNumber ?? payload.car_number ?? "—")}</dd></div>
                  <div><dt>Área no recibo</dt><dd>{String(payload.totalAreaHectares ?? payload.total_area_hectares ?? "—")}</dd></div>
                  <div><dt>Titular no documento</dt><dd>{String(payload.holderName ?? payload.holder_name ?? "—")}</dd></div>
                </dl>
                <label className="verification-check"><input type="checkbox" checked={checks.environmental} onChange={(e) => setChecks((c) => ({ ...c, environmental: e.target.checked }))} /> CAR regular sem sobreposições</label>
                <label className="verification-check"><input type="checkbox" checked={checks.land} onChange={(e) => setChecks((c) => ({ ...c, land: e.target.checked }))} /> Posse ou CCIR regular</label>
                <label className="verification-check"><input type="checkbox" checked={checks.water} onChange={(e) => setChecks((c) => ({ ...c, water: e.target.checked }))} /> Laudo de água potável / irrigação</label>
                <label>Parecer técnico<textarea value={opinion} onChange={(e) => setOpinion(e.target.value)} minLength={10} rows={5} /></label>
                <label>Trust level<select value={trust} onChange={(e) => setTrust(Number(e.target.value))}>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                <div className="verification-actions">
                  <button className="admin-primary" disabled={!ready || Boolean(busy)} onClick={() => void decide("approved")}>Aprovar imóvel</button>
                  <button className="admin-secondary" disabled={opinion.trim().length < 10 || Boolean(busy)} onClick={() => void decide("adjustments_required")}>Pedir ajustes</button>
                  <button className="admin-secondary" disabled={opinion.trim().length < 10 || Boolean(busy)} onClick={() => void decide("rejected")}>Recusar</button>
                </div>
              </article>
            </div>
          ) : <p className="admin-muted">Selecione um chamado para abrir o comparador triplo.</p>}
        </div>
      )}
    </section>
  );
}
