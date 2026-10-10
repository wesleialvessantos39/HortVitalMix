import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
const provider = vi.hoisted(() => ({ enabled: false, refundCalls: 0 }));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_DEPARTMENTS_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const u = new URL(value);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55432" ||
    u.pathname !== "/postgres"
  )
    throw Error("DISPOSABLE_LOCAL_DATABASE_REQUIRED");
  const pg = (await import("pg")).default;
  return { dbPool: new pg.Pool({ connectionString: value, max: 8 }) };
});
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[]) => ({
          error: null,
          data: paths.map((p) => ({
            signedUrl: `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=local`,
          })),
        }),
      }),
    },
  },
}));
vi.mock("../../server/payments/gateway.ts", () => ({
  getPaymentGateway: () =>
    provider.enabled
      ? {
          provider: "departments_local_only",
          supportsPlatformRetention: true,
          createPayment: async (input: any) => ({
            reference: "local-" + input.intentId,
            pixCopyPaste: "LOCAL_ONLY",
            pixQrCodeBase64: null,
            hostedPaymentUrl: null,
          }),
          refund: async (input: any) => {
            provider.refundCalls++;
            return {
              reference: "local-refund-" + input.refundId,
              status: "refunded",
            };
          },
        }
      : null,
}));
import { dbPool } from "../../server/db/pool.ts";
import { commerceTransaction } from "../../server/services/CommerceSupport.ts";
import {
  checkoutCatalog,
  checkoutBuyer,
  checkoutAudit,
} from "../helpers/checkoutFixtures.ts";
import { AdminOperationsService } from "../../server/services/AdminOperationsService.ts";
import { DepartmentOperationsService as ops } from "../../server/services/DepartmentOperationsService.ts";
import { AdminDashboardService } from "../../server/services/AdminDashboardService.ts";
import { SubscriptionService as subscriptions } from "../../server/services/SubscriptionService.ts";
import { SubscriptionRefundService as refunds } from "../../server/services/SubscriptionRefundService.ts";
import { AdminSubscriptionService } from "../../server/services/AdminSubscriptionService.ts";
import {
  PaymentService,
  settleVerifiedPayment,
} from "../../server/services/PaymentService.ts";
import { VerificationQueueService } from "../../server/services/VerificationQueueService.ts";
import { ReviewService } from "../../server/services/ReviewService.ts";
import { CategoryService } from "../../server/services/CategoryService.ts";
import { businessQuery } from "../../server/security/businessQuery.ts";
import { AdminSectorCodeSchema } from "../../shared/contracts/adminGovernance.ts";
import { reviewFixtures } from "../helpers/reviewFixtures.ts";

