import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type {
  AdminVerifySessionResponse,
  AdminSectorCode,
} from "../../../shared/contracts/adminGovernance";
import { hasAdminPermission } from "../../../shared/adminPermissions";
import { api, type ApiFailure } from "../../lib/api";
import { readAdminSessionIdentityVersion } from "../../lib/adminSessionStore";
import "./adminOperations.css";

export type AdminOperationsPageProps = {
  access: AdminVerifySessionResponse;
  onNavigate: (to: string) => void;
};
export const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
export const number = (value: number) =>
  new Intl.NumberFormat("pt-BR").format(value);
export const when = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Cuiaba",
  }).format(new Date(value));
export const localToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Cuiaba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export function useOperationsQuery<T>(
  access: AdminVerifySessionResponse,
  sector: AdminSectorCode,
  path: string,
  parse: (input: unknown) => T,
) {
  const [result, setResult] = useState<{ key: string; value: T } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
    private: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useRef<() => void>(() => undefined);
  const permitted = access.authorized && hasAdminPermission(access, sector);
  const identity = readAdminSessionIdentityVersion();
  const scope = JSON.stringify([
    identity,
    access.role,
    access.sectors,
    access.deniedSectors,
  ]);
  const key = scope + path;
  useEffect(() => {
    let active = true,
      pending = false;
    const controller = new AbortController();
    if (!permitted) {
      setResult(null);
      setLoading(false);
      return;
    }
    const load = async () => {
      if (!active || pending) return;
      pending = true;
      setLoading(true);
      try {
        const value = parse(
          await api<unknown>(path, { signal: controller.signal }),
        );
        if (!active || readAdminSessionIdentityVersion() !== identity) return;
        setResult({ key, value });
        setFailure(null);
      } catch (cause) {
        if (!active || readAdminSessionIdentityVersion() !== identity) return;
        const status = (cause as ApiFailure).status;
        const denied = status === 401 || status === 403;
        if (denied) setResult(null);
        setFailure({
          key,
          private: denied,
          message: denied
            ? "Seu acesso mudou. Confirme sua sessão e os poderes deste departamento."
            : "Não foi possível atualizar os dados. Tente novamente.",
        });
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    refresh.current = () => void load();
    const visible = () => {
      if (document.visibilityState !== "hidden") void load();
    };
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
  }, [key, permitted, identity, path, parse]);
  return {
    data: permitted && result?.key === key ? result.value : null,
    error: failure?.key === key ? failure.message : null,
    loading,
    permitted,
    refresh: () => refresh.current(),
  };
}

export function OperationsHeader({
  title,
  headingId,
  description,
  icon: Icon,
  loading,
  onRefresh,
}: {
  title: string;
  headingId: string;
  description: string;
  icon: LucideIcon;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="admin-page-header">
      <div>
        <span className="admin-kicker">
          <ShieldCheck size={14} /> Gestão administrativa
        </span>
        <h1 id={headingId}>
          <Icon size={24} />
          {title}
        </h1>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className="admin-secondary compact"
        disabled={loading}
        onClick={onRefresh}
        aria-label={"Atualizar " + title.toLowerCase()}
      >
        <RefreshCw
          size={16}
          className={loading ? "hvm-sync-spinning" : undefined}
        />
        {loading ? "Atualizando…" : "Atualizar"}
      </button>
    </header>
  );
}
export function OperationsMetrics({
  items,
}: {
  items: Array<{ label: string; value: string; note: string }>;
}) {
  return (
    <dl className="admin-ops-metrics">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          <p>{item.note}</p>
        </div>
      ))}
    </dl>
  );
}
export function OperationsError({
  message,
  stale,
  onRetry,
  loading,
}: {
  message: string;
  stale: boolean;
  onRetry: () => void;
  loading: boolean;
}) {
  return (
    <div
      className="admin-alert admin-alert--error admin-ops-error"
      role="alert"
    >
      <AlertTriangle size={18} />
      <div>
        <strong>{message}</strong>
        {stale && (
          <p>
            Exibindo a última consulta recebida. A atualização será tentada
            novamente automaticamente.
          </p>
        )}
      </div>
      <button
        type="button"
        className="admin-secondary"
        disabled={loading}
        onClick={onRetry}
      >
        Tentar novamente
      </button>
    </div>
  );
}
export function OperationsUnavailable({
  onNavigate,
}: Pick<AdminOperationsPageProps, "onNavigate">) {
  return (
    <div className="admin-empty" role="status">
      <h2>Departamento indisponível para esta conta</h2>
      <p>Consulte seus poderes de acesso com a administração.</p>
      <button
        type="button"
        className="admin-secondary"
        onClick={() => onNavigate("/admin/departamentos")}
      >
        Voltar aos departamentos
      </button>
    </div>
  );
}
export function OperationsPagination({
  pagination,
  loading,
  onPage,
}: {
  pagination: { page: number; pageSize: number; total: number };
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const pages = Math.min(
    2000,
    Math.max(1, Math.ceil(pagination.total / pagination.pageSize)),
  );
  const start = pagination.total
    ? Math.min(
        (pagination.page - 1) * pagination.pageSize + 1,
        pagination.total,
      )
    : 0;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
  return (
    <nav
      className="admin-ops-pagination"
      aria-label="Paginação do departamento"
    >
      <span>
        {number(start)}–{number(end)} de {number(pagination.total)} registros
      </span>
      <div>
        <button
          type="button"
          className="admin-secondary"
          disabled={loading || pagination.page <= 1}
          aria-label="Página anterior"
          onClick={() => onPage(pagination.page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <span>
          Página {number(pagination.page)} de {number(pages)}
        </span>
        <button
          type="button"
          className="admin-secondary"
          disabled={loading || pagination.page >= pages}
          aria-label="Próxima página"
          onClick={() => onPage(pagination.page + 1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </nav>
  );
}
export function OperationsTabs<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T;
  items: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="admin-ops-tabs" role="group" aria-label="Tipo de consulta">
      {items.map((item) => (
        <button
          type="button"
          key={item.value}
          className={value === item.value ? "is-selected" : undefined}
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
export function OperationsTable({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="admin-ops-table-wrap">
      <table className="admin-ops-table" aria-label={label}>
        {children}
      </table>
    </div>
  );
}
