import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, Ban, CreditCard, FileCheck2, Landmark,
  ListTree, MapPin, RefreshCw, Settings2, ShieldCheck, UsersRound,
  type LucideIcon,
} from "lucide-react";
import { hasAdminPermission } from "../../../shared/adminPermissions";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import {
  AdminDashboardResponseSchema,
  type AdminDashboardResponse,
} from "../../../shared/contracts/adminDashboard";
import { AccountGreeting } from "../../components/AccountGreeting";
import { PageLoading } from "../../components/PageLoading";
import { api, type ApiFailure } from "../../lib/api";
import "./dashboard.css";

type Props = { access: AdminVerifySessionResponse; onNavigate: (to: string) => void };
type Department = AdminDashboardResponse["departments"][number];
type Metric = Department["metrics"][number];

const DEPARTMENT_PRESENTATION: Record<string, { title: string; icon: LucideIcon }> = {
  account_governance: { title: "Contas e acessos", icon: UsersRound },
  document_verification: { title: "Documentos", icon: FileCheck2 },
  catalog_moderation: { title: "Catálogo", icon: ListTree },
  finance_ops: { title: "Financeiro", icon: Landmark },
  location_management: { title: "Localidades", icon: MapPin },
  platform_configuration: { title: "Plataforma", icon: Settings2 },
  refund_management: { title: "Reembolsos", icon: Ban },
  complaint_management: { title: "Denúncias", icon: ShieldCheck },
  payment_configuration: { title: "Pagamentos", icon: CreditCard },
  subscription_management: { title: "Assinaturas e planos", icon: CreditCard },
  review_management: { title: "Avaliações e reputação", icon: ShieldCheck },
  refund_policy: { title: "Política de reembolso", icon: Ban },
};

function metricValue(metric: Metric) {
  if (metric.unit === "currency_cents")
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(metric.value / 100);
  return new Intl.NumberFormat("pt-BR").format(metric.value);
}

