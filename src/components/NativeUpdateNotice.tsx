import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Download, ShieldCheck, Smartphone, X } from "lucide-react";
import { assessMobileUpdate } from "../../shared/contracts/mobileReleases";
import type { ShellSession } from "../hooks/useSession";
import { useMobileReleases } from "../hooks/useMobileReleases";
import { hasPendingApiMutations, hasPendingSessionChanges } from "../lib/api";
import { readAdminSessionIdentityVersion } from "../lib/adminSessionStore";
import { listPending } from "../lib/offlineDb";
import { openNativeDownload, readInstalledApp, type InstalledNativeApp } from "../lib/installedApp";
import { isNativeApp } from "../lib/nativeTransport";
import "./nativeUpdateNotice.css";

const editedForms = new WeakSet<HTMLFormElement>();
const visible = (element: Element) => element.getClientRects().length > 0;

export function nativeUpdateOpeningBlockReason(ownDialog?: HTMLDialogElement | null): string | null {
  if (!navigator.onLine) return "Conecte-se à internet para abrir a instalação.";
  if (hasPendingApiMutations() || hasPendingSessionChanges()) return "Aguarde a conclusão da operação em andamento.";
  if ([...document.querySelectorAll("dialog[open], [aria-modal='true']")].some((element) => element !== ownDialog && visible(element)))
    return "Conclua a operação da outra janela antes de abrir a instalação.";
  if ([...document.querySelectorAll<HTMLInputElement>("input[type='file']")].some((input) => Boolean(input.files?.length)))
    return "Conclua o envio dos arquivos antes de atualizar.";
  if ([...document.forms].some((form) => visible(form) && (editedForms.has(form) || form.dataset.hvmUpdateDirty === "true")))
    return "Salve ou conclua suas alterações antes de atualizar.";
  return null;
}

/** A native update is an explicit installation. No background reload can discard work. */
export function NativeUpdateNotice({ session }: { session: ShellSession | null }) {
  return isNativeApp() ? <InstalledUpdateNotice session={session} /> : null;
}

