import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Bell, CheckCheck, X } from "lucide-react";
import type { ShellSession } from "../../hooks/useSession";
import { api, type ApiFailure } from "../../lib/api";
import { date } from "../../lib/commerce";
import {
  NOTIFICATION_LABELS,
  NotificationListSchema,
  type NotificationList,
} from "../../../shared/contracts/notification";
import "./notificationBell.css";

type Filters = { page: number; filter: "all" | "unread"; category: string };
const initialFilters: Filters = { page: 1, filter: "all", category: "" };
type Snapshot = { actor: string; key: string; data: NotificationList };
type State = {
  session: ShellSession | null;
  data: NotificationList | null;
  preview: NotificationList | null;
  unreadCount: number;
  error: string;
  loading: boolean;
  busy: boolean;
  filters: Filters;
  setFilters: (value: Filters) => void;
  refresh: () => void;
  read: (id: string) => Promise<boolean>;
  readAll: () => Promise<void>;
};
const Context = createContext<State | null>(null);
const SessionContext = createContext<ShellSession | null>(null);
export const useNotifications = () => useContext(Context);
export const usePortalSession = () => useContext(SessionContext);
export function notificationBase(role: string | null | undefined) {
  return role === "platform_admin" || role === "platform_super_admin"
    ? "/admin/notificacoes"
    : "/notificacoes";
}
export function notificationRoleLabel(role: string | null | undefined) {
  return role === "producer"
    ? "Produtor"
    : role === "platform_super_admin"
      ? "Super administrador"
      : role === "platform_admin"
        ? "Administrador"
        : "Consumidor";
}
export function notificationRoleDescription(role: string | null | undefined) {
  return role === "producer"
    ? "Vendas, estoque, entregas e serviços da sua produção."
    : role === "platform_super_admin" || role === "platform_admin"
      ? "Atualizações dos departamentos que você pode administrar."
      : "Compras, entregas e serviços da sua conta.";
}

export function NotificationProvider({ session, children }: {
  session: ShellSession | null;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [revision, setRevision] = useState(0);
  const mutation = useRef<object | null>(null);
  const role = session?.activeRole;
  const actor = `${session?.userId ?? ""}:${role ?? ""}`;
  const currentActor = useRef(actor);
  currentActor.current = actor;
  const previous = useRef<{ actor: string; signature: string } | null>(null);
  const key = JSON.stringify(filters);
  const data = snapshot?.actor === actor && snapshot.key === key ? snapshot.data : null;
  const preview = previewSnapshot?.actor === actor ? previewSnapshot.data : null;
  const enabled = !!session && ["consumer", "producer", "platform_admin", "platform_super_admin"].includes(role ?? "");
  const base = notificationBase(role) === "/admin/notificacoes" ? "/v1/admin/notifications" : "/v1/notifications";
  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    setSnapshot(null);
    setPreviewSnapshot(null);
    setError("");
    setBusy(false);
    mutation.current = null;
    setFilters(initialFilters);
    previous.current = null;
  }, [actor]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flight = false;
    let stopped = false;
    let failures = 0;
    const visible = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
    async function load() {
      if (flight || stopped || controller.signal.aborted || !visible()) return;
      clearTimeout(timer);
      flight = true;
      setLoading(true);
      try {
        const query = new URLSearchParams({ page: String(filters.page), filter: filters.filter });
        if (filters.category) query.set("category", filters.category);
        const request = (queryString: string) => api(base + "?" + queryString, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        }).then(value => NotificationListSchema.parse(value));
        const defaultPage = filters.page === 1 && filters.filter === "all" && !filters.category;
        // The bell always shows the newest notices and the global unread count,
        // including while the full list has a department or unread filter.
        const [result, newest] = await Promise.all([
          request(query.toString()),
          defaultPage ? Promise.resolve(null) : request("page=1&filter=all"),
        ]);
        if (!controller.signal.aborted && currentActor.current === actor) {
          const global = newest ?? result;
          const signature = JSON.stringify([global.unreadCount, global.notifications.map(n => [n.id, n.readAt])]);
          const changed = previous.current?.actor === actor && previous.current.signature !== signature;
          previous.current = { actor, signature };
          setSnapshot({ actor, key, data: result });
          setPreviewSnapshot({ actor, key: "preview", data: global });
          setError("");
          failures = 0;
          if (changed) window.dispatchEvent(new Event("hvm:notifications-updated"));
        }
      } catch (e) {
        if (!controller.signal.aborted && currentActor.current === actor) {
          setError("Não foi possível atualizar as notificações. Tente novamente.");
          failures++;
          if ([401, 403].includes((e as ApiFailure).status ?? 0)) {
            setSnapshot(null);
            setPreviewSnapshot(null);
            stopped = true;
          }
        }
      } finally {
        flight = false;
        if (!controller.signal.aborted && currentActor.current === actor) {
          setLoading(false);
          if (!stopped && visible()) timer = setTimeout(() => void load(), Math.min(120000, 30000 * 2 ** Math.min(failures, 2)));
        }
      }
    }
    const sync = () => { clearTimeout(timer); void load(); };
    void load();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("online", sync);
    window.addEventListener("hvm:notifications-changed", sync);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("online", sync);
      window.removeEventListener("hvm:notifications-changed", sync);
    };
  }, [actor, enabled, base, filters, key, revision]);

  const updateRead = (id: string | null, through?: string) => {
    const mark = (value: Snapshot | null) => {
      if (!value || value.actor !== actor) return value;
      const now = new Date().toISOString();
      const selected = (n: NotificationList["notifications"][number]) => !n.readAt && (id ? n.id === id : !!through && n.createdAt <= through);
      const notifications = value.data.notifications.map(n => selected(n) ? { ...n, readAt: now } : n);
      const affected = value.data.notifications.filter(selected).length;
      return { ...value, data: { ...value.data, notifications,
        unreadCount: id ? Math.max(0, value.data.unreadCount - affected) : value.data.asOf === through ? 0 : Math.max(0, value.data.unreadCount - affected),
      } };
    };
    setSnapshot(mark);
    setPreviewSnapshot(mark);
  };
  async function read(id: string) {
    if (mutation.current) return false;
    const token = {};
    mutation.current = token;
    setBusy(true);
    try {
      await api(base + "/" + encodeURIComponent(id) + "/read", { method: "POST", body: "{}" });
      if (currentActor.current !== actor) return false;
      updateRead(id);
      refresh();
      return true;
    } catch {
      if (currentActor.current === actor) setError("Não foi possível marcar a notificação como lida.");
      return false;
    } finally {
      if (mutation.current === token) { mutation.current = null; setBusy(false); }
    }
  }
  async function readAll() {
    if (mutation.current || !preview) return;
    const token = {};
    mutation.current = token;
    setBusy(true);
    try {
      await api(base + "/read-all", { method: "POST", body: JSON.stringify({ through: preview.asOf }) });
      if (currentActor.current === actor) { updateRead(null, preview.asOf); refresh(); }
    } catch {
      if (currentActor.current === actor) setError("Não foi possível marcar as notificações como lidas.");
    } finally {
      if (mutation.current === token) { mutation.current = null; setBusy(false); }
    }
  }
  return <SessionContext.Provider value={session}>
    <Context.Provider value={{ session, data, preview, unreadCount: preview?.unreadCount ?? 0, error, loading, busy, filters, setFilters, refresh, read, readAll }}>
      {children}
    </Context.Provider>
  </SessionContext.Provider>;
}

