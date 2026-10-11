import { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  FileLock2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api } from "../../lib/api";
import { listPending } from "../../lib/offlineDb";
import { rememberConfirmedAccountErasure } from "../../lib/accountErasureCleanup";
import { announceBrowserSessionExit } from "../../lib/sessionExit";
import type { ShellSession } from "../../hooks/useSession";
import "./deleteOwnAccount.css";

export function DeleteOwnAccount({
  session,
  onNavigate,
}: {
  session: ShellSession;
  onNavigate: (path: string) => void;
}) {
  const formId = useId();
  const [online, setOnline] = useState(navigator.onLine);
  const [open, setOpen] = useState(false),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [loss, setLoss] = useState(false),
    [retention, setRetention] = useState(false),
    [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const command = useRef<string | null>(null),
    flight = useRef(false);
  const lifecycle = useRef<AbortController | null>(null);
  useEffect(() => {
    lifecycle.current = new AbortController();
    const updateConnection = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      lifecycle.current?.abort();
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);
  useEffect(() => {
    let active = true;
    void listPending(session.userId)
      .then((rows) => {
        if (active) setPending(rows.length);
      })
      .catch(() => {
        if (active) setPending(-1);
      });
    return () => {
      active = false;
    };
  }, [session.userId, open]);
  if (session.activeRole !== "consumer" && session.activeRole !== "producer")
    return null;
  async function erase(form: HTMLFormElement) {
    if (
      flight.current ||
      !lifecycle.current ||
      lifecycle.current.signal.aborted ||
      !loss ||
      !retention ||
      confirmation !== "EXCLUIR MINHA CONTA"
    )
      return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const restored = await api<ShellSession>("/v1/auth/login", {
        method: "POST",
        signal: lifecycle.current.signal,
        body: JSON.stringify({
          email: session.email,
          password,
          portalRole: session.activeRole,
        }),
      });
      setPassword("");
      if (
        restored.userId !== session.userId ||
        restored.activeRole !== session.activeRole
      )
        throw Error("IDENTITY_MISMATCH");
      command.current ??= crypto.randomUUID();
      await api("/v1/account", {
        method: "DELETE",
        signal: lifecycle.current.signal,
        body: JSON.stringify({
          commandId: command.current,
          expectedUserId: session.userId,
          expectedRole: session.activeRole,
          confirmation,
          acknowledgeLoss: loss,
          acknowledgeRetention: retention,
        }),
      });
      form.dispatchEvent(new Event("hvm:form-saved", { bubbles: true }));
      window.dispatchEvent(new Event("hvm:session-ending"));
      const cleared = await rememberConfirmedAccountErasure(session.userId);
      announceBrowserSessionExit();
      onNavigate(
        cleared ? "/?conta=excluida" : "/?conta=excluida&limpeza=pendente",
      );
    } catch (e) {
      if (lifecycle.current?.signal.aborted) return;
      const code = (e as Error).message;
      setError(
        code === "INVALID_CREDENTIALS"
          ? "Senha incorreta. Sua conta foi preservada."
          : code === "RECENT_AUTH_REQUIRED"
            ? "Confirme sua senha novamente para excluir."
            : "Não foi possível confirmar a exclusão agora. Confira sua sessão antes de tentar novamente; uma falha de conexão pode exigir entrar para consultar o resultado.",
      );
    } finally {
      flight.current = false;
      if (!lifecycle.current?.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="account-erasure" aria-labelledby={`${formId}-title`}>
      <header className="account-erasure-heading">
        <span className="account-erasure-icon">
          <Trash2 size={23} aria-hidden="true" />
        </span>
        <div>
          <span className="account-erasure-eyebrow">Controle da sua conta</span>
          <h2 id={`${formId}-title`}>Excluir minha conta</h2>
          <p>Revise o que acontece com seus dados antes de confirmar.</p>
        </div>
      </header>
      <button
        type="button"
        className="account-erasure-toggle"
        aria-expanded={open}
        aria-controls={`${formId}-form`}
        disabled={busy}
        onClick={() => {
          setOpen((v) => !v);
          setPassword("");
          setConfirmation("");
          setLoss(false);
          setRetention(false);
          setError("");
        }}
      >
        {open ? "Fechar confirmação" : "Solicitar exclusão da minha conta"}
        <ArrowRight size={17} aria-hidden="true" />
      </button>
      {open && (
        <form
          id={`${formId}-form`}
          className="account-erasure-form"
          data-hvm-update-busy="true"
          onSubmit={(e) => {
            e.preventDefault();
            void erase(e.currentTarget);
          }}
        >
          <div className="account-erasure-warning">
            <AlertTriangle size={20} aria-hidden="true" />
            <div>
              <strong>A exclusão é definitiva</strong>
              <p>
                {session.activeRole === "producer"
                  ? "Você perderá acesso à loja, produtos, imóveis, pedidos e demais áreas. Para voltar, terá de criar uma nova conta e validar novamente seus dados e documentos. Nenhuma aprovação antiga será reutilizada."
                  : "Você perderá acesso às compras, endereços, preferências e demais áreas. Para voltar, terá de criar uma nova conta."}
              </p>
            </div>
          </div>
          <details className="account-erasure-retention">
            <summary>
              <FileLock2 size={18} aria-hidden="true" /> Dados, retenção legal e
              reembolsos
            </summary>
            <p>
              Dados pessoais e operacionais são removidos conforme a LGPD.
              Registros mínimos de pagamentos, obrigações ou disputas e
              auditoria podem permanecer sob acesso restrito quando houver base
              legal para retenção. Arquivos de imóveis aprovados ficam
              identificados como conta excluída e não validam um novo cadastro.
              A exclusão da conta não confirma estorno nem elimina obrigação
              pendente.
            </p>
          </details>
          {pending !== 0 && (
            <p className="account-erasure-local" role="status">
              {pending > 0
                ? `${pending} ações estão salvas neste aparelho. A exclusão também apaga as ações locais desta conta.`
                : "A fila local não pôde ser consultada. A exclusão remove os dados locais desta conta quando o armazenamento estiver acessível."}
            </p>
          )}
          <fieldset className="account-erasure-consents" disabled={busy}>
            <legend>
              <ShieldCheck size={18} aria-hidden="true" /> Confirme que você
              está ciente
            </legend>
            <label className="account-erasure-check">
              <input
                type="checkbox"
                required
                checked={loss}
                onChange={(e) => setLoss(e.target.checked)}
              />
              <span>
                Entendi a perda de acesso e autorizo apagar os dados e as ações
                locais desta conta.
              </span>
            </label>
            <label className="account-erasure-check">
              <input
                type="checkbox"
                required
                checked={retention}
                onChange={(e) => setRetention(e.target.checked)}
              />
              <span>Li as condições de retenção legal e de reembolso.</span>
            </label>
          </fieldset>
          <div className="account-erasure-fields">
            <label className="account-erasure-field">
              Digite EXCLUIR MINHA CONTA
              <input
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
                disabled={busy}
                spellCheck={false}
              />
            </label>
            <label className="account-erasure-field">
              Senha atual
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
          {!online && (
            <p className="account-erasure-local" role="status">
              Conecte-se à internet para confirmar a exclusão.
            </p>
          )}
          {error && (
            <p className="account-erasure-error" role="alert">
              {error}
            </p>
          )}
          <footer className="account-erasure-actions">
            <p>Sua conta só será excluída depois desta confirmação.</p>
            <button
              type="submit"
              className="account-erasure-submit"
              disabled={
                busy ||
                !loss ||
                !retention ||
                confirmation !== "EXCLUIR MINHA CONTA" ||
                !password ||
                !online
              }
            >
              <Trash2 size={17} aria-hidden="true" />
              {busy
                ? "Confirmando exclusão…"
                : "Excluir definitivamente minha conta"}
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}
