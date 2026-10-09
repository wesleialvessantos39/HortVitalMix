import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ShellSession } from "../hooks/useSession";
import { useAppDistribution } from "../hooks/useAppDistribution";
import { hasPendingApiMutations, hasPendingSessionChanges } from "../lib/api";
import { listPending } from "../lib/offlineDb";
import { isNativeApp } from "../lib/nativeTransport";
import "./appUpdateNotice.css";

const safeRoutes = new Set(["/", "/aplicativos", "/admin/painel", "/admin/departamentos", "/admin/catalogo", "/admin/financeiro"]);
const dirtyForms = new WeakSet<HTMLFormElement>();

function visible(element: Element) {
  return element.getClientRects().length > 0;
}

/** A reload is allowed only after all synchronous and durable work is checked. */
export function appUpdateBlockReason(path: string): string | null {
  if (!navigator.onLine) return "Conecte-se à internet para atualizar.";
  if (!safeRoutes.has(path)) return "Volte ao painel ou à página inicial quando concluir sua atividade.";
  if (hasPendingApiMutations() || hasPendingSessionChanges()) return "Aguarde a conclusão da operação em andamento.";
  if ([...document.querySelectorAll("dialog[open], [aria-modal='true']")].some(visible)) return "Feche a janela aberta quando concluir sua atividade.";
  if ([...document.querySelectorAll<HTMLInputElement>("input[type='file']")].some((input) => Boolean(input.files?.length))) return "Conclua o envio dos arquivos antes de atualizar.";
  if ([...document.forms].some((form) => visible(form) && (dirtyForms.has(form) || form.dataset.hvmUpdateDirty === "true"))) return "Salve ou conclua as alterações antes de atualizar.";
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.matches("input:not([type='button']):not([type='submit']), textarea, select, [contenteditable='true']")) return "Conclua o preenchimento antes de atualizar.";
  return null;
}

export function AppUpdateNotice({ path, session }: { path: string; session: ShellSession | null }) {
  const { data } = useAppDistribution();
  const native = isNativeApp();
  const initialCommit = useRef(typeof __HVM_BUILD_COMMIT_SHA__ === "string" ? __HVM_BUILD_COMMIT_SHA__ : "");
  const [dismissedCommit, setDismissedCommit] = useState<string | null>(null);
  const current = useRef({ path, session, data });
  current.current = { path, session, data };
  const [reason, setReason] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);
  const flight = useRef(false);
  const checkRevision = useRef(0);
  const updateAttempt = useRef(0);
  // A reload of a bundled native app cannot install a new JavaScript bundle.
  // Signed native updates are handled by NativeUpdateNotice instead.
  const updateAvailable = Boolean(!native && data?.web.available && /^[a-f0-9]{40}$/i.test(data.web.commitSha) && initialCommit.current && data.web.commitSha !== initialCommit.current);
  const noticeVisible = updateAvailable && dismissedCommit !== data?.web.commitSha;

  useEffect(() => {
    if (!initialCommit.current && data?.web.available && /^[a-f0-9]{40}$/i.test(data.web.commitSha)) initialCommit.current = data.web.commitSha;
  }, [data]);

  useEffect(() => {
    mounted.current = true;
    const markDirty = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const form = target.closest("form");
      if (form) dirtyForms.add(form);
    };
    const clearDirty = (event: Event) => { if (event.target instanceof HTMLFormElement) dirtyForms.delete(event.target); };
    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    document.addEventListener("reset", clearDirty, true);
    return () => {
      mounted.current = false;
      checkRevision.current++;
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("change", markDirty, true);
      document.removeEventListener("reset", clearDirty, true);
    };
  }, []);

  useEffect(() => {
    if (!noticeVisible) return;
    let active = true;
    async function inspect() {
      const revision = ++checkRevision.current;
      const snapshot = current.current;
      let blocked = appUpdateBlockReason(snapshot.path);
      if (!blocked && snapshot.session?.userId) {
        try {
          const pending = await listPending(snapshot.session.userId);
          if (pending.length) blocked = "Sincronize ou resolva as ações salvas para uso sem internet antes de atualizar.";
        } catch {
          blocked = "Não foi possível confirmar as ações salvas. Tente atualizar novamente em instantes.";
        }
      }
      if (active && revision === checkRevision.current) setReason(appUpdateBlockReason(current.current.path) ?? blocked);
    }
    const inspectEvent = () => { void inspect(); };
    const events = ["hvm:api-mutating", "hvm:offline-changed", "hvm:session-changed", "hvm:session-cleared", "online", "offline", "focus"];
    for (const event of events) window.addEventListener(event, inspectEvent);
    document.addEventListener("input", inspectEvent);
    document.addEventListener("change", inspectEvent);
    document.addEventListener("focusout", inspectEvent);
    document.addEventListener("close", inspectEvent, true);
    const timer = window.setInterval(inspectEvent, 2000);
    void inspect();
    return () => {
      active = false;
      checkRevision.current++;
      for (const event of events) window.removeEventListener(event, inspectEvent);
      document.removeEventListener("input", inspectEvent);
      document.removeEventListener("change", inspectEvent);
      document.removeEventListener("focusout", inspectEvent);
      document.removeEventListener("close", inspectEvent, true);
      window.clearInterval(timer);
    };
  }, [path, session?.userId, noticeVisible]);

  async function apply() {
    if (native || flight.current) return;
    flight.current = true;
    setChecking(true);
    const attempt = ++updateAttempt.current;
    const snapshot = current.current;
    let blocked = appUpdateBlockReason(snapshot.path);
    try {
      if (!blocked && snapshot.session?.userId) {
        const pending = await listPending(snapshot.session.userId);
        if (pending.length) blocked = "Sincronize ou resolva as ações salvas para uso sem internet antes de atualizar.";
      }
      if (!mounted.current || attempt !== updateAttempt.current) return;
      if (snapshot.path !== current.current.path || snapshot.session?.userId !== current.current.session?.userId) blocked = "Seu acesso mudou. Tente novamente quando concluir sua atividade.";
      blocked = appUpdateBlockReason(current.current.path) ?? blocked;
      if (blocked) { setReason(blocked); return; }
      if (current.current.data?.web.available && current.current.data.web.commitSha !== initialCommit.current) window.location.reload();
    } catch {
      if (mounted.current) setReason("Não foi possível confirmar as ações salvas. Tente atualizar novamente em instantes.");
    } finally {
      flight.current = false;
      if (mounted.current) setChecking(false);
    }
  }

  function postpone() {
    updateAttempt.current++;
    setDismissedCommit(current.current.data?.web.commitSha ?? null);
  }

  if (!noticeVisible) return null;
  return <aside className="hvm-app-update-notice" aria-label="Atualização da plataforma">
    <span className="hvm-app-update-mark"><RefreshCw size={19} aria-hidden="true" /></span>
    <div className="hvm-app-update-copy" role="status"><strong>Uma nova versão está disponível</strong><p>{reason ?? "Atualize quando estiver pronto para receber as melhorias."}</p></div>
    <div className="hvm-app-update-actions"><button type="button" disabled={Boolean(reason) || checking} onClick={() => void apply()}>{checking ? "Verificando…" : "Atualizar agora"}</button><button type="button" className="hvm-app-update-postpone" onClick={postpone}>Mais tarde</button></div>
  </aside>;
}
