import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { DocumentsPanel } from "../documents/DocumentsPanel";
type Property = {
  id: string;
  revision: number;
  status: string;
  property_name: string;
  producer_name: string;
  municipality: string;
  line_vicinal: string;
  total_area_hectares: string;
  cultivated_area_hectares: string;
  water_source: string;
  irrigation_system: string;
  access_directions: string | null;
  activity: {
    activity_category: string;
    production_system: string;
    has_washing_facility: boolean;
  } | null;
};
export function AdminRuralPropertiesPage() {
  const [rows, setRows] = useState<Property[]>([]),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  const [documentProperty, setDocumentProperty] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  async function load() {
    setLoading(true);
    try {
      const r = await api<{ properties: Property[] }>(
        "/v1/admin/rural-properties",
      );
      setRows(r.properties);
    } catch {
      setNotice("Não foi possível carregar os imóveis.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function review(p: Property, decision: "verified" | "rejected") {
    setBusy(p.id);
    setNotice("");
    try {
      await api("/v1/admin/rural-properties/" + p.id + "/review", {
        method: "POST",
        body: JSON.stringify({
          decision,
          expectedRevision: p.revision,
          commandId: crypto.randomUUID(),
          reason: reasons[p.id] ?? "",
        }),
      });
      await load();
      setNotice(
        decision === "verified"
          ? "Imóvel validado."
          : "Imóvel devolvido ao produtor para revisão.",
      );
    } catch (e) {
      const err = e as { status?: number };
      setNotice(
        err.status === 401
          ? "Confirme seu acesso administrativo novamente antes de validar."
          : err.status === 409
            ? "Este imóvel foi alterado. Atualize a lista antes de decidir."
            : "Não foi possível concluir. Para devolver, informe o motivo da revisão.",
      );
    } finally {
      setBusy("");
    }
  }
  const label = (value: string) => value.replaceAll("_", " ");
  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>Validação de imóveis rurais</h1>
          <p>Cadastros enviados pelos produtores para análise.</p>
        </div>
        <button
          className="admin-secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          Atualizar
        </button>
      </header>
      {notice && (
        <p className="admin-alert" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">Carregando imóveis…</p>
      ) : rows.length === 0 ? (
        <p className="admin-empty">Nenhum imóvel enviado para análise.</p>
      ) : (
        rows.map((p) => (
          <article className="admin-card" key={p.id}>
            <h2>{p.property_name}</h2>
            <p>
              <strong>{p.producer_name}</strong> ·{" "}
              {p.status === "submitted"
                ? "Aguardando análise"
                : p.status === "verified"
                  ? "Validado"
                  : p.status === "rejected"
                    ? "Revisão solicitada"
                    : "Suspenso"}
            </p>
            <dl className="rural-review">
              <div>
                <dt>Localização</dt>
                <dd>
                  {p.line_vicinal} · {p.municipality}/RO
                </dd>
              </div>
              <div>
                <dt>Área total / cultivada</dt>
                <dd>
                  {p.total_area_hectares} / {p.cultivated_area_hectares} ha
                </dd>
              </div>
              <div>
                <dt>Água e irrigação</dt>
                <dd>
                  {label(p.water_source)} · {label(p.irrigation_system)}
                </dd>
              </div>
              <div>
                <dt>Produção</dt>
                <dd>
                  {p.activity
                    ? label(p.activity.activity_category) +
                      " · " +
                      label(p.activity.production_system)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Instalação de lavagem</dt>
                <dd>{p.activity?.has_washing_facility ? "Sim" : "Não"}</dd>
              </div>
              <div>
                <dt>Acesso</dt>
                <dd>{p.access_directions || "—"}</dd>
              </div>
            </dl>
            <button
              className="admin-secondary"
              onClick={() =>
                setDocumentProperty(documentProperty === p.id ? null : p.id)
              }
            >
              Documentos e extrações
            </button>
            {documentProperty === p.id && (
              <DocumentsPanel propertyId={p.id} admin />
            )}
            {p.status === "submitted" && (
              <>
                <label>
                  Motivo da revisão (obrigatório para devolver)
                  <textarea
                    maxLength={500}
                    value={reasons[p.id] ?? ""}
                    onChange={(e) =>
                      setReasons((v) => ({ ...v, [p.id]: e.target.value }))
                    }
                  />
                </label>
                <div className="admin-action-grid">
                  <button
                    className="admin-primary"
                    disabled={!!busy}
                    onClick={() => void review(p, "verified")}
                  >
                    Validar imóvel
                  </button>
                  <button
                    className="admin-secondary"
                    disabled={!!busy}
                    onClick={() => void review(p, "rejected")}
                  >
                    Solicitar revisão
                  </button>
                </div>
              </>
            )}
          </article>
        ))
      )}
    </section>
  );
}
