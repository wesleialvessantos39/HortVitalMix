import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Cloud, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { hasAdminPermission } from "../../../shared/adminPermissions";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import {
  AdminAppDistributionResponseSchema,
  AppDistributionUpdateResultSchema,
  UpdateAppDistributionRequestSchema,
  type AdminAppDistributionResponse,
  type UpdateAppDistributionRequest,
} from "../../../shared/contracts/appDistribution";
import { PageLoading } from "../../components/PageLoading";
import { AdminReauthentication } from "../../components/commerce/AdminReauthentication";
import { api, type ApiFailure } from "../../lib/api";
import { readAdminSessionIdentityVersion } from "../../lib/adminSessionStore";
import { cryptoRandomUUID } from "../../lib/uuid";
import { AdminMobileReleaseCenter } from "./AdminMobileReleaseCenter";
import "./appDistribution.css";

type Draft = { androidVersion: string; androidUrl: string; iosVersion: string; iosUrl: string; releaseNotes: string };
const emptyDraft: Draft = { androidVersion: "", androidUrl: "", iosVersion: "", iosUrl: "", releaseNotes: "" };
function fromManifest(data: AdminAppDistributionResponse): Draft {
  return { androidVersion: data.android.version ?? "", androidUrl: data.android.url ?? "", iosVersion: data.ios.version ?? "", iosUrl: data.ios.url ?? "", releaseNotes: data.releaseNotes };
}

