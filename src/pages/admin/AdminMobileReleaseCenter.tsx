import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Cloud, GitBranch, History, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { hasAdminPermission } from "../../../shared/adminPermissions";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import {
  AdminMobileReleasesSchema,
  MobileReleaseCommandResultSchema,
  MobileReleaseCommandSchema,
  type AdminMobileRelease,
  type AdminMobileReleases,
  type MobileReleaseCommand,
} from "../../../shared/contracts/mobileReleases";
import { api, type ApiFailure } from "../../lib/api";
import { readAdminSessionIdentityVersion } from "../../lib/adminSessionStore";
import { cryptoRandomUUID } from "../../lib/uuid";
import { AdminCommandConfirmation, useAdminConfirmedCommand } from "./useAdminConfirmedCommand";
import "./adminMobileReleaseCenter.css";

const names = { android: "Android", ios: "iPhone e iPad" } as const;
const statusNames = { verified: "Verificada · aguarda publicação", published: "Publicada", withdrawn: "Retirada" } as const;
const actionNames = { publish: "Publicar versão", withdraw: "Retirar versão", restore: "Restaurar versão", configure: "Salvar sincronização" } as const;
type Automation = { android: boolean; ios: boolean };

function date(value: string | null) {
  if (!value) return "Ainda não verificado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Cuiaba" }).format(new Date(value));
}
function formatSize(size: number) { return `${(size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`; }

