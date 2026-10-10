import {
  useEffect,
  useState,
  useRef,
  type FormEvent,
  type CSSProperties,
} from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import type { ShellSession } from "../../hooks/useSession";
import { api } from "../../lib/api";
import {
  dismissCommand,
  listPending,
  synchronize,
  type PendingCommand,
} from "../../lib/offlineDb";
import {
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from "../../../shared/contracts/order";
import "./offline.css";
import { usePwa } from "../../hooks/usePwa";
const actionName = (row: PendingCommand) =>
  row.command.commandType === "inventory.harvest"
    ? "Colheita"
    : row.command.commandType === "delivery.proof"
      ? "Confirmação de entrega"
      : "Atualização de pedido";
export function useOfflineCommands(userId: string) {
  const [entries, setEntries] = useState<PendingCommand[]>([]);
  useEffect(() => {
    let alive = true;
    const update = () =>
      void listPending(userId)
        .then((v) => {
          if (alive) setEntries(v);
        })
        .catch(() => {});
    update();
    window.addEventListener("hvm:offline-changed", update);
    return () => {
      alive = false;
      window.removeEventListener("hvm:offline-changed", update);
    };
  }, [userId]);
  return entries;
}
export function OfflineStatusBanner({
  session,
  onNavigate,
}: {
  session: ShellSession | null;
  onNavigate: (path: string) => void;
}) {
  return session?.activeRole === "producer" ? (
    <ProducerOfflineStatus
      key={session.userId}
      session={session}
      onNavigate={onNavigate}
    />
  ) : null;
}
function ProducerOfflineStatus({
  session,
  onNavigate,
}: {
  session: ShellSession;
  onNavigate: (path: string) => void;
}) {
  const { workerReady: ready } = usePwa();
  const lifecycle = useRef(new AbortController());
  const [headerHeight, setHeaderHeight] = useState(80);
  useEffect(() => {
    const headers = Array.from(
      document.querySelectorAll<HTMLElement>(".desktop-header,.mobile-header"),
    );
    const update = () =>
      setHeaderHeight(
        headers.find((h) => h.offsetHeight > 0)?.offsetHeight ?? 0,
      );
    const observer = new ResizeObserver(update);
    headers.forEach((h) => observer.observe(h));
    update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => controller.abort();
  }, []);
  const entries = useOfflineCommands(session.userId),
    count = entries.filter((v) => !v.result).length;
  const [online, setOnline] = useState(navigator.onLine),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [expanded, setExpanded] = useState(false),
    [reauth, setReauth] = useState(false),
    [password, setPassword] = useState("");
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const visible = () => {
      if (document.visibilityState !== "hidden") setAttempt((v) => v + 1);
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, []);
  useEffect(() => {
    if (!online || !count || reauth || document.visibilityState === "hidden")
      return;
    setBusy(true);
    setError("");
    void synchronize(session.userId, lifecycle.current.signal)
      .catch((e) => {
        if (lifecycle.current.signal.aborted) return;
        if (
          ["RECENT_AUTH_REQUIRED", "AUTH_REQUIRED", "SESSION_EXPIRED"].includes(
            (e as Error).message,
          )
        ) {
          setReauth(true);
          setError(
            "Confirme sua senha para sincronizar. As ações continuam salvas neste aparelho.",
          );
        } else
          setError(
            "A sincronização não terminou. As ações continuam salvas; tente novamente com conexão.",
          );
      })
      .finally(() => {
        if (!lifecycle.current.signal.aborted) setBusy(false);
      });
  }, [online, count, reauth, session.userId, attempt]);
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!online || busy) return;
    setBusy(true);
    setError("");
    try {
      const restored = await api<ShellSession>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: session.email,
          password,
          portalRole: "producer",
        }),
      });
      if (restored.userId !== session.userId)
        throw new Error("IDENTITY_MISMATCH");
      setPassword("");
      setReauth(false);
      window.dispatchEvent(new Event("hvm:session-changed"));
      await synchronize(session.userId);
    } catch {
      setPassword("");
      setError(
        "Não foi possível confirmar e sincronizar. Confira sua senha e a conexão.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (online && entries.length === 0 && !reauth && !error) return null;
  return (
    <aside
      className={"hvm-offline-banner " + (!online ? "is-offline" : "")}
      aria-label={
        online ? "Ações aguardando confirmação" : "Conexão e ações do produtor"
      }
      style={{ "--hvm-offline-top": headerHeight + "px" } as CSSProperties}
    >
      <div className="hvm-offline-summary">
        {!online && <WifiOff size={19} aria-hidden="true" />}
        <div>
          <strong aria-live="polite" aria-atomic="true">
            {!online
              ? "Modo offline"
              : busy
                ? "Sincronizando ações"
                : "Ações aguardando confirmação"}{" "}
            — {count} {count === 1 ? "ação pendente" : "ações pendentes"}
          </strong>
          <small>
            {!online
              ? ready
                ? "Você está sem conexão. As ações ficam salvas neste aparelho e serão enviadas ao reconectar."
                : "Você está sem conexão. Consulte as telas disponíveis e mantenha o aparelho aberto para preservar suas ações."
              : "Confira as ações salvas neste aparelho que ainda precisam de confirmação."}
          </small>
        </div>
        {count > 0 && (
          <button
            className="secondary"
            disabled={busy || reauth}
            onClick={() => onNavigate("/conta/atualizacoes")}
          >
            <RefreshCw size={16} /> Atualizações da conta
          </button>
        )}
        {entries.length > 0 && (
          <button
            className="text-button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {entries.some((v) => v.result) ? "Revisar ações" : "Ver ações"}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {reauth && (
        <form className="hvm-offline-reauth" onSubmit={confirm}>
          <label>
            Senha atual
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              disabled={!online || busy}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={!online || busy || !password}>
            Confirmar e sincronizar
          </button>
        </form>
      )}
      {expanded && (
        <ol className="hvm-offline-list">
          {entries.map((row) => {
            const details = row.result?.conflictDetails,
              orderId =
                typeof row.command.payload.orderId === "string"
                  ? row.command.payload.orderId
                  : null;
            const target =
              typeof row.command.payload.productId === "string"
                ? `/produtor/produtos/${row.command.payload.productId}/lotes`
                : orderId
                  ? `/produtor/pedidos?orderId=${orderId}`
                  : "/produtor/pedidos";
            return (
              <li key={row.commandId}>
                <div>
                  <strong>{actionName(row)}</strong>
                  <time dateTime={new Date(row.createdAt).toISOString()}>
                    {new Date(row.createdAt).toLocaleString("pt-BR")}
                  </time>
                  <p>
                    {row.result
                      ? row.result.status === "conflict"
                        ? "O servidor mudou. Esta ação não foi aplicada. Confira o estado atual antes de tentar novamente."
                        : "Esta ação foi recusada. Confira os dados e as permissões antes de tentar novamente."
                      : "Salva neste aparelho; aguardando confirmação do servidor."}
                  </p>
                  {details?.status && (
                    <p>
                      Estado do servidor:{" "}
                      {ORDER_STATUS_LABELS[details.status as OrderStatus] ??
                        details.status}{" "}
                      · revisão {details.revision}.
                    </p>
                  )}
                  {details?.title && (
                    <p>
                      Produto: {details.title} · revisão {details.revision}.
                    </p>
                  )}
                  {row.command.commandType === "inventory.harvest" && (
                    <p>
                      Lote:{" "}
                      {String(
                        (row.command.payload.harvest as { lotCode?: string })
                          ?.lotCode ?? "",
                      )}
                    </p>
                  )}
                </div>
                <div className="hvm-offline-actions">
                  <button
                    className="secondary"
                    onClick={() => onNavigate(target)}
                  >
                    Ver {orderId ? "pedido" : "colheitas"}
                  </button>
                  {row.result && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void dismissCommand(
                          session.userId,
                          row.commandId,
                        ).catch(() =>
                          setError(
                            "Não foi possível dispensar o aviso. Tente novamente.",
                          ),
                        )
                      }
                    >
                      Dispensar ação não aplicada
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
