import { hasAdminPermission } from "../../shared/adminPermissions.ts";
import { AdminSectorCodeSchema, type AdminSectorCode } from "../../shared/contracts/adminGovernance.ts";
import {
  AdminDashboardResponseSchema,
  type AdminDashboardDepartment,
  type AdminDashboardMetric,
  type AdminDashboardResponse,
} from "../../shared/contracts/adminDashboard.ts";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import { dbPool } from "../db/pool.ts";

type MetricDefinition = Omit<AdminDashboardMetric, "value" | "attention"> & { attention?: boolean };
type DepartmentDefinition = Omit<AdminDashboardDepartment, "metrics"> & { sql: string; metrics: MetricDefinition[] };

// All SQL fragments and identifiers are server-owned. Unauthorized fragments are
// excluded before querying, so denied departments never contribute totals.
const departments: DepartmentDefinition[] = [
  {
    sector: "account_governance", title: "Contas e acessos",
    description: "Cadastros, aprovações e convites administrativos.", actionPath: "/admin/usuarios",
    sql: `(SELECT jsonb_build_object(
      'active_users',count(*) FILTER(WHERE public.effective_account_status(status,block_starts_at,block_ends_at)='active'),
      'blocked_users',count(*) FILTER(WHERE public.effective_account_status(status,block_starts_at,block_ends_at)='blocked'),
      'pending_registrations',(SELECT count(*) FROM public.app_registration_reviews WHERE status='pending'),
      'pending_invites',(SELECT count(*) FROM public.app_admin_invites i,actor a
        WHERE NOT i.is_accepted AND i.invalidated_at IS NULL AND i.expires_at>now()
          AND (a.is_super OR i.invited_by=a.user_id)
          AND NOT EXISTS(SELECT 1 FROM public.app_audit_events e
            WHERE e.action='admin.invite.archived' AND e.target_entity='app_admin_invites' AND e.target_id=i.id)))
      FROM public.app_users u
      WHERE EXISTS(SELECT 1 FROM public.app_people p WHERE p.user_id=u.id AND p.archived_at IS NULL)
        OR EXISTS(SELECT 1 FROM public.app_admin_principals ap JOIN public.app_people p ON p.id=ap.person_id
          WHERE ap.admin_user_id=u.id AND p.archived_at IS NULL))`,
    metrics: [
      { key: "active_users", label: "Contas ativas", unit: "count", note: "Contas com identidade cadastrada e sem bloqueio vigente; convites provisórios não entram", actionPath: "/admin/usuarios" },
      { key: "blocked_users", label: "Contas bloqueadas", unit: "count", note: "Bloqueios vigentes neste momento", actionPath: "/admin/usuarios" },
      { key: "pending_registrations", label: "Cadastros em análise", unit: "count", attention: true, actionPath: "/admin/usuarios" },
      { key: "pending_invites", label: "Convites pendentes", unit: "count", actionPath: "/admin/governanca" },
    ],
  },
  {
    sector: "document_verification", title: "Documentos e imóveis",
    description: "Homologação rural e acompanhamento da análise documental.", actionPath: "/admin/imoveis",
    sql: `(SELECT jsonb_build_object(
      'verified_properties',count(*) FILTER(WHERE status='verified'),
      'total_properties',count(*),
      'verification_queue',(SELECT count(*) FROM public.app_verification_requests WHERE superseded_at IS NULL AND status IN ('pending','claimed','in_review')),
      'documents_processing',(SELECT count(*) FROM public.app_document_jobs WHERE status='processing'),
      'document_failures',(SELECT count(*) FROM public.app_document_jobs WHERE status='failed'))
      FROM public.app_properties)`,
    metrics: [
      { key: "verified_properties", label: "Imóveis aprovados", unit: "count" },
      { key: "total_properties", label: "Imóveis cadastrados", unit: "count" },
      { key: "verification_queue", label: "Análises pendentes", unit: "count", attention: true, actionPath: "/admin/documentos/fila" },
      { key: "documents_processing", label: "Documentos em processamento", unit: "count" },
      { key: "document_failures", label: "Documentos com falha", unit: "count", attention: true },
    ],
  },
  {
    sector: "catalog_moderation", title: "Catálogo e lojas",
    description: "Publicação de produtos e organização das categorias.", actionPath: "/produtos",
    sql: `(SELECT jsonb_build_object(
      'published_products',count(*) FILTER(WHERE is_published),
      'draft_products',count(*) FILTER(WHERE NOT is_published),
      'active_categories',(SELECT count(*) FROM public.app_categories WHERE is_active),
      'active_stores',(SELECT count(*) FROM public.app_producer_stores WHERE status='active'))
      FROM public.app_products)`,
    metrics: [
      { key: "published_products", label: "Produtos publicados", unit: "count", note: "Publicados pelo produtor; a vitrine também aplica elegibilidade da loja", actionPath: "/produtos" },
      { key: "draft_products", label: "Produtos em rascunho", unit: "count" },
      { key: "active_categories", label: "Categorias ativas", unit: "count" },
      { key: "active_stores", label: "Lojas ativas", unit: "count" },
    ],
  },
  {
    sector: "location_management", title: "Localidades e cobertura",
    description: "Cobertura regional e restrições de acesso por localidade.", actionPath: "/admin/localidades",
    sql: `(SELECT jsonb_build_object(
      'active_municipalities',count(*) FILTER(WHERE is_active),
      'blocked_municipalities',count(*) FILTER(WHERE NOT is_active),
      'active_access_blocks',(SELECT count(*) FROM public.app_access_partial_blocks WHERE is_active))
      FROM public.app_municipalities)`,
    metrics: [
      { key: "active_municipalities", label: "Municípios ativos", unit: "count", actionPath: "/admin/localidades" },
      { key: "blocked_municipalities", label: "Municípios bloqueados", unit: "count", actionPath: "/admin/localidades" },
      { key: "active_access_blocks", label: "Restrições de acesso", unit: "count", actionPath: "/admin/bloqueios" },
    ],
  },
  {
    sector: "finance_ops", title: "Operações financeiras",
    description: "Valores confirmados e retenções registradas; sem executar cobranças ou repasses.", actionPath: "/admin/painel",
    sql: `(SELECT jsonb_build_object(
      'approved_payments',count(*) FILTER(WHERE status='approved'),
      'approved_amount',coalesce(sum(amount_cents::bigint) FILTER(WHERE status='approved'),0),
      'held_amount',(SELECT coalesce(sum((amount_cents-refunded_cents)::bigint),0) FROM public.app_financial_holds WHERE state IN ('held','disputed','refund_pending','partially_refunded')),
      'released_amount',(SELECT coalesce(sum((amount_cents-refunded_cents)::bigint),0) FROM public.app_financial_holds WHERE state='released'))
      FROM public.app_payment_intents)`,
    metrics: [
      { key: "approved_payments", label: "Pagamentos confirmados", unit: "count" },
      { key: "approved_amount", label: "Valor confirmado", unit: "currency_cents", note: "Intenções aprovadas, incluindo assinaturas; não representa saldo bancário" },
      { key: "held_amount", label: "Valores retidos", unit: "currency_cents", note: "Retenções comerciais ainda não liberadas, descontados estornos" },
      { key: "released_amount", label: "Valores liberados", unit: "currency_cents", note: "Liberação registrada no sistema; não confirma repasse bancário" },
    ],
  },
  {
    sector: "refund_management", title: "Reembolsos",
    description: "Solicitações, análise e confirmação de estornos.", actionPath: "/admin/reembolsos",
    sql: `(SELECT jsonb_build_object(
      'pending_refunds',count(*) FILTER(WHERE status IN ('requested','under_review')),
      'processing_refunds',count(*) FILTER(WHERE status IN ('approved','processing')),
      'confirmed_refunds',count(*) FILTER(WHERE status='refunded'),
      'requested_amount',coalesce(sum(requested_amount_cents::bigint) FILTER(WHERE status IN ('requested','under_review')),0))
      FROM public.app_refund_requests)`,
    metrics: [
      { key: "pending_refunds", label: "Solicitações em análise", unit: "count", attention: true },
      { key: "processing_refunds", label: "Estornos em andamento", unit: "count" },
      { key: "confirmed_refunds", label: "Reembolsos confirmados", unit: "count" },
      { key: "requested_amount", label: "Valor solicitado em análise", unit: "currency_cents", note: "Pedidos abertos; aprovação e estorno ainda não confirmados" },
    ],
  },
  {
    sector: "complaint_management", title: "Denúncias e avaliações",
    description: "Triagem de ocorrências e moderação da reputação das lojas.", actionPath: "/admin/denuncias",
    sql: `(SELECT jsonb_build_object(
      'open_complaints',count(*) FILTER(WHERE status IN ('submitted','under_review','awaiting_information')),
      'resolved_complaints',count(*) FILTER(WHERE status IN ('resolved','dismissed')),
      'visible_reviews',(SELECT count(*) FROM public.app_reviews WHERE NOT is_moderated),
      'moderated_reviews',(SELECT count(*) FROM public.app_reviews WHERE is_moderated))
      FROM public.app_complaints)`,
    metrics: [
      { key: "open_complaints", label: "Denúncias abertas", unit: "count", attention: true, actionPath: "/admin/denuncias" },
      { key: "resolved_complaints", label: "Denúncias concluídas", unit: "count", actionPath: "/admin/denuncias" },
      { key: "visible_reviews", label: "Avaliações não moderadas", unit: "count", actionPath: "/admin/avaliacoes" },
      { key: "moderated_reviews", label: "Avaliações moderadas", unit: "count", actionPath: "/admin/avaliacoes" },
    ],
  },
  {
    sector: "payment_configuration", title: "Pagamentos e assinaturas",
    description: "Situação das cobranças, planos e assinaturas recorrentes.", actionPath: "/admin/pagamentos",
    sql: `(SELECT jsonb_build_object(
      'pending_payments',count(*) FILTER(WHERE status='pending' AND expires_at>now()),
      'failed_payments',count(*) FILTER(WHERE status='failed'),
      'active_subscriptions',(SELECT count(*) FROM public.app_subscriptions WHERE status IN ('active','trialing')),
      'past_due_subscriptions',(SELECT count(*) FROM public.app_subscriptions WHERE status='past_due'),
      'active_plans',(SELECT count(*) FROM public.app_plans WHERE is_active))
      FROM public.app_payment_intents)`,
    metrics: [
      { key: "pending_payments", label: "Cobranças pendentes", unit: "count", note: "Somente cobranças ainda dentro do prazo" },
      { key: "failed_payments", label: "Pagamentos com falha", unit: "count", attention: true },
      { key: "active_subscriptions", label: "Assinaturas ativas e em teste", unit: "count", actionPath: "/admin/assinaturas" },
      { key: "past_due_subscriptions", label: "Assinaturas em atraso", unit: "count", attention: true, actionPath: "/admin/assinaturas" },
      { key: "active_plans", label: "Planos ativos", unit: "count", actionPath: "/admin/assinaturas" },
    ],
  },
  {
    sector: "platform_configuration", title: "Identidade e operação",
    description: "Configuração vigente e alterações auditadas da plataforma.", actionPath: "/admin/configuracao",
    sql: `(SELECT jsonb_build_object(
      'config_revision',coalesce((SELECT revision FROM public.app_global_config WHERE singleton_guard),0),
      'config_changes_24h',(SELECT count(*) FROM public.app_audit_events WHERE target_entity='app_global_config' AND occurred_at>=now()-interval '24 hours'),
      'active_kpis',(SELECT count(*) FROM public.app_kpi_definitions WHERE is_active)))`,
    metrics: [
      { key: "config_revision", label: "Revisão da configuração", unit: "revision", actionPath: "/admin/configuracao" },
      { key: "config_changes_24h", label: "Alterações de configuração em 24 h", unit: "count" },
      { key: "active_kpis", label: "Indicadores operacionais definidos", unit: "count" },
    ],
  },
];

