import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, Ban, CreditCard, FileCheck2, Landmark,
  LayoutGrid, ListTree, MapPin, RefreshCw, Settings2, ShieldCheck,
  Smartphone, UsersRound, type LucideIcon,
} from "lucide-react";
import { hasAdminPermission } from "../../../shared/adminPermissions";
import type { AdminSectorCode, AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import { AdminDashboardResponseSchema, type AdminDashboardResponse, type AdminDashboardMetric } from "../../../shared/contracts/adminDashboard";
import { PageLoading } from "../../components/PageLoading";
import { api, type ApiFailure } from "../../lib/api";
import { readAdminSessionIdentityVersion } from "../../lib/adminSessionStore";
import "./adminDepartmentHub.css";

type Destination = { label: string; path: string; superOnly?: boolean };
const presentation: Record<AdminSectorCode, { icon: LucideIcon; destinations: Destination[] }> = {
  account_governance: { icon: UsersRound, destinations: [{ label: "Usuários", path: "/admin/usuarios" }, { label: "Convites e poderes", path: "/admin/governanca" }] },
  document_verification: { icon: FileCheck2, destinations: [{ label: "Análise de documentos", path: "/admin/documentos/fila" }] },
  catalog_moderation: { icon: ListTree, destinations: [{ label: "Catálogo", path: "/admin/catalogo" }, { label: "Categorias", path: "/admin/categorias", superOnly: true }] },
  finance_ops: { icon: Landmark, destinations: [{ label: "Financeiro", path: "/admin/financeiro" }] },
  location_management: { icon: MapPin, destinations: [{ label: "Localidades", path: "/admin/localidades" }, { label: "Bloqueios", path: "/admin/bloqueios" }] },
  platform_configuration: { icon: Settings2, destinations: [{ label: "Identidade e operação", path: "/admin/configuracao" }, { label: "Aplicativos", path: "/admin/aplicativos" }, { label: "BI executivo", path: "/admin/bi", superOnly: true }] },
  refund_management: { icon: Ban, destinations: [{ label: "Reembolsos", path: "/admin/reembolsos" }, { label: "Política de reembolso", path: "/admin/politica-reembolso" }] },
  complaint_management: { icon: ShieldCheck, destinations: [{ label: "Denúncias", path: "/admin/denuncias" }, { label: "Avaliações", path: "/admin/avaliacoes" }] },
  payment_configuration: { icon: CreditCard, destinations: [{ label: "Pagamentos", path: "/admin/pagamentos" }, { label: "Assinaturas", path: "/admin/assinaturas" }] },
};

function metricValue(metric: AdminDashboardMetric) {
  return metric.unit === "currency_cents"
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(metric.value / 100)
    : new Intl.NumberFormat("pt-BR").format(metric.value);
}

export default function AdminDepartmentsPage({ access, onNavigate }: {
  access: AdminVerifySessionResponse;
  onNavigate: (path: string) => void;
}) {
  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useRef<() => void>(() => undefined);
  const scopeKey = JSON.stringify([access.role, [...access.sectors].sort(), [...(access.deniedSectors ?? [])].sort()]);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    setData(null);
    setError("");
    async function load() {
      if (!active || inFlight) return;
      inFlight = true;
      setRefreshing(true);
      const identity = readAdminSessionIdentityVersion();
      try {
        const result = AdminDashboardResponseSchema.parse(await api("/v1/admin/dashboard", { signal: controller.signal }));
        if (!active || identity !== readAdminSessionIdentityVersion()) return;
        setData(result);
        setError("");
      } catch (cause) {
        if (!active || identity !== readAdminSessionIdentityVersion()) return;
        const status = (cause as ApiFailure).status;
        if (status === 401 || status === 403) {
          setData(null);
          setError("Sua sessão ou seus poderes mudaram. Confirme o acesso para consultar os departamentos.");
        } else setError("Não foi possível atualizar os departamentos. Tente novamente.");
      } finally {
        inFlight = false;
        if (active) setRefreshing(false);
      }
    }
    const visible = () => { if (document.visibilityState !== "hidden") void load(); };
    refresh.current = () => void load();
    void load();
    const timer = window.setInterval(visible, 30_000);
    window.addEventListener("focus", visible);
    window.addEventListener("hvm:departments-changed", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", visible);
      window.removeEventListener("hvm:departments-changed", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [scopeKey]);

  const departments = data?.departments.filter((department) => hasAdminPermission(access, department.sector)) ?? [];
  if (!data && !error) return <PageLoading label="Carregando departamentos" />;
  return <section className="admin-department-hub" aria-labelledby="admin-department-hub-title">
    <header className="admin-department-hub-header"><div><span className="admin-department-hub-eyebrow"><LayoutGrid size={14} aria-hidden="true" /> Central de gestão</span><h1 id="admin-department-hub-title">Departamentos</h1><p>Acesse cada área e acompanhe os indicadores dos seus poderes administrativos.</p></div><button type="button" onClick={() => refresh.current()} disabled={refreshing} aria-label="Atualizar departamentos"><RefreshCw size={16} aria-hidden="true" className={refreshing ? "hvm-sync-spinning" : undefined} /> Atualizar</button></header>
    <div className="admin-department-hub-scope"><span><ShieldCheck size={15} aria-hidden="true" /> {access.role === "platform_super_admin" && !access.deniedSectors?.length ? "Visão global da plataforma" : "Áreas autorizadas para sua conta"}</span>{data && <span>{departments.length} {departments.length === 1 ? "departamento" : "departamentos"}</span>}{data && <time dateTime={data.generatedAt}>Atualizado às {new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Cuiaba" }).format(new Date(data.generatedAt))}</time>}</div>
    {error && <div className="admin-department-hub-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><div><p>{error}</p>{data && <small>Exibindo a última consulta recebida.</small>}</div><button type="button" onClick={() => refresh.current()} disabled={refreshing}>Tentar novamente</button></div>}
    {departments.length ? <div className="admin-department-hub-grid">{departments.map((department) => {
      const section = presentation[department.sector];
      const Icon = section.icon;
      const pending = department.metrics.filter((metric) => metric.attention && metric.value > 0);
      return <article className="admin-department-hub-card" key={department.sector} aria-labelledby={`department-${department.sector}`}>
        <div className="admin-department-hub-card-title"><span><Icon size={21} aria-hidden="true" /></span><h2 id={`department-${department.sector}`}>{department.title}</h2>{pending.length > 0 && <span className="admin-department-hub-attention" aria-label="Há pendências neste departamento" title="Há pendências neste departamento" />}</div>
        <p>{department.description}</p>
        <dl>{department.metrics.slice(0, 2).map((metric) => <div key={metric.key}><dt>{metric.label}</dt><dd>{metricValue(metric)}</dd></div>)}</dl>
        <nav aria-label={`Acessos de ${department.title}`}>{section.destinations.filter((destination) => !destination.superOnly || access.role === "platform_super_admin").map((destination) => <a href={destination.path} key={destination.path} onClick={(event) => { event.preventDefault(); onNavigate(destination.path); }}>{destination.label}{destination.path === "/admin/aplicativos" ? <Smartphone size={14} aria-hidden="true" /> : <ArrowUpRight size={14} aria-hidden="true" />}</a>)}</nav>
      </article>;
    })}</div> : data && <div className="admin-department-hub-empty" role="status"><ShieldCheck size={27} aria-hidden="true" /><h2>Nenhum departamento disponível</h2><p>Os acessos aparecem conforme os poderes atribuídos à sua conta.</p></div>}
    <footer>Indicadores atualizados automaticamente a cada 30 segundos enquanto esta tela estiver aberta.<a href="/admin/painel" onClick={(event) => { event.preventDefault(); onNavigate("/admin/painel"); }}>Ver painel global <ArrowUpRight size={14} aria-hidden="true" /></a></footer>
  </section>;
}