function InstalledUpdateNotice({ session }: { session: ShellSession | null }) {
  const { data, error, reload } = useMobileReleases();
  const [installed, setInstalled] = useState<InstalledNativeApp | null>(null);
  const [dismissedRelease, setDismissedRelease] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [openingError, setOpeningError] = useState("");
  const mounted = useRef(true);
  const flight = useRef(false);
  const generation = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = useRef({ session, data, installed });
  current.current = { session, data, installed };
  const latest = installed && data ? data[installed.platform] : null;
  const assessment = installed && data ? assessMobileUpdate(installed, data) : null;
  const required = Boolean(assessment?.required);
  const available = Boolean(assessment?.available);
  const noticeVisible = Boolean(installed && data && (required || (available && dismissedRelease !== latest?.id)));

  useEffect(() => {
    mounted.current = true;
    void readInstalledApp().then((info) => { if (mounted.current) setInstalled(info); }).catch(() => {
      // An unverified installed identity must never be replaced by a browser/UA guess.
    });
    const markEdited = (event: Event) => {
      if (!(event.target instanceof HTMLElement)) return;
      const form = event.target.closest("form");
      if (form) editedForms.add(form);
    };
    const reset = (event: Event) => { if (event.target instanceof HTMLFormElement) editedForms.delete(event.target); };
    document.addEventListener("input", markEdited, true);
    document.addEventListener("change", markEdited, true);
    document.addEventListener("reset", reset, true);
    return () => {
      mounted.current = false;
      generation.current++;
      document.removeEventListener("input", markEdited, true);
      document.removeEventListener("change", markEdited, true);
      document.removeEventListener("reset", reset, true);
    };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (details && noticeVisible && element && !element.open) element.showModal();
    if ((!details || !noticeVisible) && element?.open) element.close();
  }, [details, noticeVisible]);

  useEffect(() => {
    if (!noticeVisible) return;
    let active = true;
    async function inspect() {
      const revision = ++generation.current;
      const snapshot = current.current;
      let blocked = nativeUpdateOpeningBlockReason(dialog.current);
      if (!blocked && snapshot.session?.userId) {
        try {
          if ((await listPending(snapshot.session.userId)).length)
            blocked = "Sincronize ou resolva as ações salvas sem internet antes de atualizar.";
        } catch { blocked = "Não foi possível verificar as ações salvas. Tente novamente em instantes."; }
      }
      if (active && revision === generation.current)
        setReason(nativeUpdateOpeningBlockReason(dialog.current) ?? blocked);
    }
    const inspectEvent = () => { void inspect(); };
    const events = ["focus", "online", "offline", "hvm:api-mutating", "hvm:offline-changed", "hvm:session-changed", "hvm:session-cleared"];
    for (const name of events) window.addEventListener(name, inspectEvent);
    document.addEventListener("input", inspectEvent);
    document.addEventListener("change", inspectEvent);
    document.addEventListener("reset", inspectEvent);
    document.addEventListener("close", inspectEvent, true);
    const timer = window.setInterval(inspectEvent, 2000);
    void inspect();
    return () => {
      active = false;
      generation.current++;
      for (const name of events) window.removeEventListener(name, inspectEvent);
      document.removeEventListener("input", inspectEvent);
      document.removeEventListener("change", inspectEvent);
      document.removeEventListener("reset", inspectEvent);
      document.removeEventListener("close", inspectEvent, true);
      window.clearInterval(timer);
    };
  }, [noticeVisible, session?.userId, session?.activeRole]);

  async function openInstallation() {
    if (flight.current || !latest || !installed || error) return;
    const snapshot = current.current;
    const releaseId = latest.id;
    const identityVersion = readAdminSessionIdentityVersion();
    const sameSnapshot = () => mounted.current &&
      snapshot.session?.userId === current.current.session?.userId &&
      snapshot.session?.activeRole === current.current.session?.activeRole &&
      identityVersion === readAdminSessionIdentityVersion() &&
      current.current.data?.[installed.platform]?.id === releaseId;
    flight.current = true;
    setBusy(true);
    setOpeningError("");
    try {
      let blocked = nativeUpdateOpeningBlockReason(dialog.current);
      if (!blocked && snapshot.session?.userId && (await listPending(snapshot.session.userId)).length)
        blocked = "Sincronize ou resolva as ações salvas sem internet antes de atualizar.";
      if (!sameSnapshot()) return;
      blocked = nativeUpdateOpeningBlockReason(dialog.current) ?? blocked;
      if (blocked) { setReason(blocked); return; }
      await openNativeDownload(installed.platform);
      if (sameSnapshot()) setDetails(false);
    } catch {
      if (sameSnapshot()) setOpeningError("Não foi possível abrir a instalação. Seu trabalho foi preservado; tente novamente.");
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!noticeVisible || !installed || !data) return null;
  const title = required ? "Atualização necessária" : "Nova versão do aplicativo";
  const platformName = installed.platform === "android" ? "Android" : "iOS";
  const notes = latest?.releaseNotes || "Esta versão melhora o aplicativo e mantém sua conexão com a plataforma.";
  return <>
    <aside className={"hvm-native-update-notice" + (required ? " is-required" : "")} aria-label="Atualização do aplicativo instalado" role="complementary">
      <span className="hvm-native-update-icon"><Smartphone size={20} /></span>
      <div><strong>{title}</strong><p>{latest ? `${platformName} · versão ${latest.version}` : "A instalação está temporariamente indisponível. Verifique novamente em instantes."}</p></div>
      <div className="hvm-native-update-actions"><button type="button" onClick={() => { setOpeningError(""); setDetails(true); }}><Download size={14} /> Ver atualização</button>{!required && latest && <button type="button" className="hvm-native-update-later" onClick={() => { generation.current++; setDismissedRelease(latest.id); }}>Mais tarde</button>}</div>
    </aside>
    <dialog ref={dialog} className="hvm-native-update-dialog" aria-labelledby="hvm-native-update-title" onCancel={(event) => { if (busy) event.preventDefault(); else setDetails(false); }} onClose={() => { if (!busy) setDetails(false); }}>
      <header><div><span><ShieldCheck size={15} /> Atualização verificada</span><h2 id="hvm-native-update-title">{title}</h2></div><button type="button" className="hvm-native-update-close" aria-label="Fechar detalhes da atualização" disabled={busy} onClick={() => setDetails(false)}><X size={19} /></button></header>
      <dl><div><dt>Seu aplicativo</dt><dd>{installed.version} · compilação {installed.buildNumber}</dd></div><div><dt>Versão disponível</dt><dd>{latest ? `${latest.version} · compilação ${latest.buildNumber}` : "Indisponível neste momento"}</dd></div></dl>
      {required && <p className="hvm-native-update-warning">Sua compilação precisa ser atualizada para continuar recebendo as correções necessárias. Seus registros permanecem no sistema.</p>}
      {latest && <div className="hvm-native-update-notes"><strong>O que mudou</strong><p>{notes}</p></div>}
      <p className="hvm-native-update-help">A instalação será aberta somente com sua confirmação. A atualização do aplicativo preserva os dados do servidor. Conclua suas edições e sincronize ações salvas antes de instalar.</p>
      {(reason || openingError) && <p className="hvm-native-update-warning" role={openingError ? "alert" : "status"}>{openingError || reason}</p>}
      <footer>{latest && !error ? <button type="button" className="hvm-native-update-primary" disabled={busy || Boolean(reason)} onClick={() => void openInstallation()}>{busy ? "Abrindo instalação…" : installed.platform === "ios" ? "Abrir canal oficial da Apple" : "Abrir instalação Android"}<ArrowUpRight size={15} /></button> : <button type="button" className="hvm-native-update-primary" onClick={reload}>Verificar disponibilidade</button>}<button type="button" disabled={busy} onClick={() => setDetails(false)}>Voltar ao aplicativo</button></footer>
    </dialog>
  </>;
}
