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
import { AdminSectorCodeSchema } from "../../shared/contracts/adminGovernance.ts";
import { ADMIN_NOTIFICATION_ROUTE_SECTORS } from "../../server/services/NotificationPresentation.ts";
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
    async function authenticatedIds(userId: string, ids: string[]) {
      const c = await p().connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE authenticated");
        await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
          userId,
        ]);
        return (
          await c.query(
            "SELECT id FROM public.app_notifications WHERE id=ANY($1::uuid[]) ORDER BY id",
            [ids],
          )
        ).rows.map((row) => row.id);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    }
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
    it("detalhe explica o evento para quatro perfis e o GET não marca a notificação como lida", async () => {
      const buyer = await f.buyer([]);
      const recipients = [
        [own(buyer.userId, "consumer"), "purchases", "/compras", "Consumidor"],
        [
          own(f.catalog.a.userId, "producer"),
          "sales",
          "/produtor/vendas",
          "Produtor",
        ],
        [
          administrative(refundAdmin),
          "refunds",
          "/admin/reembolsos",
          "Administrador",
        ],
        [
          administrative(root),
          "refunds",
          "/admin/reembolsos",
          "Super administrador",
        ],
      ] as const;
      for (const [actor, category, path, label] of recipients) {
        const event = randomUUID();
        await p().query(
          "SELECT hvm_notifications_private.emit($1,$2,$3,$4,'Atualização de teste','Informação exata registrada no evento.',$5,$6)",
          [
            actor.userId,
            actor.role,
            event,
            category,
            path,
            category === "refunds" ? "refund_management" : null,
          ],
        );
        const id = (
          await p().query(
            "SELECT id FROM app_notifications WHERE event_key=$1 AND recipient_user_id=$2",
            [event, actor.userId],
          )
        ).rows[0].id;
        const detail = await notices.detail(actor, id);
        expect(detail).toMatchObject({
          id,
          recipientRole: actor.role,
          message: "Informação exata registrada no evento.",
          readAt: null,
          context: { audienceLabel: label },
          action: { path },
        });
        expect(detail.context.why.length).toBeGreaterThan(20);
        expect(detail.context.nextStep.length).toBeGreaterThan(20);
        expect(
          (
            await p().query(
              "SELECT read_at FROM app_notifications WHERE id=$1",
              [id],
            )
          ).rows[0].read_at,
        ).toBeNull();
        expect(await authenticatedIds(actor.userId, [id])).toEqual([id]);
        const other = await f.buyer([]);
        expect(await authenticatedIds(other.userId, [id])).toEqual([]);
        await expect(
          notices.detail(own(other.userId, "consumer"), id),
        ).rejects.toMatchObject({ status: 404 });
      }
    });
    it("contador global permanece correto ao filtrar categorias, lidas e páginas", async () => {
      const buyer = await f.buyer([]),
        actor = own(buyer.userId, "consumer");
      const event = randomUUID();
      await p().query(
        "SELECT hvm_notifications_private.emit($1,'consumer',$2||':'||n,'account','Conta atualizada','Atualização de teste para paginação.','/conta') FROM generate_series(1,35) n",
        [buyer.userId, event],
      );
      await p().query(
        "SELECT hvm_notifications_private.emit($1,'consumer',$2,'refunds','Reembolso atualizado','Atualização do atendimento de teste.','/reembolsos')",
        [buyer.userId, randomUUID()],
      );
      const all = await notices.list(actor, {}),
        category = await notices.list(actor, { category: "refunds" }),
        later = await notices.list(actor, {
          page: 2,
          category: "account",
          filter: "unread",
        });
      expect(all.unreadCount).toBeGreaterThan(35);
      expect(category.total).toBe(1);
      expect(category.unreadCount).toBe(all.unreadCount);
      expect(later.unreadCount).toBe(all.unreadCount);
      expect(later.page).toBe(2);
      expect(later.notifications.length).toBeGreaterThan(0);
      await notices.read(actor, later.notifications[0].id);
      expect(
        (await notices.list(actor, { category: "refunds" })).unreadCount,
      ).toBe(all.unreadCount - 1);
      await notices.readAll(actor, { through: all.asOf });
      expect(
        (await notices.list(actor, { category: "refunds" })).unreadCount,
      ).toBe(0);
    });
    it("revogação explícita também bloqueia detalhe e contador do super administrador", async () => {
      const actor = administrative(root),
        event = randomUUID();
      await p().query(
        "SELECT hvm_notifications_private.emit($1,'platform_super_admin',$2,'refunds','Reembolso restrito','Evento do setor de reembolsos.','/admin/reembolsos','refund_management')",
        [root.userId, event],
      );
      const id = (
        await p().query(
          "SELECT id FROM app_notifications WHERE event_key=$1 AND recipient_user_id=$2",
          [event, root.userId],
        )
      ).rows[0].id;
      expect((await notices.detail(actor, id)).action?.path).toBe(
        "/admin/reembolsos",
      );
      const before = await notices.list(actor, {}),
        refunds = await notices.list(actor, {
          category: "refunds",
          filter: "unread",
        });
      await p().query(
        "INSERT INTO app_admin_permission_overrides(user_id,sector_code,allowed) VALUES($1,'refund_management',false)",
        [root.userId],
      );
      try {
        const after = await notices.list(actor, {});
        expect(after.unreadCount).toBe(before.unreadCount - refunds.total);
        expect(after.availableCategories).not.toContain("refunds");
        await expect(notices.detail(actor, id)).rejects.toMatchObject({
          status: 404,
        });
        await expect(notices.read(actor, id)).rejects.toMatchObject({
          status: 404,
        });
      } finally {
        await p().query(
          "DELETE FROM app_admin_permission_overrides WHERE user_id=$1 AND sector_code='refund_management'",
          [root.userId],
        );
      }
    });
    it("notificação pessoal pode ser lida mas não oferece um destino que não é reconhecido", async () => {
      const actor = administrative(refundAdmin),
        event = randomUUID();
      await p().query(
        "SELECT hvm_notifications_private.emit($1,'platform_admin',$2,'administration','Orientação administrativa','Aviso pessoal destinado ao acesso.','/admin/area-indisponivel')",
        [refundAdmin.userId, event],
      );
      const id = (
        await p().query(
          "SELECT id FROM app_notifications WHERE event_key=$1 AND recipient_user_id=$2",
          [event, refundAdmin.userId],
        )
      ).rows[0].id;
      expect((await notices.detail(actor, id)).action).toBeNull();
      expect((await notices.list(actor, {})).availableCategories).not.toContain(
        "complaints",
      );
    });
    it("broadcasts antigos sem setor respeitam a revogação da origem, inclusive contador e leitura em lote", async () => {
      const actor = administrative(root);
      const paths = ["/admin/categorias", "/admin/governanca"];
      const auditIds: string[] = [];
      for (const action of ["category.updated", "admin.invite.archived"]) {
        const id = randomUUID();
        auditIds.push(id);
        await p().query(
          "INSERT INTO app_audit_events(id,request_id,actor_id,actor_role,action,target_entity,target_id,client_ip_hash) VALUES($1,$2,$3,'platform_super_admin',$4,'synthetic_notification_origin',$5,$6)",
          [id, randomUUID(), root.userId, action, randomUUID(), "a".repeat(64)],
        );
      }
      const legacy = (
        await p().query(
          "SELECT id,required_sector,action_path FROM app_notifications WHERE recipient_user_id=$1 AND event_key=ANY($2::text[])",
          [root.userId, auditIds.map((id) => "audit:" + id)],
        )
      ).rows;
      expect(legacy).toHaveLength(2);
      expect(
        legacy.every(
          (row) =>
            row.required_sector === null && paths.includes(row.action_path),
        ),
      ).toBe(true);
      for (const row of legacy)
        expect((await notices.detail(actor, row.id)).action?.path).toBe(
          row.action_path,
        );
      const personalEvent = randomUUID();
      await p().query(
        "SELECT hvm_notifications_private.emit($1,'platform_super_admin',$2,'account','Conta atualizada','Atualização da própria conta administrativa.','/admin/conta')",
        [root.userId, personalEvent],
      );
      const personal = (
        await p().query(
          "SELECT id FROM app_notifications WHERE recipient_user_id=$1 AND event_key=$2",
          [root.userId, personalEvent],
        )
      ).rows[0];
      const before = await notices.list(actor, {});
      await p().query(
        "INSERT INTO app_admin_permission_overrides(user_id,sector_code,allowed) VALUES($1,'catalog_moderation',false),($1,'account_governance',false)",
        [root.userId],
      );
      try {
        const hiddenUnread = (
          await p().query(
            "SELECT count(*)::int n FROM app_notifications WHERE recipient_user_id=$1 AND recipient_role='platform_super_admin' AND read_at IS NULL AND (required_sector IN ('catalog_moderation','account_governance') OR (required_sector IS NULL AND action_path=ANY($2::text[])))",
            [root.userId, [...paths, "/admin/usuarios"]],
          )
        ).rows[0].n;
        const after = await notices.list(actor, {});
        expect(after.unreadCount).toBe(before.unreadCount - hiddenUnread);
        expect(
          after.notifications.some((row) => paths.includes(row.actionPath)),
        ).toBe(false);
        for (const row of legacy) {
          expect(await authenticatedIds(root.userId, [row.id])).toEqual([]);
          await expect(notices.detail(actor, row.id)).rejects.toMatchObject({
            status: 404,
          });
          await expect(notices.read(actor, row.id)).rejects.toMatchObject({
            status: 404,
          });
        }
        expect((await notices.detail(actor, personal.id)).action?.path).toBe(
          "/admin/conta",
        );
        expect(await authenticatedIds(root.userId, [personal.id])).toEqual([
          personal.id,
        ]);
        await notices.readAll(actor, { through: after.asOf });
        expect((await notices.list(actor, {})).unreadCount).toBe(0);
        expect(
          (
            await p().query(
              "SELECT count(*)::int n FROM app_notifications WHERE id=ANY($1::uuid[]) AND read_at IS NULL",
              [legacy.map((row) => row.id)],
            )
          ).rows[0].n,
        ).toBe(2);
        const welcome = (
          await p().query(
            "SELECT id FROM app_notifications WHERE recipient_user_id=$1 AND action_path='/admin/painel' LIMIT 1",
            [root.userId],
          )
        ).rows[0];
        expect((await notices.detail(actor, welcome.id)).action?.path).toBe(
          "/admin/painel",
        );
      } finally {
        await p().query(
          "DELETE FROM app_admin_permission_overrides WHERE user_id=$1 AND sector_code IN ('catalog_moderation','account_governance')",
          [root.userId],
        );
      }
    });
    it("mesmo mapa canônico em API e RLS: quatro perfis, nove setores, revogações e prefixos desconhecidos", async () => {
      for (const { prefix, sector } of ADMIN_NOTIFICATION_ROUTE_SECTORS) {
        for (const suffix of [
          "",
          "/registro",
          "?id=local#detalhe",
          "#resumo",
        ]) {
          const mapped = (
            await p().query(
              "SELECT hvm_notifications_private.origin_sector(NULL,'platform_super_admin',$1) AS sector",
              [prefix + suffix],
            )
          ).rows[0].sector;
          expect(mapped).toBe(sector);
        }
      }
      for (const path of [
        "/admin/categorias-malicioso",
        "/admin/categorias_fora",
        "/admin/governanca-extra",
        "/admin/conta",
        "/admin/painel",
      ]) {
        expect(
          (
            await p().query(
              "SELECT hvm_notifications_private.origin_sector(NULL,'platform_super_admin',$1) AS sector",
              [path],
            )
          ).rows[0].sector,
        ).toBeNull();
      }
      const admin = await f.admin("platform_admin", false),
        superAdmin = await f.admin();
      await p().query(
        "INSERT INTO app_admin_sector_members(user_id,sector_code) SELECT $1,code FROM app_admin_sectors WHERE is_active",
        [admin.userId],
      );
      const routes: Record<string, string> = {
        document_verification: "/admin/documentos/fila",
        catalog_moderation: "/admin/categorias",
        finance_ops: "/admin/operacoes-financeiras",
        location_management: "/admin/localidades",
        account_governance: "/admin/governanca",
        platform_configuration: "/admin/configuracao",
        refund_management: "/admin/reembolsos",
        complaint_management: "/admin/denuncias",
        payment_configuration: "/admin/pagamentos",
      };
      for (const context of [admin, superAdmin]) {
        const actor = administrative(context),
          ids: string[] = [];
        for (const sector of AdminSectorCodeSchema.options) {
          const event = randomUUID();
          await p().query(
            "SELECT hvm_notifications_private.emit($1,$2,$3,'administration','Atualização setorial','Aviso do departamento de teste.',$4,$5)",
            [context.userId, context.role, event, routes[sector], sector],
          );
          const id = (
            await p().query(
              "SELECT id FROM app_notifications WHERE recipient_user_id=$1 AND event_key=$2",
              [context.userId, event],
            )
          ).rows[0].id;
          ids.push(id);
          expect((await notices.detail(actor, id)).id).toBe(id);
          expect(await authenticatedIds(context.userId, [id])).toEqual([id]);
          await p().query(
            "INSERT INTO app_admin_permission_overrides(user_id,sector_code,allowed) VALUES($1,$2,false)",
            [context.userId, sector],
          );
          await expect(notices.detail(actor, id)).rejects.toMatchObject({
            status: 404,
          });
          await expect(notices.read(actor, id)).rejects.toMatchObject({
            status: 404,
          });
          expect(await authenticatedIds(context.userId, [id])).toEqual([]);
        }
        const unknownEvent = randomUUID();
        await p().query(
          "SELECT hvm_notifications_private.emit($1,$2,$3,'account','Aviso pessoal','Atualização destinada à própria conta.','/admin/categorias-malicioso')",
          [context.userId, context.role, unknownEvent],
        );
        const personal = (
          await p().query(
            "SELECT id FROM app_notifications WHERE recipient_user_id=$1 AND event_key=$2",
            [context.userId, unknownEvent],
          )
        ).rows[0].id;
        expect((await notices.detail(actor, personal)).action).toBeNull();
        expect(await authenticatedIds(context.userId, [personal])).toEqual([
          personal,
        ]);
        const feed = await notices.list(actor, {});
        expect(feed.notifications.some((row) => ids.includes(row.id))).toBe(
          false,
        );
        await notices.readAll(actor, { through: feed.asOf });
        expect(
          (
            await p().query(
              "SELECT count(*)::int n FROM app_notifications WHERE id=ANY($1::uuid[]) AND read_at IS NULL",
              [ids],
            )
          ).rows[0].n,
        ).toBe(9);
        await p().query(
          "DELETE FROM app_admin_permission_overrides WHERE user_id=$1",
          [context.userId],
        );
      }
      const privileges = (
        await p().query(
          "SELECT has_function_privilege('anon','hvm_notifications_private.origin_readable(text,text,text)','EXECUTE') AS anonymous,has_function_privilege('authenticated','hvm_notifications_private.origin_readable(text,text,text)','EXECUTE') AS authenticated,has_table_privilege('authenticated','public.app_notifications','UPDATE') AS can_mutate",
        )
      ).rows[0];
      expect(privileges).toEqual({
        anonymous: false,
        authenticated: true,
        can_mutate: false,
      });
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
        await expect(
          notices.detail(administrative(refundAdmin), id),
        ).rejects.toMatchObject({ status: 404 });
        expect(
          (await notices.list(administrative(refundAdmin), {}))
            .availableCategories,
        ).not.toContain("refunds");
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
