import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_NOTIFICATIONS_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const u = new URL(value);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55432" ||
    u.pathname !== "/postgres"
  )
    throw Error("NOTIFICATIONS_LOCAL_DATABASE_REQUIRED");
  const pg = (await import("pg")).default;
  return { dbPool: new pg.Pool({ connectionString: value, max: 8 }) };
});
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[]) => ({
          error: null,
          data: paths.map((path) => ({
            signedUrl: `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=local`,
          })),
        }),
      }),
    },
  },
}));
import { dbPool } from "../../server/db/pool.ts";
import { reviewFixtures } from "../helpers/reviewFixtures.ts";
import { checkoutAudit } from "../helpers/checkoutFixtures.ts";
import {
  NotificationService as notices,
  type NotificationActor,
} from "../../server/services/NotificationService.ts";
import { ProducerSalesService as sales } from "../../server/services/ProducerSalesService.ts";
import { AfterSalesService as support } from "../../server/services/AfterSalesService.ts";
import { CartService } from "../../server/services/CartService.ts";
import { CheckoutService } from "../../server/services/CheckoutService.ts";
import { CommerceService } from "../../server/services/CommerceService.ts";
import { ReviewService } from "../../server/services/ReviewService.ts";
import { OrderService } from "../../server/services/OrderService.ts";
import { SubscriptionService } from "../../server/services/SubscriptionService.ts";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
const own = (
  userId: string,
  role: "consumer" | "producer",
): NotificationActor => ({ userId, role });
const administrative = (admin: AdminActorContext): NotificationActor => ({
  userId: admin.userId,
  role: admin.role,
  admin,
});
describe.runIf(!!process.env.HVM_NOTIFICATIONS_LOCAL_DATABASE_URL)(
  "Papéis, vendas, atendimento privado e notificações transacionais",
  () => {
    let f: Awaited<ReturnType<typeof reviewFixtures>>,
      root: AdminActorContext,
      refundAdmin: AdminActorContext,
      complaintAdmin: AdminActorContext;
    const p = () => dbPool as Pool;
    beforeAll(async () => {
      f = await reviewFixtures(p());
      root = await f.admin();
      refundAdmin = await f.admin("platform_admin", false);
      complaintAdmin = await f.admin("platform_admin", true);
      await p().query(
        "INSERT INTO app_admin_sector_members(user_id,sector_code) VALUES($1,'refund_management')",
        [refundAdmin.userId],
      );
      refundAdmin.sectors = ["refund_management"];
    });
    afterAll(async () => {
      try {
        if (f) await f.cleanup();
      } finally {
        await dbPool?.end();
      }
    });
    it("produtor sem cadastro consumer não recebe cesta, checkout, compras ou avaliações", async () => {
      const uid = f.catalog.a.userId;
      await expect(
        CartService.getCartGroupedByStore({
          sessionId: randomUUID(),
          userId: uid,
        }),
      ).rejects.toMatchObject({ code: "CART_OWNER_REQUIRED", status: 403 });
      await expect(
        CheckoutService.getContext(uid, randomUUID()),
      ).rejects.toMatchObject({ status: 403 });
      await expect(CommerceService.purchases(uid)).rejects.toMatchObject({
        code: "CONSUMER_REQUIRED",
      });
      await expect(
        OrderService.list(uid, "customer", {}),
      ).rejects.toMatchObject({ code: "CONSUMER_REQUIRED" });
      await expect(
        ReviewService.eligibility(uid, randomUUID()),
      ).rejects.toMatchObject({ code: "CONSUMER_REQUIRED" });
    });
    it("contador usa opções e preserva quantidade e subtotal", async () => {
      const b = await f.buyer([]),
        scope = { sessionId: b.sessionId, userId: b.userId };
      const first = await CartService.addItem(
        scope,
        { productId: f.catalog.pa, quantity: 1, commandId: randomUUID() },
        checkoutAudit(),
      );
      const more = await CartService.addItem(
        scope,
        { productId: f.catalog.pa, quantity: 7, commandId: randomUUID() },
        checkoutAudit(),
      );
      expect(first.itemCount).toBe(1);
      expect(more.itemCount).toBe(1);
      expect(more.stores[0].items[0].quantity).toBe(8);
      expect(more.subtotalCents).toBe(5600);
      const second = await CartService.addItem(
        scope,
        { productId: f.catalog.pb, quantity: 3, commandId: randomUUID() },
        checkoutAudit(),
      );
      expect(second.itemCount).toBe(2);
      expect(second.subtotalCents).toBe(8300);
      const updated = await CartService.updateItem(
        scope,
        more.stores[0].items[0].id,
        { quantity: 2, commandId: randomUUID() },
        checkoutAudit(),
      );
      expect(updated.itemCount).toBe(2);
      expect(updated.subtotalCents).toBe(4100);
    });
    it("venda paga gera avisos diferentes ao comprador e produtor, isolados da outra loja", async () => {
      const paid = await f.paid(),
        customer = await notices.list(own(paid.b.userId, "consumer"), {
          category: "purchases",
        }),
        producer = await notices.list(own(f.catalog.a.userId, "producer"), {
          category: "sales",
        });
      expect(
        customer.notifications.some(
          (n) => n.title === "Compra confirmada" && n.actionPath === "/compras",
        ),
      ).toBe(true);
      expect(
        producer.notifications.some(
          (n) =>
            n.title === "Nova venda confirmada" &&
            n.actionPath.includes(paid.id),
        ),
      ).toBe(true);
      expect(
        (
          await notices.list(own(f.catalog.b.userId, "producer"), {
            category: "sales",
          })
        ).notifications.some((n) => n.actionPath.includes(paid.id)),
      ).toBe(false);
      const ownSales = await sales.sales(f.catalog.a.userId, {
        orderId: paid.id,
      });
      expect(ownSales.sales).toHaveLength(1);
      expect(ownSales.sales[0].id).toBe(paid.id);
      expect(ownSales.summary.grossCents).toBeGreaterThan(0);
      expect(
        (await sales.sales(f.catalog.b.userId, { orderId: paid.id })).sales,
      ).toHaveLength(0);
      await expect(sales.sales(paid.b.userId, {})).rejects.toMatchObject({
        code: "PRODUCER_REQUIRED",
      });
    });
    it("mudança logística e prova de entrega notificam e convidam para avaliação", async () => {
      const paid = await f.delivered();
      const feed = await notices.list(own(paid.b.userId, "consumer"), {});
      expect(
        feed.notifications.some((n) => n.title === "Pedido saiu para entrega"),
      ).toBe(true);
      expect(
        feed.notifications.some((n) => n.title === "Pedido entregue"),
      ).toBe(true);
      expect(
        feed.notifications.some((n) => n.title === "Avalie sua compra"),
      ).toBe(true);
      expect(
        feed.notifications.some((n) => n.title === "Entrega agendada"),
      ).toBe(true);
      await ReviewService.createReview(
        paid.b.userId,
        {
          orderId: paid.id,
          rating: 5,
          comment: "Avaliação real no banco de testes.",
        },
        randomUUID(),
        checkoutAudit(),
      );
      expect(
        (
          await notices.list(own(f.catalog.a.userId, "producer"), {
            category: "reviews",
          })
        ).notifications.some((n) => n.actionPath.includes(paid.id)),
      ).toBe(true);
      expect(
        (
          await notices.list(administrative(complaintAdmin), {
            category: "reviews",
          })
        ).notifications.some((n) => n.title === "Nova avaliação de compra"),
      ).toBe(true);
      expect(
        (
          await notices.list(administrative(refundAdmin), {
            category: "reviews",
          })
        ).notifications,
      ).toHaveLength(0);
    });
    it("reembolso notifica quatro papéis, respeitando o setor", async () => {
      const paid = await f.paid(),
        r = await support.requestRefund(
          paid.b.userId,
          {
            commandId: randomUUID(),
            orderId: paid.id,
            reason: "quality",
            description:
              "Detalhe confidencial do consumidor que não aparece ao vendedor.",
            requestedAmountCents: 100,
          },
          checkoutAudit(),
        );
      for (const a of [
        own(paid.b.userId, "consumer"),
        own(f.catalog.a.userId, "producer"),
        administrative(refundAdmin),
        administrative(root),
      ])
        expect(
          (await notices.list(a, { category: "refunds" })).notifications.some(
            (n) => n.actionPath.includes(r.id),
          ),
        ).toBe(true);
      expect(
        (
          await notices.list(administrative(complaintAdmin), {
            category: "refunds",
          })
        ).notifications.some((n) => n.actionPath.includes(r.id)),
      ).toBe(false);
      const producer = await sales.refunds(f.catalog.a.userId, {}, r.id);
      expect(JSON.stringify(producer)).not.toContain("confidencial");
      expect(producer).not.toHaveProperty("description");
      expect(producer).not.toHaveProperty("messages");
      expect(producer).not.toHaveProperty("evidence");
      await expect(
        sales.refunds(f.catalog.b.userId, {}, r.id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        support.detail(f.catalog.a.userId, "refund", r.id),
      ).rejects.toMatchObject({ code: "CONSUMER_REQUIRED" });
    });
    it("contato com vendedor é iniciado apenas por admin autorizado e não revela conversa ou motivo privado", async () => {
      const paid = await f.paid(),
        r = await support.requestRefund(
          paid.b.userId,
          {
            commandId: randomUUID(),
            orderId: paid.id,
            reason: "other",
            description:
              "Relato privado do consumidor nesta solicitação de teste.",
            requestedAmountCents: 100,
          },
          checkoutAudit(),
        );
      await support.message(
        paid.b.userId,
        "refund",
        r.id,
        {
          commandId: randomUUID(),
          message: "Mensagem privada somente para o administrador.",
        },
        checkoutAudit(),
      );
      const command = {
        commandId: randomUUID(),
        message: "Vendedor: por favor consulte as condições deste lote.",
      };
      await expect(
        support.contactSeller(complaintAdmin, r.id, command, checkoutAudit()),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await support.contactSeller(refundAdmin, r.id, command, checkoutAudit());
      await support.contactSeller(refundAdmin, r.id, command, checkoutAudit());
      await support.decideRefund(
        refundAdmin,
        r.id,
        {
          commandId: randomUUID(),
          expectedRevision: 1,
          decision: "review",
          notes:
            "Nota confidencial da administração para o atendimento do consumidor.",
        },
        checkoutAudit(),
      );
      const seller = await sales.refunds(f.catalog.a.userId, {}, r.id);
      expect("contacts" in seller && seller.contacts).toHaveLength(1);
      expect(JSON.stringify(seller)).toContain("condições deste lote");
      expect(JSON.stringify(seller)).not.toContain("confidencial");
      expect(JSON.stringify(seller)).not.toContain("Mensagem privada");
      const consumer = await support.detail(paid.b.userId, "refund", r.id);
      expect(consumer.sellerContacts).toBeUndefined();
      const admin = await support.detail(
        refundAdmin.userId,
        "refund",
        r.id,
        refundAdmin,
      );
      expect(admin.sellerContacts).toHaveLength(1);
      const feed = await notices.list(own(f.catalog.a.userId, "producer"), {
        category: "refunds",
      });
      expect(
        feed.notifications.filter(
          (n) =>
            n.title === "Contato da administração" &&
            n.actionPath.includes(r.id),
        ),
      ).toHaveLength(1);
    });
    it("denúncias preservam anonimato perante o denunciado e notificam denunciante e setor autorizado", async () => {
      const b = await f.buyer([]),
        r = await support.createComplaint(
          b.userId,
          {
            commandId: randomUUID(),
            targetType: "store",
            targetId: f.catalog.b.store.id,
            orderId: null,
            reason: "other",
            description: "Relato privado de denúncia usado no banco local.",
          },
          checkoutAudit(),
          "consumer",
        );
      for (const a of [
        own(b.userId, "consumer"),
        administrative(complaintAdmin),
        administrative(root),
      ])
        expect(
          (
            await notices.list(a, { category: "complaints" })
          ).notifications.some((n) => n.actionPath.includes(r.id)),
        ).toBe(true);
      expect(
        (
          await notices.list(own(f.catalog.b.userId, "producer"), {
            category: "complaints",
          })
        ).notifications.some((n) => n.actionPath.includes(r.id)),
      ).toBe(false);
      expect(
        (
          await notices.list(administrative(refundAdmin), {
            category: "complaints",
          })
        ).notifications.some((n) => n.actionPath.includes(r.id)),
      ).toBe(false);
    });
    it("leitura é idempotente, marca apenas do papel atual e não admite outro titular", async () => {
      const b = await f.buyer([]),
        a = own(b.userId, "consumer"),
        before = await notices.list(a, {}),
        id = before.notifications[0].id;
      await expect(
        notices.read(own(f.catalog.a.userId, "producer"), id),
      ).rejects.toMatchObject({ status: 404 });
      await notices.read(a, id);
      const readAt = (
        await p().query("SELECT read_at FROM app_notifications WHERE id=$1", [
          id,
        ])
      ).rows[0].read_at;
      await notices.read(a, id);
      expect(
        (
          await p().query("SELECT read_at FROM app_notifications WHERE id=$1", [
            id,
          ])
        ).rows[0].read_at,
      ).toEqual(readAt);
      expect(
        (await notices.list(a, { filter: "unread" })).notifications.some(
          (n) => n.id === id,
        ),
      ).toBe(false);
    });
    it("marcar todas respeita o instante observado e mantém novos avisos não lidos", async () => {
      const b = await f.buyer([]),
        a = own(b.userId, "consumer"),
        feed = await notices.list(a, {});
      await p().query(
        "SELECT hvm_notifications_private.emit($1,'consumer',$2,'account','Aviso posterior','Evento real posterior à listagem de teste.','/conta')",
        [b.userId, randomUUID()],
      );
      await notices.readAll(a, { through: feed.asOf });
      const next = await notices.list(a, { filter: "unread" });
      expect(next.notifications).toHaveLength(1);
      expect(next.notifications[0].title).toBe("Aviso posterior");
    });
    it("revogação de setor esconde avisos e impede leitura de IDs antigos mesmo com contexto administrativo obsoleto", async () => {
      const feed = await notices.list(administrative(refundAdmin), {
          category: "refunds",
        }),
        id = feed.notifications[0].id;
      await p().query(
        "INSERT INTO app_admin_sector_members(user_id,sector_code) VALUES($1,'location_management')",
        [refundAdmin.userId],
      );
      await p().query(
        "UPDATE app_admin_sector_members SET revoked_at=clock_timestamp() WHERE user_id=$1 AND sector_code='refund_management'",
        [refundAdmin.userId],
      );
      try {
        expect(
          (
            await notices.list(administrative(refundAdmin), {
              category: "refunds",
            })
          ).notifications,
        ).toHaveLength(0);
        await expect(
          notices.read(administrative(refundAdmin), id),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        await p().query(
          "UPDATE app_admin_sector_members SET revoked_at=NULL WHERE user_id=$1 AND sector_code='refund_management'",
          [refundAdmin.userId],
        );
      }
    });
    it("RLS bloqueia leitura cruzada, mutações de authenticated e função emissora", async () => {
      const b = await f.buyer([]),
        c = await p().connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE authenticated");
        await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
          b.userId,
        ]);
        expect(
          (
            await c.query("SELECT recipient_user_id FROM app_notifications")
          ).rows.every((r) => r.recipient_user_id === b.userId),
        ).toBe(true);
        expect(
          (
            await c.query(
              "SELECT has_table_privilege('authenticated','public.app_notifications','INSERT') AS i,has_table_privilege('authenticated','public.app_notifications','UPDATE') AS u,has_function_privilege('authenticated','hvm_notifications_private.emit(uuid,text,text,text,text,text,text,text)','EXECUTE') AS f",
            )
          ).rows[0],
        ).toEqual({ i: false, u: false, f: false });
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
    it("conteúdo da notificação é imutável e transação abortada não deixa aviso", async () => {
      const b = await f.buyer([]),
        feed = await notices.list(own(b.userId, "consumer"), {});
      await expect(
        p().query(
          "UPDATE app_notifications SET title='Conteúdo trocado' WHERE id=$1",
          [feed.notifications[0].id],
        ),
      ).rejects.toMatchObject({ message: "NOTIFICATION_IMMUTABLE" });
      const key = randomUUID(),
        c = await p().connect();
      try {
        await c.query("BEGIN");
        await c.query(
          "SELECT hvm_notifications_private.emit($1,'consumer',$2,'account','Aborto','Mudança abortada no teste.','/conta')",
          [b.userId, key],
        );
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
      expect(
        (
          await p().query(
            "SELECT id FROM app_notifications WHERE event_key=$1",
            [key],
          )
        ).rowCount,
      ).toBe(0);
    });
    it("auditoria de catálogo/estoque/conta é integrada sem avisos por quantidade de carrinho", async () => {
      const b = await f.buyer([]),
        before = await notices.list(own(b.userId, "consumer"), {});
      await CartService.addItem(
        { sessionId: b.sessionId, userId: b.userId },
        { productId: f.catalog.pa, quantity: 3, commandId: randomUUID() },
        checkoutAudit(),
      );
      expect((await notices.list(own(b.userId, "consumer"), {})).total).toBe(
        before.total,
      );
      for (const category of ["catalog", "inventory", "delivery"])
        expect(
          (
            await notices.list(own(f.catalog.a.userId, "producer"), {
              category,
            })
          ).total,
        ).toBeGreaterThan(0);
    });
    it("delegação posterior recebe trabalho pendente do setor", async () => {
      const a = await f.admin("platform_admin", true);
      await p().query(
        "INSERT INTO app_admin_sector_members(user_id,sector_code) VALUES($1,'refund_management')",
        [a.userId],
      );
      expect(
        (
          await notices.list(administrative(a), { category: "refunds" })
        ).notifications.some((n) => n.title === "Reembolso pendente"),
      ).toBe(true);
    });
    it("assinatura de produtor e ciclos recebem avisos sem serem compras de produto", async () => {
      const plan = await SubscriptionService.savePlan(
        root,
        null,
        {
          slug: "notification-producer-" + randomUUID(),
          name: "Plano exclusivo de teste",
          targetAudience: "producer",
          deliveriesPerWeek: 0,
          priceCents: 0,
          billingPeriod: "monthly",
          description: "Plano exclusivamente do banco descartável.",
          storeId: null,
          isActive: true,
        },
        randomUUID(),
        checkoutAudit(),
      );
      const sub = await SubscriptionService.createSubscription(
        f.catalog.a.userId,
        { planId: plan.id },
        randomUUID(),
        checkoutAudit(),
      );
      await p().query(
        "UPDATE app_subscriptions SET current_period_start=clock_timestamp()-interval '2 days',current_period_end=clock_timestamp()-interval '1 day' WHERE id=$1",
        [sub.id],
      );
      const cycle = await SubscriptionService.runBillingCycle(
        sub.id,
        f.catalog.a.userId,
        {},
        randomUUID(),
        checkoutAudit(),
      );
      expect(cycle.payment).toBeNull();
      expect(
        (
          await notices.list(own(f.catalog.a.userId, "producer"), {
            category: "subscriptions",
          })
        ).notifications.some((n) => n.title === "Assinatura atualizada"),
      ).toBe(true);
      expect(
        (
          await notices.list(own(f.catalog.a.userId, "producer"), {
            category: "subscriptions",
          })
        ).notifications.some(
          (n) => n.title === "Ciclo da assinatura atualizado",
        ),
      ).toBe(true);
      expect(
        (
          await notices.list(own(f.catalog.a.userId, "producer"), {
            category: "purchases",
          })
        ).total,
      ).toBe(0);
      await p().query("DELETE FROM app_subscriptions WHERE id=$1", [sub.id]);
      await p().query("DELETE FROM app_plans WHERE id=$1", [plan.id]);
    });
    it("contatos ao vendedor são imutáveis e RLS limita leitura ao titular e administração de reembolso", async () => {
      const paid = await f.paid(),
        r = await support.requestRefund(
          paid.b.userId,
          {
            commandId: randomUUID(),
            orderId: paid.id,
            reason: "other",
            description:
              "Atendimento privado em banco local para confirmar leitura por titular.",
            requestedAmountCents: 100,
          },
          checkoutAudit(),
        );
      await support.contactSeller(
        refundAdmin,
        r.id,
        {
          commandId: randomUUID(),
          message: "Orientação enviada ao vendedor titular da venda.",
        },
        checkoutAudit(),
      );
      const id = (
        await p().query(
          "SELECT id FROM app_refund_seller_contacts WHERE refund_id=$1",
          [r.id],
        )
      ).rows[0].id;
      await expect(
        p().query(
          "UPDATE app_refund_seller_contacts SET message='Alteração indevida do histórico' WHERE id=$1",
          [id],
        ),
      ).rejects.toMatchObject({ message: "SELLER_CONTACT_IMMUTABLE" });
      await expect(
        p().query("DELETE FROM app_refund_seller_contacts WHERE id=$1", [id]),
      ).rejects.toMatchObject({ message: "SELLER_CONTACT_IMMUTABLE" });
      for (const [userId, visible] of [
        [f.catalog.a.userId, true],
        [f.catalog.b.userId, false],
        [paid.b.userId, false],
        [refundAdmin.userId, true],
        [complaintAdmin.userId, false],
        [root.userId, true],
      ] as const) {
        const c = await p().connect();
        try {
          await c.query("BEGIN");
          await c.query("SET LOCAL ROLE authenticated");
          await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
            userId,
          ]);
          expect(
            (
              await c.query(
                "SELECT id FROM app_refund_seller_contacts WHERE id=$1",
                [id],
              )
            ).rowCount,
          ).toBe(visible ? 1 : 0);
        } finally {
          await c.query("ROLLBACK");
          c.release();
        }
      }
    });
    it("anexo privado notifica administração e não envia o conteúdo ou aviso ao vendedor", async () => {
      const paid = await f.paid(),
        r = await support.requestRefund(
          paid.b.userId,
          {
            commandId: randomUUID(),
            orderId: paid.id,
            reason: "other",
            description:
              "Atendimento com documento privado exclusivamente no banco local.",
            requestedAmountCents: 100,
          },
          checkoutAudit(),
        ),
        path = paid.b.userId + "/" + randomUUID() + ".pdf";
      const before = (
        await notices.list(own(f.catalog.a.userId, "producer"), {
          category: "refunds",
        })
      ).total;
      await p().query(
        "INSERT INTO app_case_evidence(refund_id,uploader_user_id,storage_path,file_name,mime_type) VALUES($1,$2,$3,'comprovante-privado.pdf','application/pdf')",
        [r.id, paid.b.userId, path],
      );
      expect(
        (
          await notices.list(own(f.catalog.a.userId, "producer"), {
            category: "refunds",
          })
        ).total,
      ).toBe(before);
      expect(
        (
          await notices.list(administrative(refundAdmin), {
            category: "refunds",
          })
        ).notifications.some(
          (n) =>
            n.title === "Atendimento atualizado" && n.actionPath.includes(r.id),
        ),
      ).toBe(true);
      expect(
        JSON.stringify(await sales.refunds(f.catalog.a.userId, {}, r.id)),
      ).not.toContain(path);
    });
  },
);