export function AdminDashboardPage({ access, onNavigate }: Props) {
  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const refresh = useRef<() => void>(() => undefined);
  const scopeKey = JSON.stringify([access.role, [...access.sectors].sort(), [...(access.deniedSectors ?? [])].sort()]);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    setData(null);
    setError(null);
    setSelectedSector(null);

    async function load() {
      if (inFlight || !active) return;
      inFlight = true;
      setRefreshing(true);
      try {
        const response = await api<unknown>("/v1/admin/dashboard", { signal: controller.signal });
        const parsed = AdminDashboardResponseSchema.safeParse(response);
        if (!parsed.success) throw new Error("INVALID_DASHBOARD");
        if (!active) return;
        setData(parsed.data);
        setError(null);
      } catch (cause) {
        if (active) {
          const status = (cause as ApiFailure).status;
          if (status === 401 || status === 403) {
            setData(null);
            setSelectedSector(null);
            setError("Sua sessão ou seus poderes mudaram. Confirme seu acesso para consultar os indicadores.");
          } else setError("Não foi possível atualizar os indicadores. Tente novamente.");
        }
      } finally {
        inFlight = false;
        if (active) setRefreshing(false);
      }
    }

    const reloadVisible = () => {
      if (document.visibilityState !== "hidden") void load();
    };
    refresh.current = () => void load();
    void load();
    const timer = window.setInterval(reloadVisible, 30_000);
    window.addEventListener("focus", reloadVisible);
    document.addEventListener("visibilitychange", reloadVisible);
    window.addEventListener("hvm:notifications-changed", reloadVisible);
    window.addEventListener("hvm:notifications-updated", reloadVisible);
    window.addEventListener("hvm:departments-changed", reloadVisible);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", reloadVisible);
      document.removeEventListener("visibilitychange", reloadVisible);
      window.removeEventListener("hvm:notifications-changed", reloadVisible);
      window.removeEventListener("hvm:notifications-updated", reloadVisible);
      window.removeEventListener("hvm:departments-changed", reloadVisible);
    };
  }, [scopeKey]);

  // The endpoint enforces permissions; filtering again also avoids displaying
  // a previously loaded department after access is changed in this session.
  const departments = data?.departments.filter(department => hasAdminPermission(access, department.sector)) ?? [];
  const selected = departments.find(department => department.sector === selectedSector);
  const superAdmin = access.role === "platform_super_admin";
  const fullAccess = superAdmin && !access.deniedSectors?.length;

  if (!data && !error) return <PageLoading label="Carregando painel" />;

  return <section className="admin-dashboard-page" aria-labelledby="admin-dashboard-title">
    <header className="admin-dashboard-header">
      <div>
        <span className="admin-dashboard-eyebrow">Visão operacional</span>
        <h1 id="admin-dashboard-title"><AccountGreeting /></h1>
        <p>O que acontece agora nos departamentos sob sua responsabilidade.</p>
      </div>
      <button type="button" className="admin-dashboard-refresh" onClick={() => refresh.current()} disabled={refreshing} aria-label="Atualizar indicadores">
        <RefreshCw size={17} className={refreshing ? "hvm-sync-spinning" : undefined} />
        <span>{refreshing ? "Atualizando…" : "Atualizar"}</span>
      </button>
    </header>

    <div className="admin-dashboard-scope">
      <span><ShieldCheck size={15} /> {fullAccess ? "Visão global" : "Visão dos seus poderes"}</span>
      {data && <span>{departments.length} {departments.length === 1 ? "departamento disponível" : "departamentos disponíveis"}</span>}
      {data && <time dateTime={data.generatedAt}>Atualizado às {new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(data.generatedAt))}</time>}
    </div>

    {error && <div className="admin-dashboard-error" role="alert">
      <AlertTriangle size={18} />
      <div><strong>{error}</strong>{data && <p>Exibindo a última atualização recebida. Os dados serão consultados novamente automaticamente.</p>}</div>
      <button type="button" onClick={() => refresh.current()} disabled={refreshing}>Tentar novamente</button>
    </div>}

    {departments.length > 0 ? <>
      <div className="admin-dashboard-departments" role="group" aria-label="Departamentos disponíveis">
        {departments.map(department => {
          const presentation = DEPARTMENT_PRESENTATION[department.sector];
          const Icon = presentation?.icon ?? Settings2;
          const headline = department.metrics[0];
          return <button type="button" key={department.sector}
            className={"admin-dashboard-department" + (selected?.sector === department.sector ? " is-selected" : "")}
            aria-pressed={selected?.sector === department.sector}
            aria-controls="admin-dashboard-department-detail"
            onClick={() => setSelectedSector(department.sector)}>
            <span className="admin-dashboard-department-title"><Icon size={17} /><span>{presentation?.title ?? department.title}</span></span>
            {headline && <span className="admin-dashboard-headline"><strong>{metricValue(headline)}</strong><small>{headline.label}</small></span>}
            {department.metrics.some(metric => metric.attention) && <span className="admin-dashboard-attention" aria-label="Há itens que precisam de atenção" />}
          </button>;
        })}
      </div>

      {!selected && <p className="admin-dashboard-selection-hint">Selecione um departamento para consultar os indicadores, as pendências e os detalhes da operação.</p>}
      {selected && <section id="admin-dashboard-department-detail" className="admin-dashboard-detail" aria-labelledby="admin-dashboard-department-heading">
        <div className="admin-dashboard-detail-heading">
          <div><h2 id="admin-dashboard-department-heading">{selected.title}</h2><p>{selected.description}</p></div>
          {selected.actionPath !== "/admin/painel" && <button type="button" onClick={() => onNavigate(selected.actionPath)}><span>Abrir departamento</span><ArrowUpRight size={16} /></button>}
        </div>
        <dl className="admin-dashboard-metrics">
          {selected.metrics.map(metric => <div key={metric.key} className={metric.attention ? "needs-attention" : undefined}>
            <dt>{metric.label}</dt>
            <dd>{metricValue(metric)}{metric.unit === "revision" && <small> revisão atual</small>}</dd>
            {metric.note && <p>{metric.note}</p>}
            {metric.actionPath && <button type="button" onClick={() => onNavigate(metric.actionPath!)}>Ver detalhes <ArrowUpRight size={13} /></button>}
          </div>)}
        </dl>
      </section>}
    </> : data && <div className="admin-dashboard-empty" role="status"><ShieldCheck size={24} /><h2>Nenhum departamento disponível</h2><p>Consulte a governança para revisar os poderes atribuídos à sua conta.</p></div>}

    <footer className="admin-dashboard-footer">
      <span>Atualização automática a cada 30 segundos enquanto esta tela estiver aberta.</span>
      <button type="button" onClick={() => onNavigate("/admin/conta")}>Minha conta e privacidade <ArrowUpRight size={14} /></button>
    </footer>
  </section>;
}
