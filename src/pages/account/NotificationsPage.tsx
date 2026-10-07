import { Bell, Check, RefreshCw } from "lucide-react";
import { useNotifications } from "../../components/notifications/NotificationProvider";
import {
  NOTIFICATION_LABELS,
  NotificationCategorySchema,
} from "../../../shared/contracts/notification";
import { date } from "../../lib/commerce";
import "./notifications.css";
export default function NotificationsPage({
  onNavigate,
}: {
  onNavigate: (to: string) => void;
}) {
  const state = useNotifications();
  if (!state?.session)
    return (
      <section className="account-notice">
        <h1>Notificações</h1>
        <p>Entre na sua conta para consultar suas notificações.</p>
        <button className="primary" onClick={() => onNavigate("/entrar")}>
          Entrar
        </button>
      </section>
    );
  const {
    data,
    error,
    loading,
    busy,
    filters,
    setFilters,
    refresh,
    read,
    readAll,
  } = state;
  const role = state.session.activeRole,
    roleLabel =
      role === "producer"
        ? "Produtor"
        : role === "platform_super_admin"
          ? "Super administrador"
          : role === "platform_admin"
            ? "Administrador"
            : "Consumidor";
  return (
    <section
      className="hvm-notifications"
      aria-labelledby="notifications-title"
    >
      <header>
        <div>
          <span className="eyebrow">{roleLabel}</span>
          <h1 id="notifications-title">
            <Bell aria-hidden="true" /> Notificações
          </h1>
          <p>Avisos e atualizações dos serviços da sua conta.</p>
        </div>
        <button className="secondary" disabled={loading} onClick={refresh}>
          <RefreshCw size={16} />
          Atualizar
        </button>
      </header>
      <div className="hvm-notification-toolbar">
        <div className="hvm-notification-tabs">
          <button
            aria-pressed={filters.filter === "all"}
            onClick={() => setFilters({ ...filters, page: 1, filter: "all" })}
          >
            Todas
          </button>
          <button
            aria-pressed={filters.filter === "unread"}
            onClick={() =>
              setFilters({ ...filters, page: 1, filter: "unread" })
            }
          >
            Não lidas ({data?.unreadCount ?? 0})
          </button>
        </div>
        <label>
          Assunto
          <select
            value={filters.category}
            onChange={(e) =>
              setFilters({ ...filters, page: 1, category: e.target.value })
            }
          >
            <option value="">Todos os assuntos</option>
            {NotificationCategorySchema.options.map((v) => (
              <option value={v} key={v}>
                {NOTIFICATION_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="text-button"
          disabled={busy || !data?.unreadCount}
          onClick={() => void readAll()}
        >
          <Check size={16} />
          Marcar todas como lidas
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && !data && <p role="status">Carregando notificações…</p>}
      {data && !data.notifications.length && (
        <div className="hvm-notification-empty">
          <Bell size={32} />
          <h2>
            {filters.filter === "unread"
              ? "Tudo em dia"
              : "Nenhuma notificação por aqui"}
          </h2>
          <p>
            {filters.filter === "unread"
              ? "Você já leu os avisos deste filtro."
              : "Os próximos avisos dos serviços aparecerão aqui."}
          </p>
        </div>
      )}
      <ol className="hvm-notification-list">
        {data?.notifications.map((n) => (
          <li key={n.id} className={n.readAt ? "" : "is-unread"}>
            <div>
              <span className="eyebrow">
                {NOTIFICATION_LABELS[n.category]}
                {!n.readAt && " · Não lida"}
              </span>
              <h2>{n.title}</h2>
              <p>{n.message}</p>
              <time dateTime={n.createdAt}>{date(n.createdAt)}</time>
            </div>
            <div className="hvm-notification-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  if (n.readAt || (await read(n.id))) onNavigate(n.actionPath);
                }}
              >
                Ver atualização
              </button>
              {!n.readAt && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void read(n.id)}
                >
                  Marcar como lida
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {data && data.pages > 1 && (
        <nav
          aria-label="Páginas de notificações"
          className="hvm-notification-pagination"
        >
          <button
            className="secondary"
            disabled={data.page === 1 || loading}
            onClick={() => setFilters({ ...filters, page: data.page - 1 })}
          >
            Anterior
          </button>
          <span>
            {data.page} de {data.pages}
          </span>
          <button
            className="secondary"
            disabled={data.page === data.pages || loading}
            onClick={() => setFilters({ ...filters, page: data.page + 1 })}
          >
            Próxima
          </button>
        </nav>
      )}
    </section>
  );
}
