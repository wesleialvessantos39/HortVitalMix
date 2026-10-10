import { useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldCheck, WifiOff } from "lucide-react";
import type { ShellSession } from "../../hooks/useSession";
import { usePwa } from "../../hooks/usePwa";
import { synchronizeOwnAccount } from "../../lib/accountSync";
import { listPending } from "../../lib/offlineDb";
import "./accountUpdates.css";

const labels = {
  checking: "Verificando atualização",
  current: "Aplicativo atualizado",
  preparing: "Preparando nova versão",
  waiting: "Atualização aguardando operação",
  applying: "Aplicando atualização",
  offline: "Sem conexão",
  error: "Não foi possível verificar agora",
  unsupported: "Atualizações pelo navegador",
};
export function AccountUpdatesPage({ session }: { session: ShellSession }) {
  const pwa = usePwa();
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState(0),
    [conflicts, setConflicts] = useState(0);
  const lifecycle = useRef<AbortController | null>(null),
    flight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    const read = async () => {
      const rows =
        session.activeRole === "producer"
          ? await listPending(session.userId)
          : [];
      if (!controller.signal.aborted) {
        setPending(rows.filter((row) => !row.result).length);
        setConflicts(rows.filter((row) => row.result).length);
      }
    };
    const refresh = () =>
      void read().catch(() => {
        if (!controller.signal.aborted)
          setNotice(
            "Não foi possível consultar a fila local. Os dados foram preservados.",
          );
      });
    refresh();
    window.addEventListener("hvm:offline-changed", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("hvm:offline-changed", refresh);
    };
  }, [session.userId, session.activeRole]);
  async function sync() {
    if (
      flight.current ||
      !lifecycle.current ||
      lifecycle.current.signal.aborted
    )
      return;
    const controller = lifecycle.current;
    flight.current = true;
    setBusy(true);
    setNotice("");
    try {
      await synchronizeOwnAccount(session, controller.signal);
      if (controller.signal.aborted) return;
      setNotice(
        "Seus dados foram consultados e as ações pendentes foram verificadas. Conflitos precisam ser revisados.",
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setNotice(
        (error as Error).message === "OFFLINE"
          ? "Conecte-se à internet. As ações locais continuam salvas."
          : "Não foi possível concluir agora. Sua fila foi preservada; confirme sua sessão e tente novamente.",
      );
    } finally {
      flight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      className="account-updates"
      data-hvm-pwa-ui
      aria-labelledby="account-updates-title"
    >
      <header>
        <RefreshCw aria-hidden="true" />
        <div>
          <h1 id="account-updates-title">Atualizações e sincronização</h1>
          <p>
            Atualizações e sincronização acontecem automaticamente quando há
            conexão e é seguro.
          </p>
        </div>
      </header>
      <article>
        <h2>{labels[pwa.updateState]}</h2>
        <p role="status">
          {pwa.reason ??
            "Você recebe as melhorias sem reinstalar o HortiVitalMix."}
        </p>
        <dl>
          <div>
            <dt>Ambiente</dt>
            <dd>
              {pwa.device.standalone ? "Aplicativo instalado" : "Navegador"}
            </dd>
          </div>
          <div>
            <dt>Versão web</dt>
            <dd>{pwa.version?.frontendVersion ?? "Consultando"}</dd>
          </div>
          <div>
            <dt>Build aberto</dt>
            <dd>{pwa.loadedBuildId.slice(0, 12) || "Em desenvolvimento"}</dd>
          </div>
          <div>
            <dt>Última verificação</dt>
            <dd>
              {pwa.lastCheckedAt
                ? new Date(pwa.lastCheckedAt).toLocaleString("pt-BR")
                : "Aguardando conexão"}
            </dd>
          </div>
        </dl>
        <button
          className="secondary"
          type="button"
          disabled={
            pwa.updateState === "checking" || pwa.updateState === "applying"
          }
          onClick={() => void pwa.checkUpdates()}
        >
          Verificar atualização
        </button>
      </article>
      <article>
        <h2>
          <ShieldCheck size={20} aria-hidden="true" /> Meus dados
        </h2>
        <p>
          A sincronização automática usa apenas sua conta. A verificação manual
          não repete pagamentos nem altera dados de outra pessoa.
        </p>
        {session.activeRole === "producer" && (
          <p>
            {pending} ações aguardando envio · {conflicts} ações precisam de
            revisão.
          </p>
        )}
        <button
          className="secondary"
          type="button"
          disabled={busy || !navigator.onLine}
          onClick={() => void sync()}
        >
          {busy ? "Sincronizando meus dados…" : "Sincronizar meus dados"}
        </button>
        {!navigator.onLine && (
          <p>
            <WifiOff size={16} aria-hidden="true" /> A sincronização retomará
            quando houver conexão.
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </article>
      <p>
        Formulários, pedidos, uploads e ações offline adiam a troca de versão.
        Android e iOS podem suspender o aplicativo em segundo plano; as
        verificações retomam ao abri-lo.
      </p>
    </section>
  );
}