describe.runIf(!!process.env.HVM_DEPARTMENTS_LOCAL_DATABASE_URL)(
  "Departamentos, cancelamentos e exclusão — PostgreSQL local real",
  () => {
    const pool = () => dbPool as Pool;
    let catalog: Awaited<ReturnType<typeof checkoutCatalog>>,
      admin: AdminActorContext;
    async function administrative(
      sectors: AdminActorContext["sectors"] = [],
      role: AdminActorContext["role"] = "platform_super_admin",
    ) {
      const p = await checkoutBuyer(pool(), []),
        id = randomUUID();
      await pool().query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
        [id, id + "@example.invalid"],
      );
      await pool().query("UPDATE app_users SET status='active' WHERE id=$1", [
        id,
      ]);
      await pool().query(
        "INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role,email_verified_at) VALUES($1,$2,$3,$4,now())",
        [id, p.personId, id + "@example.invalid", role],
      );
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
        [id, role],
      );
      for (const code of sectors)
        await pool().query(
          "INSERT INTO app_admin_sector_members(user_id,sector_code,assigned_by) VALUES($1,$2,$1)",
          [id, code],
        );
      return {
        userId: id,
        role,
        sectors,
        isSuperAdmin: role === "platform_super_admin",
        deniedSectors: [],
        sessionIssuedAt: new Date().toISOString(),
      } as AdminActorContext;
    }
    async function paidSubscription() {
      provider.enabled = true;
      const user = catalog.a.userId,
        plan = await subscriptions.savePlan(
          admin,
          null,
          {
            slug: "local-" + randomUUID(),
            name: "Plano local de produtor",
            targetAudience: "producer",
            deliveriesPerWeek: 0,
            priceCents: 3000,
            billingPeriod: "monthly",
            description:
              "Plano exclusivamente sintético para conferir cancelamento.",
            storeId: null,
            isActive: true,
          },
          randomUUID(),
          checkoutAudit(),
        );
      const subscription = await subscriptions.createSubscription(
        user,
        { planId: plan.id },
        randomUUID(),
        checkoutAudit(),
      );
      await pool().query(
        "UPDATE app_subscriptions SET status='active',current_period_start=clock_timestamp()-interval '1 month',current_period_end=clock_timestamp()-interval '1 second' WHERE id=$1",
        [subscription.id],
      );
      const billing = await subscriptions.runBillingCycle(
        subscription.id,
        user,
        {},
        randomUUID(),
        checkoutAudit(),
      );
      const payment = (
        await pool().query(
          "SELECT * FROM app_payment_intents WHERE billing_cycle_id=(SELECT id FROM app_billing_cycles WHERE subscription_id=$1 LIMIT 1)",
          [subscription.id],
        )
      ).rows[0];
      await PaymentService.acceptPolicy(user, payment.id, 1, checkoutAudit());
      await commerceTransaction((c) =>
        settleVerifiedPayment(
          c,
          {
            provider: "departments_local_only",
            eventId: randomUUID(),
            paymentReference: payment.gateway_reference,
            intentId: payment.id,
            status: "approved",
            amountCents: payment.amount_cents,
            currency: "BRL",
            method: "pix",
            paidAt: new Date().toISOString(),
          },
          checkoutAudit(),
        ),
      );
      provider.enabled = false;
      return {
        subscription: (await subscriptions.mine(user)).subscriptions.find(
          (s) => s.id === subscription.id,
        )!,
        payment,
        plan,
        billing,
        user,
      };
    }
    beforeAll(async () => {
      catalog = await checkoutCatalog(pool());
      admin = await administrative();
    }, 30000);
    afterAll(async () => {
      await dbPool?.end();
    });
    it("tem doze departamentos com consultas reais e sem depender de gateway", async () => {
      expect(AdminSectorCodeSchema.options).toHaveLength(12);
      const dashboard = await AdminDashboardService.overview(admin);
      expect(dashboard.departments).toHaveLength(12);
      expect(dashboard.departments.map((d) => d.sector)).toEqual(
        expect.arrayContaining([
          "subscription_management",
          "review_management",
          "refund_policy",
        ]),
      );
      for (const view of [
        "pos",
        "subscriptions",
        "refunds",
        "payments",
        "orders",
      ] as const) {
        const data = await ops.financeRegisters(admin, { view });
        expect(data.gatewayAvailable).toBe(false);
        expect(data.rows).toBeInstanceOf(Array);
      }
    });
    it("remove apenas metadados internos da Vercel e mantém filtros estritos", async () => {
      const query = businessQuery({
        query: {
          path: "v1/admin/operations",
          __hvm_path: "v1/admin/operations",
          view: "products",
          search: "Cenoura",
        },
      } as any);
      expect(query).toEqual({ view: "products", search: "Cenoura" });
      const view = await AdminOperationsService.catalog(admin, query);
      expect(view).toBeDefined();
      await expect(
        AdminOperationsService.catalog(admin, {
          ...query,
          arbitrary: "ignored?",
        }),
      ).rejects.toThrow();
    });
    it("nega setor revogado mesmo com contexto de sessão antigo", async () => {
      const limited = await administrative(["finance_ops"], "platform_admin");
      expect((await ops.financeRegisters(limited, { view: "pos" })).view).toBe(
        "pos",
      );
      await pool().query(
        "INSERT INTO app_admin_permission_overrides(user_id,sector_code,allowed,changed_by) VALUES($1,'finance_ops',false,$1)",
        [limited.userId],
      );
      await expect(
        ops.financeRegisters(limited, { view: "pos" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(refunds.adminPolicy(limited)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
    it("oculta e libera catálogo sem publicar por conta do produtor", async () => {
      const id = catalog.pa,
        row = (
          await pool().query("SELECT * FROM app_products WHERE id=$1", [id])
        ).rows[0],
        command = randomUUID();
      const input = {
        targetType: "product",
        targetId: id,
        expectedRevision: row.revision,
        action: "hide",
        reason: "Produto em análise local por divergência de cadastro.",
      };
      const v = await ops.moderateCatalog(
        admin,
        input,
        command,
        checkoutAudit(),
      );
      expect(
        await ops.moderateCatalog(admin, input, command, checkoutAudit()),
      ).toEqual(v);
      expect(
        (
          await pool().query(
            "SELECT admin_hidden,is_published FROM app_products WHERE id=$1",
            [id],
          )
        ).rows[0],
      ).toEqual({ admin_hidden: true, is_published: false });
      await expect(
        pool().query("UPDATE app_products SET is_published=true WHERE id=$1", [
          id,
        ]),
      ).rejects.toThrow("PRODUCT_ADMIN_HOLD");
      await ops.moderateCatalog(
        admin,
        {
          ...input,
          expectedRevision: v.revision,
          action: "release",
          reason: "Dados conferidos; proprietário poderá republicar.",
        },
        randomUUID(),
        checkoutAudit(),
      );
      expect(
        (
          await pool().query(
            "SELECT admin_hidden,is_published FROM app_products WHERE id=$1",
            [id],
          )
        ).rows[0],
      ).toEqual({ admin_hidden: false, is_published: false });
      expect(
        (await ops.catalogHistory(admin, id, "product")).history,
      ).toHaveLength(2);
      await expect(
        pool().query(
          "UPDATE app_catalog_moderation_history SET reason='Alteração indevida' WHERE target_id=$1",
          [id],
        ),
      ).rejects.toThrow();
      await pool().query(
        "UPDATE app_products SET is_published=true WHERE id=$1",
        [id],
      );
    });
    it("ocultação de loja muda sua elegibilidade pública", async () => {
      const s = (
        await pool().query(
          "SELECT revision FROM app_producer_stores WHERE id=$1",
          [catalog.b.store.id],
        )
      ).rows[0];
      const v = await ops.moderateCatalog(
        admin,
        {
          targetType: "store",
          targetId: catalog.b.store.id,
          expectedRevision: s.revision,
          action: "hide",
          reason: "Conferência local da apresentação da loja.",
        },
        randomUUID(),
        checkoutAudit(),
      );
      expect(
        (
          await pool().query(
            "SELECT hvm_store_private.store_is_visible($1) visible",
            [catalog.b.store.id],
          )
        ).rows[0].visible,
      ).toBe(false);
      await ops.moderateCatalog(
        admin,
        {
          targetType: "store",
          targetId: catalog.b.store.id,
          expectedRevision: v.revision,
          action: "release",
          reason: "Loja conferida e liberada para apresentação.",
        },
        randomUUID(),
        checkoutAudit(),
      );
      expect(
        (
          await pool().query(
            "SELECT hvm_store_private.store_is_visible($1) visible",
            [catalog.b.store.id],
          )
        ).rows[0].visible,
      ).toBe(true);
    });
    it("conferência financeira registra resolução sem alterar o lançamento original", async () => {
      const v = await paidSubscription();
      const before = (
        await pool().query("SELECT * FROM app_payment_intents WHERE id=$1", [
          v.payment.id,
        ])
      ).rows[0];
      const input = {
          targetType: "payments",
          targetId: v.payment.id,
          expectedRevision: 0,
          status: "resolved",
          note: "Pagamento local conferido, sem alteração monetária.",
        },
        key = randomUUID();
      expect(
        await ops.financeCase(admin, input, key, checkoutAudit()),
      ).toMatchObject({ revision: 1 });
      expect(
        await ops.financeCase(admin, input, key, checkoutAudit()),
      ).toMatchObject({ revision: 1 });
      expect(
        (
          await pool().query("SELECT * FROM app_payment_intents WHERE id=$1", [
            v.payment.id,
          ])
        ).rows[0],
      ).toEqual(before);
      const data = await ops.financeRegisters(admin, {
        view: "payments",
        search: v.payment.id,
      });
      expect(data.rows[0].case).toMatchObject({
        status: "resolved",
        revision: 1,
      });
    });
    it("administrador de Catálogo gerencia categorias sem ganhar outro departamento", async () => {
      const actor = await administrative(
        ["catalog_moderation"],
        "platform_admin",
      );
      const value = await CategoryService.createCategory(
        {
          name: "Categoria da gestão local",
          slug: "department-" + randomUUID(),
          iconName: "leaf",
          description: null,
          parentId: null,
          displayOrder: 50,
          commandId: randomUUID(),
        },
        actor,
        checkoutAudit(),
      );
      expect(value.name).toBe("Categoria da gestão local");
      await expect(
        ops.financeRegisters(actor, { view: "pos" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("avaliações filtram, ocultam e restauram com histórico e preservação da nota original", async () => {
      const f = await reviewFixtures(pool()),
        p = await f.delivered(),
        actor = await administrative(["review_management"], "platform_admin");
      const review = await ReviewService.createReview(
        p.b.userId,
        {
          orderId: p.id,
          rating: 4,
          comment: "Boa entrega local para moderação e restauração.",
        },
        randomUUID(),
        checkoutAudit(),
      );
      const list = await ReviewService.adminList(actor, {
        rating: 4,
        search: "Boa entrega local",
      });
      expect(list.reviews.some((r) => r.id === review.id)).toBe(true);
      await ReviewService.moderateReview(
        review.id,
        actor,
        {
          action: "hide",
          expectedRevision: 1,
          reason: "Conteúdo em conferência justificada no teste local.",
        },
        randomUUID(),
        checkoutAudit(),
      );
      await expect(
        pool().query("UPDATE app_reviews SET rating=1 WHERE id=$1", [
          review.id,
        ]),
      ).rejects.toThrow("REVIEW_IMMUTABLE");
      await expect(
        pool().query(
          "UPDATE app_reviews SET is_moderated=false,moderation_reason=NULL,moderated_by=NULL,moderated_at=NULL WHERE id=$1",
          [review.id],
        ),
      ).rejects.toThrow("REVIEW_MODERATION_HISTORY_REQUIRED");
      await ReviewService.moderateReview(
        review.id,
        actor,
        {
          action: "restore",
          expectedRevision: 2,
          reason: "Conferência encerrada; avaliação original liberada.",
        },
        randomUUID(),
        checkoutAudit(),
      );
      const restored = (
        await ReviewService.adminList(actor, { search: "Boa entrega local" })
      ).reviews.find((r) => r.id === review.id)!;
      expect(restored.rating).toBe(4);
      expect(restored.isModerated).toBe(false);
      expect(restored.history.map((h) => h.action)).toEqual([
        "restore",
        "hide",
      ]);
      await expect(
        pool().query(
          "UPDATE app_review_moderation_history SET reason='Apagando o histórico' WHERE review_id=$1",
          [review.id],
        ),
      ).rejects.toThrow("REVIEW_HISTORY_IMMUTABLE");
      const queue = await refunds.adminPolicy(admin);
      expect(queue.policy.version).toBeGreaterThan(0);
      await commerceTransaction((c) =>
        c.query("SELECT erase_public_account($1,'consumer',$2)", [
          p.b.userId,
          randomUUID(),
        ]),
      );
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_reviews WHERE id=$1",
            [review.id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT customer_user_id,address_snapshot,account_deleted FROM app_orders WHERE id=$1",
            [p.id],
          )
        ).rows[0],
      ).toEqual({
        customer_user_id: null,
        address_snapshot: null,
        account_deleted: true,
      });
    });
    it("cancelamento elegível é idempotente, abre caso, não estorna sem provedor", async () => {
      const v = await paidSubscription(),
        quote = await refunds.cancellationQuote(v.user, v.subscription.id);
      expect(quote.eligibleAmountCents).toBe(3000);
      expect(quote.gatewayAvailable).toBe(false);
      const key = randomUUID(),
        body = { expectedRevision: v.subscription.revision };
      const canceled = await subscriptions.changeSubscription(
        v.user,
        v.subscription.id,
        "cancel",
        body,
        key,
        checkoutAudit(),
      );
      expect(canceled.status).toBe("cancelled");
      expect(
        await subscriptions.changeSubscription(
          v.user,
          v.subscription.id,
          "cancel",
          body,
          key,
          checkoutAudit(),
        ),
      ).toEqual(canceled);
      const request = (
        await refunds.list(v.user, { status: "all" })
      ).refunds.find((r) => r.subscriptionId === v.subscription.id)!;
      expect(request.status).toBe("requested");
      const approved = await refunds.decide(
        admin,
        request.id,
        {
          expectedRevision: request.revision,
          decision: "approved",
          amountCents: 3000,
          note: "Devolução local aprovada dentro do prazo contratado.",
        },
        randomUUID(),
        checkoutAudit(),
      );
      expect(approved.status).toBe("approved");
      await expect(
        refunds.process(admin, request.id, checkoutAudit()),
      ).rejects.toMatchObject({ code: "GATEWAY_NOT_CONFIGURED" });
      expect(
        (
          await pool().query(
            "SELECT status FROM app_payment_intents WHERE id=$1",
            [v.payment.id],
          )
        ).rows[0].status,
      ).toBe("approved");
      provider.enabled = true;
      expect(
        (await refunds.process(admin, request.id, checkoutAudit())).status,
      ).toBe("refunded");
      const calls = provider.refundCalls;
      await refunds.process(admin, request.id, checkoutAudit());
      expect(provider.refundCalls).toBe(calls);
      expect(
        (
          await pool().query(
            "SELECT status FROM app_payment_intents WHERE id=$1",
            [v.payment.id],
          )
        ).rows[0].status,
      ).toBe("refunded");
      provider.enabled = false;
    });
    it("contratos congelam a política e mudanças não reescrevem a anterior", async () => {
      const baseline = (await refunds.adminPolicy(admin)).policy;
      const { version: baseVersion, ...basePolicy } = baseline;
      await refunds.savePolicy(
        admin,
        {
          expectedVersion: baseVersion,
          policy: { ...basePolicy, withdrawalDays: 7, prorateUnused: false },
        },
        randomUUID(),
        checkoutAudit(),
      );
      const v = await paidSubscription(),
        old = await refunds.cancellationQuote(v.user, v.subscription.id),
        current = await refunds.adminPolicy(admin);
      const { version, ...policy } = current.policy;
      await refunds.savePolicy(
        admin,
        {
          expectedVersion: version,
          policy: {
            ...policy,
            withdrawalDays: 14,
            prorateUnused: true,
            additionalTerms:
              "Política comercial local adicional sem limitar direitos legais.",
          },
        },
        randomUUID(),
        checkoutAudit(),
      );
      expect(
        (await refunds.cancellationQuote(v.user, v.subscription.id)).policy,
      ).toEqual(old.policy);
      await expect(
        pool().query(
          "UPDATE app_subscription_refund_policies SET policy=policy WHERE version=1",
        ),
      ).rejects.toThrow();
      await pool().query(
        "UPDATE app_subscriptions SET created_at=clock_timestamp()-interval '15 days' WHERE id=$1",
        [v.subscription.id],
      );
      expect(
        (await refunds.cancellationQuote(v.user, v.subscription.id))
          .eligibility,
      ).toBe("analysis_required");
      const request = await refunds.request(
        v.user,
        {
          subscriptionId: v.subscription.id,
          note: "Problema local do serviço para análise além do arrependimento.",
        },
        randomUUID(),
        checkoutAudit(),
      );
      expect(request.status).toBe("requested");
    });
    it("gestão administrativa cancela e registra o ator real sem aprovar reembolso", async () => {
      const actor = await administrative(
          ["subscription_management"],
          "platform_admin",
        ),
        v = await paidSubscription();
      expect(
        (
          await AdminSubscriptionService.list(actor, {
            search: v.subscription.id,
          })
        ).total,
      ).toBe(1);
      await AdminSubscriptionService.cancel(
        actor,
        v.subscription.id,
        {
          expectedRevision: v.subscription.revision,
          note: "Pedido de encerramento conferido no teste administrativo.",
        },
        randomUUID(),
        checkoutAudit(),
      );
      expect(
        (
          await pool().query(
            "SELECT actor_id FROM app_audit_events WHERE action='subscription.admin_cancel' AND target_id=$1 ORDER BY occurred_at DESC LIMIT 1",
            [v.subscription.id],
          )
        ).rows[0].actor_id,
      ).toBe(actor.userId);
      await expect(refunds.list(actor.userId, {}, actor)).rejects.toMatchObject(
        { code: "FORBIDDEN" },
      );
    });
    it("exclusão do consumidor apaga identidade e endereço, não contas de terceiros", async () => {
      const b = await checkoutBuyer(pool(), []),
        other = await checkoutBuyer(pool(), []),
        key = randomUUID();
      await pool().query(
        "INSERT INTO app_consent_records(person_id,consent_type,is_granted,policy_version,ip_hash,user_agent) VALUES($1,'privacy_policy',true,'local-v1',$2,'local test')",
        [b.personId, "a".repeat(64)],
      );
      await expect(
        pool().query("DELETE FROM app_consent_records WHERE person_id=$1", [
          b.personId,
        ]),
      ).rejects.toThrow("VIOLACAO_DE_AUDITORIA");
      await commerceTransaction((c) =>
        c.query("SELECT erase_public_account($1,'consumer',$2)", [
          b.userId,
          key,
        ]),
      );
      for (const table of ["auth.users", "public.app_users"]) {
        expect(
          (
            await pool().query(
              `SELECT count(*)::int n FROM ${table} WHERE id=$1`,
              [b.userId],
            )
          ).rows[0].n,
        ).toBe(0);
      }
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_people WHERE user_id=$1",
            [b.userId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM auth.users WHERE id=$1",
            [other.userId],
          )
        ).rows[0].n,
      ).toBe(1);
      await commerceTransaction((c) =>
        c.query("SELECT erase_public_account($1,'consumer',$2)", [
          b.userId,
          key,
        ]),
      );
      expect(
        (
          await pool().query(
            "SELECT status FROM app_account_erasure_receipts WHERE command_id=$1",
            [key],
          )
        ).rows[0].status,
      ).toBe("completed");
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_consent_records WHERE person_id=$1",
            [b.personId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("exclui evidências e enfileira os arquivos pessoais sem permitir apagar evidências de terceiros", async () => {
      const f = await checkoutCatalog(pool()),
        document = randomUUID(),
        extraction = randomUUID(),
        path = "properties/" + f.a.propertyId + "/" + document + ".pdf";
      await pool().query(
        "INSERT INTO app_documents(id,property_id,producer_id,document_type,file_name,file_size_bytes,mime_type,storage_path,file_hash_sha256,status,uploaded_by,upload_command_id) VALUES($1,$2,$3,'car_sicar','local.pdf',2048,'application/pdf',$4,$5,'clean',$6,$7)",
        [
          document,
          f.a.propertyId,
          f.a.profileId,
          path,
          "a".repeat(64),
          f.a.userId,
          randomUUID(),
        ],
      );
      await pool().query(
        "INSERT INTO app_document_extractions(id,document_id,property_id,producer_id,extraction_engine,payload_jsonb,confidence_score,raw_text,status,file_hash_sha256) VALUES($1,$2,$3,$4,'local','{}',0.5,'Somente dado sintético local','completed',$5)",
        [extraction, document, f.a.propertyId, f.a.profileId, "a".repeat(64)],
      );
      await expect(
        pool().query("DELETE FROM app_document_extractions WHERE id=$1", [
          extraction,
        ]),
      ).rejects.toThrow("DOCUMENT_EVIDENCE_IMMUTABLE");
      await commerceTransaction((c) =>
        c.query("SELECT erase_public_account($1,'producer',$2)", [
          f.a.userId,
          randomUUID(),
        ]),
      );
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_document_extractions WHERE id=$1",
            [extraction],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_documents WHERE id=$1",
            [document],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT reason FROM app_storage_deletion_queue WHERE object_path=$1",
            [path],
          )
        ).rows[0].reason,
      ).toBe("property_deleted");
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_properties WHERE id=$1",
            [f.b.propertyId],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("produtor excluído perde identidade e aprovações; financeiro mínimo e arquivo isolado permanecem", async () => {
      const v = await paidSubscription(),
        key = randomUUID();
      await commerceTransaction((c) =>
        c.query("SELECT erase_public_account($1,'producer',$2)", [v.user, key]),
      );
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM auth.users WHERE id=$1",
            [v.user],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT user_id,account_deleted,quote_id FROM app_payment_intents WHERE id=$1",
            [v.payment.id],
          )
        ).rows[0],
      ).toEqual({ user_id: null, account_deleted: true, quote_id: null });
      expect(
        (
          await pool().query(
            "SELECT user_id,person_id,status,delivery_address_snapshot FROM app_subscriptions WHERE id=$1",
            [v.subscription.id],
          )
        ).rows[0],
      ).toEqual({
        user_id: null,
        person_id: null,
        status: "cancelled",
        delivery_address_snapshot: null,
      });
      const archive = (
        await pool().query(
          "SELECT * FROM app_property_deletion_archive WHERE property_id=$1",
          [catalog.a.propertyId],
        )
      ).rows[0];
      expect(archive.account_deleted).toBe(true);
      expect(archive.snapshot.accountDeleted).toBe(true);
      expect(archive.snapshot.documents).toBeUndefined();
      expect(archive.evidence_ids).toEqual([]);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_erasure_evidence_ids WHERE command_id=$1",
            [key],
          )
        ).rows[0].n,
      ).toBe(0);
      await expect(
        pool().query(
          "UPDATE app_property_deletion_archive SET account_deleted=false WHERE property_id=$1",
          [catalog.a.propertyId],
        ),
      ).rejects.toThrow();
      await expect(
        pool().query(
          "DELETE FROM app_property_deletion_archive WHERE property_id=$1",
          [catalog.a.propertyId],
        ),
      ).rejects.toThrow();
      await commerceTransaction((c) =>
        c.query("SELECT delete_deleted_account_archive($1,$2,$3)", [
          catalog.a.propertyId,
          admin.userId,
          randomUUID(),
        ]),
      );
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_property_deletion_archive WHERE property_id=$1",
            [catalog.a.propertyId],
          )
        ).rows[0].n,
      ).toBe(0);
      await expect(subscriptions.mine(v.user)).rejects.toThrow();
    });
    it("clientes diretos não podem apagar contas ou acessar registros privados", async () => {
      const c = await pool().connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE authenticated");
        await expect(
          c.query("SELECT * FROM app_subscription_refunds"),
        ).rejects.toThrow();
        await c.query("ROLLBACK");
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE authenticated");
        await expect(
          c.query("SELECT erase_public_account($1,'consumer',$2)", [
            randomUUID(),
            randomUUID(),
          ]),
        ).rejects.toThrow();
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
    });
  },
);
