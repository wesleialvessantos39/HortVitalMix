import { useEffect, useState, type FormEvent } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import {
  KpiDashboardSchema,
  KpiPeriodSchema,
  type KpiDashboard,
} from "../../../shared/contracts/kpi";
import { usePortalSession } from "../../components/notifications/NotificationProvider";
import { AdminReauthentication } from "../../components/commerce/AdminReauthentication";
import { money } from "../../lib/commerce";
import "./executiveBi.css";
const iso = (date: Date) => date.toISOString().slice(0, 10);
function days(start: string, end: string) {
  const list: string[] = [];
  for (
    let d = new Date(start + "T12:00:00Z");
    iso(d) <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    list.push(iso(d));
  return list;
}
function errorMessage(e: unknown) {
  return ["REAUTH_REQUIRED", "RECENT_AUTH_REQUIRED"].includes(
    (e as ApiFailure).message,
  )
    ? "Confirme sua sessão administrativa para calcular as métricas."
    : (e as Error).message === "KPI_FUTURE_DATE"
      ? "Selecione uma data até hoje."
      : "Não foi possível consultar ou calcular agora. Tente novamente.";
}
export default function ExecutiveBiDashboardPage() {
  const session = usePortalSession();
  const [reauth, setReauth] = useState(false);
  const today = iso(new Date()),
    start = new Date();
  start.setUTCDate(start.getUTCDate() - 6);
  const [period, setPeriod] = useState({
      startDate: iso(start),
      endDate: today,
    }),
    [draft, setDraft] = useState(period),
    [data, setData] = useState<KpiDashboard | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0),
    [progress, setProgress] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    setData(null);
    void api(
      `/v1/admin/bi?startDate=${period.startDate}&endDate=${period.endDate}`,
      { signal: abort.signal },
    )
      .then((v) => {
        if (!abort.signal.aborted) setData(KpiDashboardSchema.parse(v));
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorMessage(e));
      });
    return () => abort.abort();
  }, [period, version]);
  function select(event: FormEvent) {
    event.preventDefault();
    const p = KpiPeriodSchema.safeParse(draft);
    if (!p.success) {
      setError(
        "Escolha um período de até 31 dias, com início anterior ao fim.",
      );
      return;
    }
    setNotice("");
    setPeriod(p.data);
  }
  async function calculate() {
    if (busy || !data || reauth) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const dates = days(period.startDate, period.endDate).filter(
        (d) => d <= data.today,
      );
      for (let i = 0; i < dates.length; i++) {
        setProgress(`Calculando ${i + 1} de ${dates.length} dias…`);
        await api("/v1/admin/bi/calculate", {
          method: "POST",
          body: JSON.stringify({ referenceDate: dates[i] }),
        });
      }
      setNotice(
        "Métricas calculadas e salvas. Repetir o cálculo atualiza os valores, sem somá-los novamente.",
      );
    } catch (e) {
      if (
        ["REAUTH_REQUIRED", "RECENT_AUTH_REQUIRED"].includes(
          (e as Error).message,
        )
      )
        setReauth(true);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setProgress("");
      setVersion((v) => v + 1);
    }
  }
  const value = (code: string, date?: string) =>
    data?.metrics
      .filter((m) => m.code === code && (!date || m.referenceDate === date))
      .reduce((n, m) => n + m.value, 0) ?? 0;
  const calculatedDates = new Set(
    data?.metrics
      .filter((m) => m.code === "gmv_cents")
      .map((m) => m.referenceDate),
  );
  const dateList = days(period.startDate, period.endDate),
    orders = value("delivered_orders"),
    quotes = value("checkout_quotes"),
    gmv = value("gmv_cents");
  return (
    <section className="admin-page hvm-executive-bi">
      <header className="admin-page-header">
        <div>
          <h1>
            <BarChart3 aria-hidden="true" /> BI executivo
          </h1>
          <p>
            Resultados diários calculados a partir dos registros da plataforma.
          </p>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => setVersion((v) => v + 1)}
        >
          <RefreshCw size={17} /> Atualizar leitura
        </button>
      </header>
      <form className="admin-card hvm-bi-filters" onSubmit={select}>
        <label>
          Data inicial
          <input
            type="date"
            required
            value={draft.startDate}
            disabled={busy}
            onChange={(e) =>
              setDraft((v) => ({ ...v, startDate: e.target.value }))
            }
          />
        </label>
        <label>
          Data final
          <input
            type="date"
            required
            value={draft.endDate}
            disabled={busy}
            onChange={(e) =>
              setDraft((v) => ({ ...v, endDate: e.target.value }))
            }
          />
        </label>
        <button className="secondary" disabled={busy}>
          Consultar período
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || reauth || !data || period.startDate > data.today}
          onClick={() => void calculate()}
        >
          Calcular período
        </button>
      </form>
      {reauth && session && (
        <AdminReauthentication
          session={session}
          onConfirmed={() => {
            setReauth(false);
            setError("");
          }}
        />
      )}
      {error && (
        <p role="alert" className="admin-alert admin-alert--error">
          {error}
        </p>
      )}
      {(notice || progress) && (
        <p role="status" className="admin-alert">
          {progress || notice}
        </p>
      )}
      {!data && !error && <p role="status">Carregando métricas salvas…</p>}
      {data && (
        <>
          <p className="hvm-bi-context">
            Fuso dos registros: {data.timezone} · {calculatedDates.size} de{" "}
            {dateList.length} dias calculados. Dias sem cálculo aparecem como
            “Não calculado”. Hoje é parcial até o momento do cálculo.
          </p>
          <div className="hvm-bi-cards">
            {[
              ["GMV de alimentos", money(gmv)],
              ["Ticket médio do período", money(orders ? gmv / orders : 0)],
              ["Pedidos entregues", String(orders)],
              [
                "Conversão de checkout",
                quotes
                  ? ((value("converted_quotes") * 100) / quotes).toFixed(2) +
                    "%"
                  : "Sem cotações",
              ],
              [
                "Receita de assinaturas",
                money(value("subscription_revenue_cents")),
              ],
            ].map(([label, n]) => (
              <article className="admin-card" key={label}>
                <span>{label}</span>
                <strong>{calculatedDates.size ? n : "Não calculado"}</strong>
              </article>
            ))}
          </div>
          <div className="hvm-bi-charts">
            {["gmv_cents", "avg_ticket_cents", "active_producers"].map(
              (code) => {
                const definition = data.definitions.find(
                    (d) => d.code === code,
                  ),
                  series = dateList.map((d) => ({
                    date: d,
                    metric: data.metrics.find(
                      (m) => m.code === code && m.referenceDate === d,
                    ),
                  })),
                  max = Math.max(1, ...series.map((s) => s.metric?.value ?? 0));
                return (
                  <article className="admin-card" key={code}>
                    <h2>{definition?.name}</h2>
                    <div
                      className="hvm-bi-chart"
                      role="img"
                      aria-label={`${definition?.name} por dia. Valores disponíveis na tabela abaixo.`}
                    >
                      {series.map((s) => (
                        <div key={s.date} className="hvm-bi-bar">
                          <div
                            style={{
                              height:
                                (s.metric
                                  ? Math.max(2, (s.metric.value / max) * 120)
                                  : 0) + "px",
                            }}
                            title={
                              s.metric
                                ? `${s.date}: ${s.metric.value}`
                                : "Não calculado"
                            }
                          />
                          <small>{s.date.slice(8)}</small>
                        </div>
                      ))}
                    </div>
                    <p>{definition?.formulaDescription}</p>
                  </article>
                );
              },
            )}
          </div>
          <div className="admin-card hvm-bi-table-wrap">
            <h2>Valores diários</h2>
            <div
              className="hvm-bi-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Tabela de indicadores por dia"
            >
              <table>
                <caption>
                  Métricas armazenadas. Produtores ativos são distintos por dia;
                  não se somam entre dias.
                </caption>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>GMV</th>
                    <th>Ticket médio</th>
                    <th>Produtores ativos</th>
                    <th>Conversão</th>
                    <th>Assinaturas</th>
                    <th>Último cálculo</th>
                  </tr>
                </thead>
                <tbody>
                  {dateList.map((date) => {
                    const metric = data.metrics.find(
                      (m) => m.code === "gmv_cents" && m.referenceDate === date,
                    );
                    return (
                      <tr key={date}>
                        <th scope="row">
                          {date.split("-").reverse().join("/")}
                        </th>
                        {metric ? (
                          <>
                            <td>{money(value("gmv_cents", date))}</td>
                            <td>{money(value("avg_ticket_cents", date))}</td>
                            <td>{value("active_producers", date)}</td>
                            <td>
                              {value("conversion_rate", date).toFixed(2)}%
                            </td>
                            <td>
                              {money(value("subscription_revenue_cents", date))}
                            </td>
                            <td>
                              {new Date(metric.calculatedAt).toLocaleString(
                                "pt-BR",
                                { timeZone: data.timezone },
                              )}
                            </td>
                          </>
                        ) : (
                          <td colSpan={6}>Não calculado</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <details className="admin-card">
            <summary>Como os indicadores são calculados</summary>
            {data.definitions.map((d) => (
              <p key={d.code}>
                <strong>{d.name}:</strong> {d.formulaDescription}
              </p>
            ))}
            <p>
              O painel consulta os valores salvos. O cálculo é manual;
              pagamentos, assinaturas e valores da plataforma continuam em seus
              módulos de origem.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
