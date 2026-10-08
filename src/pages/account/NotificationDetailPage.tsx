import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bell, CheckCheck, Info } from "lucide-react";
import {
  notificationBase,
  notificationRoleLabel,
  useNotifications,
} from "../../components/notifications/NotificationProvider";
import { PageLoading } from "../../components/PageLoading";
import { api, type ApiFailure } from "../../lib/api";
import { date } from "../../lib/commerce";
import { NotificationDetailSchema, type NotificationDetail } from "../../../shared/contracts/notification";
import "./notificationDetail.css";

export default function NotificationDetailPage({ id, onNavigate }: {
  id: string;
  onNavigate: (to: string) => void;
}) {
  const state = useNotifications();
  const role = state?.session?.activeRole;
  const actor = `${state?.session?.userId ?? ""}:${role ?? ""}`;
  const base = notificationBase(role);
  const apiBase = base === "/admin/notificacoes" ? "/v1/admin/notifications" : "/v1/notifications";
  const [snapshot, setSnapshot] = useState<{ actor: string; id: string; detail: NotificationDetail } | null>(null);
  const [failure, setFailure] = useState<{ actor: string; id: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const readRef = useRef(state?.read);
  readRef.current = state?.read;
  const data = snapshot?.actor === actor && snapshot.id === id ? snapshot.detail : null;
  const validId = NotificationDetailSchema.shape.id.safeParse(id).success;
  const error = !validId ? "Este aviso não está disponível para a sua conta." : failure?.actor === actor && failure.id === id ? failure.message : "";
  const enabled = !!state?.session;

  useEffect(() => {
    setSnapshot(null);
    setFailure(null);
    if (!enabled || !validId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const detail = NotificationDetailSchema.parse(await api(apiBase + "/" + encodeURIComponent(id), { signal: controller.signal }));
        if (controller.signal.aborted) return;
        if (detail.recipientRole !== role) throw new Error("INVALID_NOTIFICATION_AUDIENCE");
        setSnapshot({ actor, id, detail });
        // Viewing the explanation acknowledges this notice. Its department is
        // opened only by the explicit action button below.
        if (!detail.readAt && readRef.current) {
          const marked = await readRef.current(detail.id);
          if (marked && !controller.signal.aborted) {
            setSnapshot({ actor, id, detail: { ...detail, readAt: new Date().toISOString() } });
          }
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          const status = (caught as ApiFailure).status;
          setFailure({ actor, id, message: status === 404
            ? "Este aviso não está disponível para a sua conta."
            : status === 401 || status === 403
              ? "Seu acesso a este aviso não está disponível. Volte para suas notificações."
              : "Não foi possível abrir a notificação. Tente novamente." });
        }
      }
    })();
    return () => controller.abort();
  }, [actor, apiBase, enabled, id, role, revision, validId]);

  if (!state?.session) return <section className="account-notice"><h1>Notificação</h1><p>Entre na sua conta para consultar este aviso.</p><button className="primary" onClick={() => onNavigate("/entrar")}>Entrar</button></section>;
  return <section className={`hvm-notification-detail${role === "platform_super_admin" ? " is-super-admin" : ""}`} aria-labelledby="notification-detail-title">
    <button className="hvm-notification-back" onClick={() => onNavigate(base)}><ArrowLeft size={16} aria-hidden="true" /> Todas as notificações</button>
    {!data && !error && <PageLoading label="Carregando notificação…" compact />}
    {error && <div className="hvm-notification-detail-unavailable"><Info size={25} aria-hidden="true" /><h1 id="notification-detail-title">Notificação indisponível</h1><p role="alert">{error}</p>{validId && <button className="secondary" onClick={() => setRevision(n => n + 1)}>Tentar novamente</button>}</div>}
    {data && <>
      <header className="hvm-notification-detail-heading">
        <span className="hvm-notification-detail-icon"><Bell size={23} aria-hidden="true" /></span>
        <div><span className="hvm-notification-eyebrow">{notificationRoleLabel(role)} · {data.context.categoryLabel}</span><h1 id="notification-detail-title">{data.title}</h1></div>
      </header>
      <dl className="hvm-notification-detail-meta">
        <div><dt>Assunto</dt><dd>{data.context.categoryLabel}</dd></div>
        <div><dt>Seu perfil</dt><dd>{data.context.audienceLabel}</dd></div>
        <div><dt>Recebida em</dt><dd><time dateTime={data.createdAt}>{date(data.createdAt)}</time></dd></div>
        <div><dt>Leitura</dt><dd className="hvm-notification-detail-read">{data.readAt ? <><CheckCheck size={14} aria-hidden="true" /> Lida</> : "Não lida"}</dd></div>
      </dl>
      <article className="hvm-notification-explanation"><h2>O que aconteceu</h2><p>{data.message}</p></article>
      <div className="hvm-notification-detail-context">
        <article><h2>Por que recebi este aviso?</h2><p>{data.context.why}</p></article>
        <article><h2>Próximo passo</h2><p>{data.context.nextStep}</p></article>
      </div>
      {!data.readAt && <button className="text-button hvm-notification-detail-retry-read" disabled={state.busy} onClick={async () => {
        if (await state.read(data.id)) setSnapshot({ actor, id, detail: { ...data, readAt: new Date().toISOString() } });
      }}>Marcar como lida</button>}
      {state.error && <p className="hvm-notification-error" role="alert">{state.error}</p>}
      <footer className="hvm-notification-detail-actions">
        {data.action && <button className="primary" onClick={() => onNavigate(data.action!.path)}>{data.action.label}<ArrowRight size={16} aria-hidden="true" /></button>}
        <button className="secondary" onClick={() => onNavigate(base)}>Voltar às notificações</button>
      </footer>
    </>}
  </section>;
}
