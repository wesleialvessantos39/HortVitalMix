import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { listPending } from "../../lib/offlineDb";
import { rememberConfirmedAccountErasure } from "../../lib/accountErasureCleanup";
import { announceBrowserSessionExit } from "../../lib/sessionExit";
import type { ShellSession } from "../../hooks/useSession";
import "../commerce/departmentExtensions.css";

export function DeleteOwnAccount({
  session,
  onNavigate,
}: {
  session: ShellSession;
  onNavigate: (path: string) => void;
}) {
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
    return () => {
      lifecycle.current?.abort();
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
    <section className="department-extension">
      <h2>Excluir minha conta</h2>
      <p>Esta ação encerra o acesso desta identidade ao HortiVitalMix.</p>
      <button
        type="button"
        className="secondary"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Fechar confirmação" : "Solicitar exclusão da minha conta"}
      </button>
      {open && (
        <form
          data-hvm-update-busy="true"
          onSubmit={(e) => {
            e.preventDefault();
            void erase(e.currentTarget);
          }}
        >
          <p>
            {session.roles.includes("producer")
              ? "Você perderá acesso à loja, produtos, imóveis, pedidos e demais áreas. Para voltar, terá de criar uma nova conta e validar novamente seus dados e documentos. Nenhuma aprovação antiga será reutilizada."
              : "Você perderá acesso às compras, endereços, preferências e demais áreas. Para voltar, terá de criar uma nova conta."}
          </p>
          <p>
            Dados pessoais e operacionais são removidos conforme a LGPD.
            Registros mínimos de pagamentos, obrigações ou disputas e auditoria
            podem permanecer sob acesso restrito quando houver base legal para
            retenção. Arquivos de imóveis aprovados ficam identificados como
            conta excluída e não validam um novo cadastro. A exclusão da conta
            não confirma estorno nem elimina obrigação pendente.
          </p>
          {pending !== 0 && (
            <p role="status">
              {pending > 0
                ? `${pending} ações estão salvas neste aparelho. A exclusão também apaga as ações locais desta conta.`
                : "A fila local não pôde ser consultada. A exclusão remove os dados locais desta conta quando o armazenamento estiver acessível."}
            </p>
          )}
          <label className="department-extension-check">
            <input
              type="checkbox"
              required
              checked={loss}
              onChange={(e) => setLoss(e.target.checked)}
            />{" "}
            Entendi a perda de acesso e autorizo apagar os dados e as ações
            locais desta conta.
          </label>
          <label className="department-extension-check">
            <input
              type="checkbox"
              required
              checked={retention}
              onChange={(e) => setRetention(e.target.checked)}
            />{" "}
            Li as condições de retenção legal e de reembolso.
          </label>
          <label>
            Digite EXCLUIR MINHA CONTA
            <input
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Senha atual
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button
            className="primary"
            disabled={
              busy ||
              !loss ||
              !retention ||
              confirmation !== "EXCLUIR MINHA CONTA" ||
              !password ||
              !navigator.onLine
            }
          >
            {busy
              ? "Confirmando exclusão…"
              : "Excluir definitivamente minha conta"}
          </button>
        </form>
      )}
    </section>
  );
}