export function AdminMobileReleaseCenter({ access }: { access: AdminVerifySessionResponse }) {
  const allowed = hasAdminPermission(access, "platform_configuration");
  const scopeKey = JSON.stringify([access.role, [...access.sectors].sort(), [...(access.deniedSectors ?? [])].sort()]);
  const [data, setData] = useState<AdminMobileReleases | null>(null);
  const [loading, setLoading] = useState(false);
  const [automation, setAutomation] = useState<Automation>({ android: false, ios: false });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false);
  const [filter, setFilter] = useState("all");
  const [intent, setIntent] = useState<{ action: "publish" | "withdraw" | "restore"; release: AdminMobileRelease } | null>(null);
  const [retry, setRetry] = useState<MobileReleaseCommand | null>(null);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const configurationCommandId = useRef(cryptoRandomUUID());
  const current = useRef({ data, automation, allowed });
  current.current = { data, automation, allowed };
  const automationDirty = Boolean(data && JSON.stringify(automation) !== JSON.stringify(data.autoPublish));

  const commands = useAdminConfirmedCommand(access.role, (cause) => {
    const failure = cause as ApiFailure;
    if (failure.status === 409) {
      setConflict(true);
      setError("Outra sessão alterou as versões. Seu rascunho foi preservado; confira a situação atual antes de continuar.");
    } else if (failure.status === 403) {
      setData(null);
      setRetry(null);
      setIntent(null);
      setError("Seus poderes não permitem gerenciar a sincronização dos aplicativos.");
    } else if (failure.status === 401) {
      setError("Confirme o mesmo acesso administrativo para continuar esta operação.");
    } else if (failure.status === 422) {
      setError("Esta versão não pode ser publicada com a política atual. Confira a compilação mínima e o histórico.");
    } else setError("Não foi possível concluir a alteração. A mesma operação pode ser tentada novamente.");
  });
  const currentBusy = useRef(false);
  currentBusy.current = commands.busy || Boolean(commands.confirmation);

  async function load(options: { discard?: boolean; quiet?: boolean } = {}) {
    if (!current.current.allowed || currentBusy.current) return;
    const identity = readAdminSessionIdentityVersion();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    if (!options.quiet) setError("");
    try {
      const result = await api<unknown>("/v1/admin/mobile-releases", { signal: controller.signal });
      const parsed = AdminMobileReleasesSchema.safeParse(result);
      if (!parsed.success) throw Error("INVALID_MOBILE_RELEASE_CENTER");
      if (!mounted.current || controller.signal.aborted || identity !== readAdminSessionIdentityVersion()) return;
      const dirty = current.current.data && JSON.stringify(current.current.automation) !== JSON.stringify(current.current.data.autoPublish);
      // A background verification updates real status without overwriting an operator's draft.
      if (options.discard || !dirty) setAutomation(parsed.data.autoPublish);
      if (dirty && !options.discard && current.current.data?.revision !== parsed.data.revision) {
        setConflict(true);
        setError("Outra sessão alterou as versões. Seu rascunho foi preservado; confira a situação atual antes de continuar.");
      }
      setData(parsed.data);
      if (options.discard) {
        setConflict(false);
        setRetry(null);
        setIntent(null);
        configurationCommandId.current = cryptoRandomUUID();
      }
      if (!options.quiet) setError("");
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || identity !== readAdminSessionIdentityVersion()) return;
      const failure = cause as ApiFailure;
      // An old successful response is not proof that synchronization still works.
      setData(null);
      setError(failure.status === 403 ? "Seu acesso não permite consultar as versões assinadas." : "Não foi possível verificar a sincronização. Nenhuma situação de publicação foi presumida.");
    } finally {
      if (mounted.current && !controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    setData(null);
    setAutomation({ android: false, ios: false });
    setIntent(null);
    setRetry(null);
    setSuccess("");
    setConflict(false);
    if (allowed) void load({ discard: true });
    const inspect = () => {
      if (document.visibilityState !== "hidden" && !currentBusy.current)
        void load({ quiet: true });
    };
    const timer = window.setInterval(inspect, 60_000);
    window.addEventListener("focus", inspect);
    window.addEventListener("hvm:mobile-releases-changed", inspect);
    document.addEventListener("visibilitychange", inspect);
    return () => {
      mounted.current = false;
      request.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", inspect);
      window.removeEventListener("hvm:mobile-releases-changed", inspect);
      document.removeEventListener("visibilitychange", inspect);
    };
  }, [scopeKey, allowed]);

  function execute(command: MobileReleaseCommand) {
    if (!allowed || commands.busy || commands.confirmation || conflict) return;
    const parsed = MobileReleaseCommandSchema.safeParse(command);
    if (!parsed.success) { setError("Confira a versão e a operação escolhida."); return; }
    setError("");
    setSuccess("");
    setRetry(parsed.data);
    setIntent(null);
    void commands.run(async (signal) => {
      const identity = readAdminSessionIdentityVersion();
      const result = await api<unknown>("/v1/admin/mobile-releases/commands", { method: "POST", signal, body: JSON.stringify(parsed.data) });
      const response = MobileReleaseCommandResultSchema.safeParse(result);
      if (!response.success) throw Error("INVALID_MOBILE_RELEASE_COMMAND");
      if (!mounted.current || signal.aborted || identity !== readAdminSessionIdentityVersion() || !current.current.allowed) return;
      const completedAction = parsed.data.action;
      setSuccess(response.data.status === "no_change" ? "A sincronização já está atualizada." : completedAction === "configure" ? "Sincronização automática atualizada." : completedAction === "withdraw" ? "Versão retirada. O download desta plataforma foi suspenso." : "Versão publicada. O download e os avisos do aplicativo foram atualizados.");
      setRetry(null);
      setConflict(false);
      configurationCommandId.current = cryptoRandomUUID();
      // The command's own task is still busy. Refresh directly under its signal
      // so the exact committed revision is shown without replaying the command.
      let refreshedData;
      try {
        const refreshed = await api<unknown>("/v1/admin/mobile-releases", { signal });
        refreshedData = AdminMobileReleasesSchema.safeParse(refreshed);
        if (!refreshedData.success) throw Error("INVALID_MOBILE_RELEASE_CENTER");
      } catch {
        if (mounted.current && !signal.aborted && identity === readAdminSessionIdentityVersion()) {
          setData(null);
          setError("A alteração foi concluída, mas não foi possível verificar a situação atual. Verifique novamente antes de fazer outra alteração.");
          window.dispatchEvent(new Event("hvm:mobile-releases-changed"));
          window.dispatchEvent(new Event("hvm:app-distribution-changed"));
        }
        return;
      }
      if (!mounted.current || signal.aborted || identity !== readAdminSessionIdentityVersion() || !current.current.allowed) return;
      setData(refreshedData.data);
      if (completedAction === "configure") setAutomation(refreshedData.data.autoPublish);
      window.dispatchEvent(new Event("hvm:mobile-releases-changed"));
      window.dispatchEvent(new Event("hvm:app-distribution-changed"));
    });
  }

  function saveAutomation(event: FormEvent) {
    event.preventDefault();
    if (!data || !automationDirty) return;
    execute({ commandId: configurationCommandId.current, expectedRevision: data.revision, action: "configure", autoPublish: automation });
  }

  if (!allowed) return null;
  const currentRelease = (platform: "android" | "ios") => data?.releases.find((release) => release.platform === platform && release.status === "published");
  const filtered = data?.releases.filter((release) => filter === "all" || release.platform === filter) ?? [];
  const locked = loading || commands.busy || Boolean(commands.confirmation) || conflict;

  return <section className="admin-mobile-release-center" aria-labelledby="admin-mobile-release-title">
    <header className="admin-mobile-release-header"><div><span><GitBranch size={14} /> Central de sincronização</span><h2 id="admin-mobile-release-title">Versões assinadas e atualizações</h2><p>Acompanhe a integração com o banco, a plataforma publicada e os aplicativos instalados.</p></div><button type="button" disabled={loading || commands.busy || Boolean(commands.confirmation) || automationDirty} onClick={() => void load()} aria-label="Verificar sincronização dos aplicativos"><RefreshCw size={15} className={loading ? "hvm-sync-spinning" : undefined} /> Verificar</button></header>
    {error && <div className="admin-mobile-release-message is-warning" role="alert"><AlertTriangle size={18} /><div><p>{error}</p>{conflict ? <button type="button" onClick={() => void load({ discard: true })}>Descartar rascunho e verificar versões atuais</button> : retry ? <button type="button" disabled={commands.busy || Boolean(commands.confirmation)} onClick={() => execute(retry)}>Tentar esta operação novamente</button> : <button type="button" disabled={loading} onClick={() => void load()}>Verificar novamente</button>}</div></div>}
    {success && <div className="admin-mobile-release-message" role="status"><CheckCircle2 size={17} /><p>{success}</p></div>}
    {loading && !data && !error && <p className="admin-mobile-release-loading" role="status">Verificando versões e sincronização…</p>}
    {data && <>
      <div className="admin-mobile-sync-grid">
        <div><Cloud size={17} /><span>Plataforma publicada</span><strong>Banco · esquema {data.sync.webSchema}</strong><small>{data.sync.webCommit ? `Publicação ${data.sync.webCommit.slice(0, 8)}` : "Publicação em verificação"}</small></div>
        <div><ShieldCheck size={17} /><span>Pacotes verificados</span><strong>{data.sync.state === "ready" ? "Sincronização disponível" : data.sync.state === "awaiting_first_release" ? "Aguarda primeira versão" : "Sincronização indisponível"}</strong><small>{data.sync.lastVerifiedAt ? `Última verificação ${date(data.sync.lastVerifiedAt)}` : "Nenhum pacote assinado recebido"}</small></div>
        <div><Smartphone size={17} /><span>Armazenamento Android</span><strong>{data.sync.storageConfigured ? "Canal preparado" : "Configuração pendente"}</strong><small>{data.sync.pendingUploads} {data.sync.pendingUploads === 1 ? "envio em preparação" : "envios em preparação"}</small></div>
      </div>
      <div className="admin-mobile-current-grid">
        {(["android", "ios"] as const).map((platform) => {
          const release = currentRelease(platform);
          return <article key={platform}><div className="admin-mobile-current-title"><Smartphone size={18} /><h3>{names[platform]}</h3><span className={release ? "is-published" : ""}>{release ? "Publicado" : "Sem versão publicada"}</span></div><strong>{release ? `Versão ${release.version}` : "Instalação em preparação"}</strong><p>{release ? `Compilação ${release.buildNumber} · ${formatSize(release.sizeBytes)}` : "O download será liberado após verificar e publicar um pacote assinado."}</p><footer><span>{data.minimumSupportedBuild[platform] ? `Compilação mínima ${data.minimumSupportedBuild[platform]}` : "Versão mínima a definir"}</span><span>{data.autoPublish[platform] ? "Atualização automática ativa" : "Publicação sob revisão"}</span></footer></article>;
        })}
      </div>
      <details className="admin-mobile-release-details"><summary><RefreshCw size={16} /><span>Política de sincronização automática</span><small>{data.autoPublish.android ? "Ativa" : "Sob revisão"}</small></summary><form onSubmit={saveAutomation} data-hvm-update-dirty={automationDirty ? "true" : "false"}><p>Primeiro publique uma versão Android assinada para confirmar a identidade do aplicativo. Depois, pacotes recebidos do fluxo autorizado e com a mesma assinatura podem atualizar o download e os avisos automaticamente. No iOS, o envio do pacote ainda precisa ser processado e aprovado no canal da Apple; confirme a disponibilidade antes de publicar cada versão.</p><div className="admin-mobile-automation-options"><label><input type="checkbox" checked={automation.android} disabled={commands.busy || Boolean(commands.confirmation)} onChange={(event) => { setAutomation({ android: event.target.checked, ios: false }); configurationCommandId.current = cryptoRandomUUID(); setRetry(null); setSuccess(""); }} /><span>Publicar automaticamente no Android</span></label><label><input type="checkbox" checked={false} disabled /><span>iOS: publicar após confirmação na Apple</span></label></div><button type="submit" disabled={!automationDirty || locked}>Salvar sincronização</button></form></details>
      <details className="admin-mobile-release-details admin-mobile-release-history"><summary><History size={16} /><span>Histórico e recuperação de versões</span><small>{data.releases.length}</small></summary><div className="admin-mobile-history-body"><div className="admin-mobile-history-toolbar"><p>Retire um download problemático ou restaure uma versão verificada sem alterar os dados do banco.</p><label>Plataforma do histórico<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todas as plataformas</option><option value="android">Android</option><option value="ios">iPhone e iPad</option></select></label></div>
        {!filtered.length ? <p className="admin-mobile-release-empty">Nenhuma versão assinada registrada para esta seleção.</p> : <ol className="admin-mobile-release-list">{filtered.map((release) => <li key={release.id}><div className="admin-mobile-release-row"><div><span>{names[release.platform]} · compilação {release.buildNumber}</span><strong>Versão {release.version}</strong><small>{statusNames[release.status]} · {date(release.verifiedAt)}</small></div><button type="button" disabled={locked || (release.status !== "published" && release.buildNumber < data.minimumSupportedBuild[release.platform])} onClick={() => { setRetry(null); setIntent({ action: release.status === "published" ? "withdraw" : release.status === "withdrawn" ? "restore" : "publish", release }); }}>{release.status === "published" ? "Retirar versão" : release.status === "withdrawn" ? "Restaurar versão" : "Publicar versão"}</button></div><details className="admin-mobile-package-detail"><summary>Novidades e verificação do pacote</summary><p>{release.releaseNotes || "Sem notas adicionais nesta versão."}</p><dl><div><dt>Compatibilidade do banco</dt><dd>Esquema {release.schemaVersion}</dd></div><div><dt>Pacote</dt><dd>{formatSize(release.sizeBytes)} · {release.channel === "apk" ? "APK assinado" : release.channel === "app_store" ? "App Store" : "TestFlight"}</dd></div><div><dt>Publicação original</dt><dd>{release.sourceCommit}</dd></div><div><dt>Assinatura do aplicativo</dt><dd>{release.signingIdentity}</dd></div><div><dt>Integridade SHA-256</dt><dd>{release.sha256}</dd></div><div><dt>Recursos nativos</dt><dd>{release.runtimeFingerprint}</dd></div><div><dt>Execução de compilação</dt><dd>{release.ciRunId} · tentativa {release.ciRunAttempt}</dd></div></dl></details></li>)}</ol>}
      </div></details>
      {intent && <div className="admin-mobile-release-impact" role="group" aria-label="Confirmar alteração da versão"><strong>{actionNames[intent.action]} {names[intent.release.platform]} {intent.release.version}?</strong><p>{intent.action === "withdraw" ? "O download desta plataforma ficará indisponível. Os dados e a compilação mínima de segurança serão preservados." : `Os novos downloads e avisos apontarão para a compilação ${intent.release.buildNumber}. Aplicativos anteriores à compilação mínima receberão um aviso de atualização necessária.`}</p><div><button type="button" disabled={locked} onClick={() => { if (data) execute({ commandId: cryptoRandomUUID(), expectedRevision: data.revision, action: intent.action, releaseId: intent.release.id }); }}>Confirmar {intent.action === "withdraw" ? "retirada" : intent.action === "restore" ? "restauração" : "publicação"}</button><button type="button" onClick={() => setIntent(null)}>Cancelar alteração</button></div></div>}
      <p className="admin-mobile-release-footnote">Revisão {data.revision} · verificada {date(data.updatedAt)}. Alterações são protegidas por permissões e confirmação de identidade.</p>
    </>}
    <AdminCommandConfirmation confirmation={commands.confirmation} onConfirmed={commands.confirm} onCancel={commands.cancel} />
  </section>;
}