export default function AdminAppDistributionPage({ access, onNavigate }: {
  access: AdminVerifySessionResponse;
  onNavigate: (path: string) => void;
}) {
  const [data, setData] = useState<AdminAppDistributionResponse | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ command: UpdateAppDistributionRequest; actorId: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const flight = useRef(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const commandId = useRef(cryptoRandomUUID());
  const allowed = hasAdminPermission(access, "platform_configuration");
  const scopeKey = JSON.stringify([access.role, [...access.sectors].sort(), [...(access.deniedSectors ?? [])].sort()]);

  async function load() {
    const identity = readAdminSessionIdentityVersion();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await api<unknown>("/v1/admin/app-distribution", { signal: controller.signal });
      const parsed = AdminAppDistributionResponseSchema.safeParse(result);
      if (!parsed.success) throw Error("INVALID_APP_DISTRIBUTION");
      if (!mounted.current || controller.signal.aborted || identity !== readAdminSessionIdentityVersion()) return;
      setData(parsed.data);
      setDraft(fromManifest(parsed.data));
      setConflict(false);
      commandId.current = cryptoRandomUUID();
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted) return;
      const status = (cause as ApiFailure).status;
      if (status === 401 || status === 403) { setData(null); setDraft(emptyDraft); }
      setError(status === 403 ? "Seu acesso não permite gerenciar aplicativos." : "Não foi possível consultar a distribuição. Tente novamente.");
    } finally {
      if (mounted.current && !controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    setData(null);
    setDraft(emptyDraft);
    setConfirmation(null);
    setSuccess("");
    if (allowed) void load();
    else setLoading(false);
    return () => { mounted.current = false; request.current?.abort(); };
  }, [scopeKey, allowed]);

  useEffect(() => {
    const element = dialog.current;
    if (confirmation && element && !element.open) element.showModal();
    if (!confirmation && element?.open) element.close();
    if (!confirmation) setConfirmationBusy(false);
  }, [confirmation]);

  async function execute(command: UpdateAppDistributionRequest, confirmed = false) {
    if (flight.current || !allowed) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    const identity = readAdminSessionIdentityVersion();
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await api<unknown>("/v1/admin/app-distribution", { method: "PATCH", signal: controller.signal, body: JSON.stringify(command) });
      const parsed = AppDistributionUpdateResultSchema.safeParse(result);
      if (!parsed.success) throw Error("INVALID_APP_DISTRIBUTION_UPDATE");
      if (!mounted.current || controller.signal.aborted || identity !== readAdminSessionIdentityVersion()) return;
      setSuccess(parsed.data.status === "no_change" ? "A distribuição já está atualizada." : "Distribuição publicada. Os downloads agora apontam para a versão configurada.");
      window.dispatchEvent(new Event("hvm:app-distribution-changed"));
      window.dispatchEvent(new Event("hvm:departments-changed"));
      await load();
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || identity !== readAdminSessionIdentityVersion()) return;
      const failure = cause as ApiFailure;
      if (failure.message === "ADMIN_REAUTHENTICATION_REQUIRED" && !confirmed && failure.actorId) {
        setConfirmation({ command, actorId: failure.actorId });
      } else if (failure.status === 409) {
        setConflict(true);
        setError("Outra sessão alterou esta distribuição. Confira a versão atual antes de publicar; seu rascunho foi preservado.");
      } else if (failure.status === 401) {
        setError(failure.message === "ADMIN_REAUTHENTICATION_REQUIRED" ? "A confirmação ainda não foi reconhecida. Entre novamente pelo seu acesso administrativo antes de publicar." : "Sua sessão expirou. Entre novamente pelo acesso administrativo.");
      } else if (failure.status === 403) {
        setData(null);
        setDraft(emptyDraft);
        setConfirmation(null);
        setError("Seus poderes não permitem publicar estes aplicativos.");
      } else if (failure.status === 422) {
        setError("Revise os endereços e as versões. Use somente os canais de distribuição permitidos.");
      } else setError("Não foi possível publicar agora. O rascunho foi preservado; tente novamente.");
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!data || busy || confirmation || conflict) return;
    const input = { commandId: commandId.current, expectedRevision: data.revision, payload: {
      android: draft.androidVersion.trim() || draft.androidUrl.trim() ? { version: draft.androidVersion.trim(), url: draft.androidUrl.trim() } : null,
      ios: draft.iosVersion.trim() || draft.iosUrl.trim() ? { version: draft.iosVersion.trim(), url: draft.iosUrl.trim() } : null,
      releaseNotes: draft.releaseNotes.trim(),
    } };
    const parsed = UpdateAppDistributionRequestSchema.safeParse(input);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Confira as versões e os links de instalação."); return; }
    void execute(parsed.data);
  }

  function update(key: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    // Uma edição depois de uma falha é uma nova intenção; repetir o rascunho
    // intacto mantém a chave para evitar publicação duplicada na rede.
    commandId.current = cryptoRandomUUID();
    setSuccess("");
  }

  if (!allowed) return <section className="admin-distribution-page"><div className="admin-distribution-banner" role="alert"><ShieldCheck size={19} /><p>Este departamento exige o poder de Configuração da plataforma e BI.</p></div></section>;
  if (loading && !data) return <PageLoading label="Carregando aplicativos" />;
  const hasChanges = Boolean(data && JSON.stringify(draft) !== JSON.stringify(fromManifest(data)));

  return <section className="admin-distribution-page" aria-labelledby="admin-distribution-title">
    <header className="admin-distribution-header"><div><span className="admin-distribution-eyebrow"><Smartphone size={14} /> Distribuição digital</span><h1 id="admin-distribution-title">Aplicativos e atualizações</h1><p>Gerencie os canais de instalação e acompanhe a versão publicada da plataforma.</p></div><button type="button" disabled={loading || busy || hasChanges || Boolean(confirmation)} onClick={() => void load()} aria-label="Atualizar distribuição"><RefreshCw size={16} className={loading ? "hvm-sync-spinning" : undefined} /> Atualizar</button></header>
    {error && <div className="admin-distribution-banner is-warning" role="alert"><AlertTriangle size={18} /><div><p>{error}</p>{conflict && <button type="button" onClick={() => { setSuccess(""); void load(); }}>Descartar rascunho e carregar versão atual</button>}{!data && <button type="button" onClick={() => void load()}>Tentar novamente</button>}</div></div>}
    {success && <div className="admin-distribution-banner is-success" role="status"><CheckCircle2 size={18} /><p>{success}</p></div>}
    {data && <>
      <div className="admin-distribution-web"><span className="admin-distribution-web-icon"><Cloud size={23} /></span><div><strong>Plataforma web</strong><p>{data.web.available ? "Versão publicada e sincronizada" : "Publicação em verificação"}</p><span>{data.web.version}</span></div><span className="admin-distribution-revision">Revisão {data.revision}</span></div>
      <AdminMobileReleaseCenter access={access} />
      <form className="admin-distribution-form" onSubmit={submit}>
        <div className="admin-distribution-platforms">
          {(["android", "ios"] as const).map((platform) => {
            const title = platform === "android" ? "Android" : "iPhone e iPad";
            const versionKey = platform === "android" ? "androidVersion" : "iosVersion";
            const urlKey = platform === "android" ? "androidUrl" : "iosUrl";
            return <fieldset key={platform} disabled={busy || Boolean(confirmation) || data[platform].managedBy === "pipeline"}><legend><Smartphone size={17} /> {title}</legend><span className={"admin-distribution-platform-status" + (data[platform].available ? " is-ready" : "")}>{data[platform].available ? "Disponível para instalação" : "Ainda não publicado"}</span><label>Versão {title}<input value={draft[versionKey]} onChange={(event) => update(versionKey, event.target.value)} placeholder="1.0.0" maxLength={40} inputMode="text" autoComplete="off" /></label><label>Link de instalação {title}<input value={draft[urlKey]} onChange={(event) => update(urlKey, event.target.value)} placeholder={platform === "android" ? "Link da Play Store ou APK autorizado" : "Link da App Store ou TestFlight"} maxLength={2048} inputMode="url" autoComplete="off" type="url" /></label><p className="admin-distribution-help">{data[platform].managedBy === "pipeline" ? "Canal gerenciado pela sincronização. Publique, retire ou restaure esta versão na Central de versões." : platform === "android" ? "Use a Play Store ou um APK na pasta app-downloads do Storage. Informe versão e link juntos." : "Use um canal autorizado da Apple. Informe versão e link juntos."} Para retirar a instalação, deixe os dois campos vazios.</p></fieldset>;
          })}
        </div>
        <label className="admin-distribution-notes">Novidades da versão<textarea value={draft.releaseNotes} onChange={(event) => update("releaseNotes", event.target.value)} maxLength={1600} rows={3} disabled={busy || Boolean(confirmation)} placeholder="Descreva as melhorias para quem usa o aplicativo." /></label>
        <footer className="admin-distribution-form-footer"><span><ShieldCheck size={14} /> Publicação protegida e auditada</span><button type="submit" disabled={!hasChanges || busy || loading || conflict || Boolean(confirmation)}>{busy ? "Publicando…" : hasChanges ? "Publicar distribuição" : "Tudo atualizado"}</button></footer>
      </form>
      <div className="admin-distribution-guidance"><strong>Atualização contínua</strong><p>Dados e serviços são atualizados ao conectar. Novas versões do aplicativo instalado geram um aviso; pacotes e canais de instalação são controlados na Central de versões.</p><button type="button" onClick={() => onNavigate("/aplicativos")}>Ver página de downloads <ArrowUpRight size={15} /></button></div>
    </>}
    <dialog ref={dialog} className="admin-distribution-confirmation" aria-labelledby="admin-distribution-confirmation-title" onCancel={(event) => { if (confirmationBusy) event.preventDefault(); else setConfirmation(null); }} onClose={() => { if (!confirmationBusy) setConfirmation(null); }}>
      <h2 id="admin-distribution-confirmation-title">Confirmar publicação dos aplicativos</h2>
      {confirmation && <AdminReauthentication expectedRole={access.role} expectedUserId={confirmation.actorId} onBusyChange={setConfirmationBusy} onCancel={() => setConfirmation(null)} onConfirmed={async () => { const command = confirmation.command; setConfirmation(null); await execute(command, true); }} />}
    </dialog>
  </section>;
}
