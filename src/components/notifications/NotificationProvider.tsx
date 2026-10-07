import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Bell } from "lucide-react";
import type { ShellSession } from "../../hooks/useSession";
import { api, type ApiFailure } from "../../lib/api";
import {
  NotificationListSchema,
  type NotificationList,
} from "../../../shared/contracts/notification";
import "./notificationBell.css";
type Filters = { page: number; filter: "all" | "unread"; category: string };
type State = {
  session: ShellSession | null;
  data: NotificationList | null;
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
export function NotificationProvider({
  session,
  children,
}: {
  session: ShellSession | null;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<{
      actor: string;
      data: NotificationList;
    } | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [filters, setFilters] = useState<Filters>({
      page: 1,
      filter: "all",
      category: "",
    }),
    [revision, setRevision] = useState(0);
  const mutation = useRef(false);
  const role = session?.activeRole;
  const actor = `${session?.userId ?? ""}:${role ?? ""}`;
  const currentActor = useRef(actor);
  currentActor.current = actor;
  const previous = useRef<{ actor: string; signature: string } | null>(null);
  const data = snapshot?.actor === actor ? snapshot.data : null;
  const administrative =
    role === "platform_admin" || role === "platform_super_admin";
  const enabled =
    !!session &&
    ["consumer", "producer", "platform_admin", "platform_super_admin"].includes(
      role ?? "",
    );
  const base = administrative ? "/v1/admin/notifications" : "/v1/notifications";
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    setSnapshot(null);
    setError("");
    setFilters({ page: 1, filter: "all", category: "" });
    previous.current = null;
  }, [actor]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined,
      flight = false,
      stopped = false,
      failures = 0;
    const visible = () =>
      document.visibilityState !== "hidden" && navigator.onLine !== false;
    async function load() {
      if (flight || stopped || controller.signal.aborted || !visible()) return;
      clearTimeout(timer);
      flight = true;
      setLoading(true);
      try {
        const query = new URLSearchParams({
          page: String(filters.page),
          filter: filters.filter,
        });
        if (filters.category) query.set("category", filters.category);
        const result = NotificationListSchema.parse(
          await api(base + "?" + query, {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(20000),
            ]),
          }),
        );
        if (!controller.signal.aborted) {
          const signature = JSON.stringify([
            filters,
            result.unreadCount,
            result.notifications.map((n) => [n.id, n.readAt]),
          ]);
          const changed =
            previous.current?.actor === actor &&
            previous.current.signature !== signature;
          previous.current = { actor, signature };
          setSnapshot({ actor, data: result });
          setError("");
          failures = 0;
          if (changed)
            window.dispatchEvent(new Event("hvm:notifications-updated"));
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(
            "Não foi possível atualizar as notificações. Tente novamente.",
          );
          failures++;
          if ([401, 403].includes((e as ApiFailure).status ?? 0)) {
            setSnapshot(null);
            stopped = true;
          }
        }
      } finally {
        flight = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          if (!stopped && visible())
            timer = setTimeout(
              () => void load(),
              Math.min(120000, 30000 * 2 ** Math.min(failures, 2)),
            );
        }
      }
    }
    const sync = () => {
      clearTimeout(timer);
      void load();
    };
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
  }, [actor, enabled, base, filters, revision]);
  async function read(id: string) {
    if (mutation.current) return false;
    mutation.current = true;
    setBusy(true);
    try {
      await api(base + "/" + id + "/read", { method: "POST", body: "{}" });
      refresh();
      return true;
    } catch {
      if (currentActor.current === actor)
        setError("Não foi possível marcar a notificação como lida.");
      return false;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  async function readAll() {
    if (mutation.current || !data) return;
    mutation.current = true;
    setBusy(true);
    try {
      await api(base + "/read-all", {
        method: "POST",
        body: JSON.stringify({ through: data.asOf }),
      });
      refresh();
    } catch {
      if (currentActor.current === actor)
        setError("Não foi possível marcar as notificações como lidas.");
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  return (
    <SessionContext.Provider value={session}>
      <Context.Provider
        value={{
          session,
          data,
          error,
          loading,
          busy,
          filters,
          setFilters,
          refresh,
          read,
          readAll,
        }}
      >
        {children}
      </Context.Provider>
    </SessionContext.Provider>
  );
}
export function NotificationBell({ onClick }: { onClick: () => void }) {
  const state = useNotifications(),
    count = state?.data?.unreadCount ?? 0;
  return (
    <button
      className="icon hvm-notification-bell"
      aria-label={count ? `Notificações, ${count} não lidas` : "Notificações"}
      onClick={onClick}
    >
      <Bell aria-hidden="true" />
      {count > 0 && (
        <span className="hvm-cart-count" aria-hidden="true">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