export function NotificationBell({ onNavigate, onClick }: {
  onNavigate?: (to: string) => void;
  onClick?: () => void;
}) {
  const state = useNotifications();
  const count = state?.unreadCount ?? 0;
  const role = state?.session?.activeRole;
  const actor = `${state?.session?.userId ?? ""}:${role ?? ""}`;
  const [openFor, setOpenFor] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const open = openFor === actor;
  const close = useCallback(() => setOpenFor(null), []);
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      if (element.open) element.close();
      document.body.style.overflow = previousOverflow;
      trigger.current?.focus();
    };
  }, [open]);
  const navigate = (path: string) => { close(); onNavigate?.(path); };
  return <>
    <button ref={trigger} type="button" className={`icon hvm-notification-bell${count ? " has-unread" : ""}`}
      aria-label={count ? `Notificações, ${count} não lidas` : "Notificações"}
      aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { if (onNavigate) { setOpenFor(actor); state?.refresh(); } else onClick?.(); }}>
      <Bell aria-hidden="true" />
      {count > 0 && <span className="hvm-notification-count" aria-hidden="true">{count > 99 ? "99+" : count}</span>}
    </button>
    {open && createPortal(<dialog ref={dialog} className="hvm-notification-preview" aria-label="Notificações"
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
      <header className="hvm-notification-preview-heading">
        <div><span className="hvm-notification-eyebrow">{notificationRoleLabel(role)}</span><h2 id={headingId}>Notificações</h2></div>
        <button type="button" className="icon" aria-label="Fechar notificações" onClick={close} autoFocus><X aria-hidden="true" /></button>
      </header>
      <p className="hvm-notification-preview-summary">{count ? `${count} ${count === 1 ? "atualização não lida" : "atualizações não lidas"}` : "Seus avisos em um só lugar"}</p>
      <div className="hvm-notification-preview-content">
        {state?.error && <p className="hvm-notification-error" role="alert">{state.error}<button type="button" onClick={state.refresh}>Tentar novamente</button></p>}
        {!state?.preview && state?.loading && <div className="hvm-notification-preview-skeleton" role="status" aria-label="Carregando notificações"><span /><span /><span /></div>}
        {state?.preview && !state.preview.notifications.length && <div className="hvm-notification-preview-empty"><CheckCheck aria-hidden="true" /><strong>Tudo em dia</strong><p>Os próximos avisos aparecerão aqui.</p></div>}
        {!!state?.preview?.notifications.length && <ol className="hvm-notification-preview-list">
          {state.preview.notifications.slice(0, 4).map(n => <li key={n.id}>
            <button type="button" className={!n.readAt ? "is-unread" : ""} onClick={() => navigate(notificationBase(role) + "/" + n.id)}>
              <span className="hvm-notification-preview-item-meta">{NOTIFICATION_LABELS[n.category]}{!n.readAt && <span>Não lida</span>}</span>
              <strong>{n.title}</strong><span className="hvm-notification-preview-message">{n.message}</span>
              <time dateTime={n.createdAt}>{date(n.createdAt)}</time>
            </button>
          </li>)}
        </ol>}
      </div>
      <footer className="hvm-notification-preview-footer"><button type="button" onClick={() => navigate(notificationBase(role))}>Mostrar mais <ArrowRight size={17} aria-hidden="true" /></button></footer>
    </dialog>, document.body)}
  </>;
}