export const AdminDashboardService = {
  async overview(actor: AdminActorContext): Promise<AdminDashboardResponse> {
    if (!dbPool) throw Object.assign(new Error("db_not_configured"), { code: "DB_NOT_CONFIGURED" });
    const allowed = departments.filter((department) => hasAdminPermission(actor, department.sector));
    const isSuper = actor.role === "platform_super_admin";
    const fullScope = isSuper && AdminSectorCodeSchema.options.every((sector) => hasAdminPermission(actor, sector));
    const fragments = allowed.map((department) => `${department.sql} AS ${department.sector}`);
    if (fullScope) fragments.push(`(SELECT count(*)::text FROM public.app_audit_events WHERE occurred_at>=now()-interval '24 hours') AS audit_events_24h`);
    // One statement supplies a consistent snapshot and consumes one pooled
    // connection, regardless of how many departments the actor can see.
    const result = await dbPool.query<Record<string, unknown>>(
      `WITH actor AS (SELECT $1::uuid AS user_id,$2::boolean AS is_super)
       SELECT clock_timestamp() AS generated_at${fragments.length ? "," + fragments.join(",") : ""}`,
      [actor.userId, isSuper],
    );
    const row = result.rows[0];
    if (!row) throw new Error("DASHBOARD_UNAVAILABLE");
    const visible = allowed.map((department): AdminDashboardDepartment => {
      const values = row[department.sector] as Record<string, number>;
      if (!values) throw new Error("DASHBOARD_INCOMPLETE");
      const metrics = department.metrics.map((metric): AdminDashboardMetric => ({
        ...metric, value: Number(values[metric.key]), attention: Boolean(metric.attention && Number(values[metric.key]) > 0),
      }));
      if (department.sector === "platform_configuration" && fullScope) metrics.push({
        key: "audit_events_24h", label: "Eventos de auditoria em 24 h", value: Number(row.audit_events_24h), unit: "count", attention: false,
        note: "Todas as áreas: visível somente com todos os poderes administrativos",
      });
      const actionPath = department.sector === "catalog_moderation" && isSuper ? "/admin/categorias" : department.actionPath;
      return { sector: department.sector, title: department.title, description: department.description, actionPath, metrics };
    });
    return AdminDashboardResponseSchema.parse({
      generatedAt: new Date(row.generated_at as Date).toISOString(), refreshAfterSeconds: 30,
      scope: { role: actor.role, sectors: allowed.map((department) => department.sector) }, departments: visible,
    });
  },
};
