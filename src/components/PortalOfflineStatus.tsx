import { useEffect, useState, type FormEvent } from "react";
import { WifiOff, CloudUpload, ChevronDown, ShieldCheck } from "lucide-react";
import type { ShellSession } from "../hooks/useSession";
import { api } from "../lib/api";
import {
  dismissCommand,
  listPending,
  type PendingCommand,
} from "../lib/offlineDb";
import { documentUploads, type OfflineDocument } from "../lib/offlineDocuments";
import {
  dismissPortalRequest,
  portalRequests,
  setOfflineIdentity,
  type PortalRequest,
} from "../lib/portalOffline";
import { offlineScope } from "../../shared/offlinePolicy";
import { synchronizeOwnAccount } from "../lib/accountSync";
import { AdminReauthentication } from "./commerce/AdminReauthentication";
import "./producer/offline.css";

export function PortalOfflineStatus({
  session,
  onNavigate,
}: {
  session: ShellSession | null;
  onNavigate: (path: string) => void;
}) {
  const [online, setOnline] = useState(navigator.onLine),
    [expanded, setExpanded] = useState(false),
    [storageError, setStorageError] = useState(false);
  const [requests, setRequests] = useState<PortalRequest[]>([]),
    [commands, setCommands] = useState<PendingCommand[]>([]),
    [uploads, setUploads] = useState<OfflineDocument[]>([]);
  const [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [legacyAuth, setLegacyAuth] = useState(false);
  const scope = session?.activeRole
    ? offlineScope(session.userId, session.activeRole)
    : "";
  useEffect(() => {
    let alive = true;
    setRequests([]);
    setCommands([]);
    setUploads([]);
    setPassword("");
    setError("");
    setLegacyAuth(false);
    const update = async () => {
      if (!scope || !session) return;
      try {
        const [r, c, u] = await Promise.all([
          portalRequests(scope),
          session.activeRole === "producer"
            ? listPending(session.userId)
            : Promise.resolve([]),
          documentUploads(scope),
        ]);
        if (alive) {
          setRequests(r);
          setCommands(c);
          setUploads(u);
        }
      } catch {
        if (alive) setStorageError(true);
      }
    };
    const connection = () => setOnline(navigator.onLine);
    const storage = () => setStorageError(true);
    const auth = (event: Event) => {
      if ((event as CustomEvent).detail?.scope === scope) setLegacyAuth(true);
    };
    void update();
    window.addEventListener("hvm:offline-changed", update);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    window.addEventListener("hvm:offline-storage-error", storage);
    window.addEventListener("hvm:offline-auth-required", auth);
    return () => {
      alive = false;
      window.removeEventListener("hvm:offline-auth-required", auth);
      window.removeEventListener("hvm:offline-changed", update);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      window.removeEventListener("hvm:offline-storage-error", storage);
    };
  }, [scope]);
  if (
    !session ||
    !scope ||
    (online &&
      !requests.length &&
      !commands.length &&
      !uploads.length &&
      !storageError)
  )
    return null;
  const pending =
    requests.filter((v) => v.state === "pending").length +
    commands.filter((v) => !v.result).length +
    uploads.filter((v) => v.state === "pending").length;
  const authentication =
    legacyAuth ||
    requests.some((v) => v.state === "authentication") ||
    uploads.some((v) => v.state === "authentication");
  const administrative =
    session.activeRole === "platform_admin" ||
    session.activeRole === "platform_super_admin";
  async function confirmed() {
    if (session) {
      setError("");
      await synchronizeOwnAccount(session).catch(() =>
        setError("As ações continuam salvas. Verifique a conexão e a sessão."),
      );
    }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!online || busy || !session) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<ShellSession>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: session.email,
          password,
          portalRole: session.activeRole,
        }),
      });
      if (
        next.userId !== session.userId ||
        next.activeRole !== session.activeRole
      )
        throw Error("SESSION_CHANGED");
      setOfflineIdentity(next);
      window.dispatchEvent(new Event("hvm:session-changed"));
      await confirmed();
    } catch {
      setError(
        "Não foi possível confirmar. Confira a senha e a conexão; suas ações continuam salvas.",
      );
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  return (
    <aside
      className={`hvm-offline-banner ${!online ? "is-offline" : ""}`}
      aria-label="Conexão e sincronização"
      data-hvm-pwa-ui
    >
      <div className="hvm-offline-summary">
        {!online ? (
          <WifiOff size={20} aria-hidden="true" />
        ) : (
          <CloudUpload size={20} aria-hidden="true" />
        )}
        <div>
          <strong role="status">
            {!online ? "Modo offline" : "Sincronização da conta"}
            {pending > 0
              ? ` · ${pending} ${pending === 1 ? "ação salva" : "ações salvas"}`
              : ""}
          </strong>
          <small>
            {storageError
              ? "Não foi possível acessar o armazenamento. Mantenha os dados na tela e verifique o espaço disponível."
              : !online
                ? "Consulte os dados disponíveis. As ações salvas serão enviadas automaticamente quando a conexão voltar."
                : authentication
                  ? "Confirme sua identidade para concluir as ações protegidas."
                  : "O envio é automático. Ações com conflito ou que exigem confirmação permanecem disponíveis para revisão."}
          </small>
        </div>
        {(requests.length > 0 || commands.length > 0 || uploads.length > 0) && (
          <button
            type="button"
            className="secondary"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronDown size={16} />
            {expanded ? "Fechar ações" : "Ver ações salvas"}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {authentication && online && (
        <div className="hvm-offline-auth">
          <ShieldCheck aria-hidden="true" />
          {administrative ? (
            <AdminReauthentication
              expectedUserId={session.userId}
              expectedRole={session.activeRole!}
              onConfirmed={confirmed}
              onCancel={() => setExpanded(false)}
            />
          ) : (
            <form className="hvm-offline-reauth" onSubmit={confirm}>
              <label>
                Senha atual
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              <button className="primary" disabled={busy || !password}>
                {busy ? "Confirmando…" : "Confirmar e sincronizar"}
              </button>
            </form>
          )}
        </div>
      )}
      {expanded && (
        <ol className="hvm-offline-list">
          {requests.map((row) => (
            <li key={row.key}>
              <div>
                <strong>
                  {row.sourcePath.startsWith("/admin")
                    ? "Ação administrativa"
                    : "Alteração da conta"}
                </strong>
                <time dateTime={new Date(row.createdAt).toISOString()}>
                  {new Date(row.createdAt).toLocaleString("pt-BR")}
                </time>
                <p>
                  {row.state === "conflict"
                    ? "O registro mudou no servidor. A alteração local foi preservada e não foi aplicada. Revise os dados atuais."
                    : row.state === "rejected"
                      ? "Esta ação não foi aceita. Revise os dados e as permissões."
                      : row.state === "review"
                        ? "Esta operação depende de conexão. Abra a tela para revisar e confirmar."
                        : row.state === "authentication"
                          ? "Aguardando confirmação de identidade; dados salvos neste aparelho."
                          : "Salva neste aparelho; aguardando confirmação do servidor."}
                </p>
                {row.currentRevision !== undefined && (
                  <small>Revisão atual: {row.currentRevision}</small>
                )}
              </div>
              <div className="hvm-offline-actions">
                <button
                  className="secondary"
                  onClick={() => onNavigate(row.sourcePath)}
                >
                  Abrir tela
                </button>
                {["conflict", "rejected"].includes(row.state) && (
                  <button
                    className="text-button"
                    onClick={() =>
                      void dismissPortalRequest(row).catch(() =>
                        setError(
                          "Não foi possível dispensar. Os dados foram preservados.",
                        ),
                      )
                    }
                  >
                    Dispensar ação não aplicada
                  </button>
                )}
              </div>
            </li>
          ))}
          {uploads.map((row) => (
            <li key={row.key}>
              <div>
                <strong>Documento: {row.fileName}</strong>
                <p>
                  {row.state === "rejected"
                    ? "Confira o arquivo e as permissões; ele continua salvo neste aparelho."
                    : "Arquivo salvo neste aparelho; envio e conferência retomam ao conectar."}
                </p>
              </div>
              <button
                className="secondary"
                onClick={() => onNavigate(row.sourcePath)}
              >
                Ver documentos
              </button>
            </li>
          ))}
          {commands.map((row) => (
            <li key={row.commandId}>
              <div>
                <strong>
                  {row.command.commandType === "inventory.harvest"
                    ? "Colheita"
                    : row.command.commandType === "delivery.proof"
                      ? "Confirmação de entrega"
                      : "Atualização de pedido"}
                </strong>
                <p>
                  {row.result
                    ? "Ação não aplicada. Revise o estado atual do servidor."
                    : "Salva neste aparelho; aguardando confirmação do servidor."}
                </p>
              </div>
              <button
                className="secondary"
                onClick={() =>
                  onNavigate(
                    row.command.commandType === "inventory.harvest"
                      ? `/produtor/produtos/${row.command.payload.productId}/lotes`
                      : "/produtor/pedidos",
                  )
                }
              >
                Ver registro
              </button>
              {row.result && (
                <button
                  className="text-button"
                  onClick={() =>
                    void dismissCommand(session.userId, row.commandId)
                  }
                >
                  Dispensar ação não aplicada
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
