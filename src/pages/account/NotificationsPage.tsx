import { ArrowRight, Bell, Check, RefreshCw } from "lucide-react";
import {
  notificationBase,
  notificationRoleDescription,
  notificationRoleLabel,
  useNotifications,
} from "../../components/notifications/NotificationProvider";
import {
  NOTIFICATION_LABELS,
  NotificationCategorySchema,
} from "../../../shared/contracts/notification";
import { date } from "../../lib/commerce";
import { PageLoading } from "../../components/PageLoading";
import "./notifications.css";

export default function NotificationsPage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const state = useNotifications();
  if (!state?.session) return <section className="account-notice">
    <h1>Notificações</h1><p>Entre na sua conta para consultar suas notificações.</p>
    <button className="primary" onClick={() => onNavigate("/entrar")}>Entrar</button>
  </section>;
  const { data, preview, unreadCount, error, loading, busy, filters, setFilters, refresh, read, readAll } = state;
  const role = state.session.activeRole;
  const base = notificationBase(role);
  const administrative = base === "/admin/notificacoes";
  const availableCategories = preview?.availableCategories;
  const observed = new Set(preview?.notifications.map(n => n.category));
  const categories = NotificationCategorySchema.options.filter(category => availableCategories
    ? availableCategories.includes(category)
    : administrative ? category === "account" || observed.has(category)
      : role === "producer" ? category !== "administration"
        : ["purchases", "orders", "refunds", "complaints", "reviews", "subscriptions", "delivery", "account"].includes(category));
  return <section className="hvm-notifications" aria-labelledby="notifications-title">
    <header className="hvm-notification-page-heading">
      <div><span className="hvm-notification-eyebrow">{notificationRoleLabel(role)}</span>
        <h1 id="notifications-title"><Bell size={23} aria-hidden="true" /> Notificações</h1>
        <p>{notificationRoleDescription(role)}</p>
      </div>
      <button className="secondary hvm-notification-refresh" disabled={loading} onClick={refresh}><RefreshCw size={15} aria-hidden="true" /> Atualizar</button>
    </header>
    <div className="hvm-notification-overview"><span><strong>{unreadCount}</strong> {unreadCount === 1 ? "não lida" : "não lidas"}</span><p>Abra um aviso para entender a atualização e os próximos passos.</p></div>
    <div className="hvm-notification-toolbar">
      <div className="hvm-notification-tabs" aria-label="Filtrar leitura">
        <button aria-pressed={filters.filter === "all"} onClick={() => setFilters({ ...filters, page: 1, filter: "all" })}>Todas</button>
        <button aria-pressed={filters.filter === "unread"} onClick={() => setFilters({ ...filters, page: 1, filter: "unread" })}>Não lidas ({unreadCount})</button>
      </div>
      <label>Assunto<select value={filters.category} onChange={e => setFilters({ ...filters, page: 1, category: e.target.value })}>
        <option value="">Todos os assuntos</option>
        {categories.map(value => <option value={value} key={value}>{NOTIFICATION_LABELS[value]}</option>)}
      </select></label>
      <button className="text-button hvm-notification-read-all" disabled={busy || !unreadCount} onClick={() => void readAll()}><Check size={15} aria-hidden="true" /> Marcar todas como lidas</button>
    </div>
    {error && <p className="hvm-notification-error" role="alert">{error}</p>}
    {loading && !data && <PageLoading label="Carregando notificações…" compact />}
    {data && !data.notifications.length && <div className="hvm-notification-empty"><Bell size={28} aria-hidden="true" />
      <h2>{filters.filter === "unread" ? "Tudo em dia" : "Nenhuma notificação por aqui"}</h2>
      <p>{filters.filter === "unread" ? "Você já leu os avisos deste filtro." : "Os próximos avisos dos serviços aparecerão aqui."}</p>
      {filters.category && <button className="text-button" onClick={() => setFilters({ ...filters, page: 1, category: "" })}>Ver todos os assuntos</button>}
    </div>}
    <ol className="hvm-notification-list">
      {data?.notifications.map(n => <li key={n.id} className={n.readAt ? "" : "is-unread"}>
        <button type="button" className="hvm-notification-open" onClick={() => onNavigate(base + "/" + n.id)}>
          <span className="hvm-notification-item-meta"><span>{NOTIFICATION_LABELS[n.category]}</span><span className={n.readAt ? "is-read" : "is-new"}>{n.readAt ? "Lida" : "Não lida"}</span></span>
          <h2>{n.title}</h2><p>{n.message}</p>
          <span className="hvm-notification-item-footer"><time dateTime={n.createdAt}>{date(n.createdAt)}</time><span>Ver detalhes <ArrowRight size={14} aria-hidden="true" /></span></span>
        </button>
        {!n.readAt && <button className="text-button hvm-notification-mark-read" disabled={busy} onClick={() => void read(n.id)}><Check size={14} aria-hidden="true" /> Marcar como lida</button>}
      </li>)}
    </ol>
    {data && data.pages > 1 && <nav aria-label="Páginas de notificações" className="hvm-notification-pagination">
      <button className="secondary" disabled={data.page === 1 || loading} onClick={() => setFilters({ ...filters, page: data.page - 1 })}>Anterior</button>
      <span>{data.page} de {data.pages}</span>
      <button className="secondary" disabled={data.page === data.pages || loading} onClick={() => setFilters({ ...filters, page: data.page + 1 })}>Próxima</button>
    </nav>}
  </section>;
}
