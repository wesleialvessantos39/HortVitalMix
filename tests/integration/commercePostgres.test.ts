import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Pool } from "pg";
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T20_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("T20_LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
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
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
        createSignedUrl: async (path: string) => ({
          error: null,
          data: {
            signedUrl: `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=local`,
          },
        }),
      }),
    },
  },
}));
import { dbPool } from "../../server/db/pool.ts";
import { CheckoutService } from "../../server/services/CheckoutService.ts";
import {
  PaymentService,
  settleVerifiedPayment,
} from "../../server/services/PaymentService.ts";
import { CommerceService } from "../../server/services/CommerceService.ts";
import {
  AfterSalesService,
  completeVerifiedRefund,
} from "../../server/services/AfterSalesService.ts";
import { commerceTransaction } from "../../server/services/CommerceSupport.ts";
import {
  checkoutCatalog,
  checkoutBuyer,
  checkoutAudit,
} from "../helpers/checkoutFixtures.ts";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
type Buyer = Awaited<ReturnType<typeof checkoutBuyer>>;
describe.runIf(!!process.env.HVM_T20_LOCAL_DATABASE_URL)(
  "T20 PostgreSQL: caixa, compra protegida, denúncias e estorno",
  () => {
    const pool = () => dbPool as Pool;
    let catalog: Awaited<ReturnType<typeof checkoutCatalog>>;
    const buyers: Buyer[] = [];
    const admins: string[] = [];
    let superAdmin: AdminActorContext, delegate: AdminActorContext;
    const buyer = async (products: string[] = [catalog.pa, catalog.pb]) => {
      const value = await checkoutBuyer(pool(), products);
      buyers.push(value);
      return value;
    };
    async function admin(
      role: "platform_admin" | "platform_super_admin",
      sectors: string[] = [],
    ) {
      const person = await buyer([]),
        id = randomUUID();
      admins.push(id);
      await pool().query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
        [id, id + "@example.test"],
      );
      await pool().query("UPDATE app_users SET status='active' WHERE id=$1", [
        id,
      ]);
      await pool().query(
        "INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role,email_verified_at) VALUES($1,$2,$3,$4,now())",
        [id, person.personId, id + "@example.test", role],
      );
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
        [id, role],
      );
      for (const sector of sectors)
        await pool().query(
          "INSERT INTO app_admin_sector_members(user_id,sector_code,assigned_by) VALUES($1,$2,$3)",
          [id, sector, superAdmin.userId],
        );
      return {
        userId: id,
        role,
        sectors,
        isSuperAdmin: role === "platform_super_admin",
        sessionIssuedAt: new Date().toISOString(),
      } as AdminActorContext;
    }
    async function intent(b: Buyer) {
      const quote = await CheckoutService.createQuote(
        b.userId,
        b.cartId,
        b.addressId,
        checkoutAudit(),
      );
      const receipt = await CheckoutService.confirmCheckout(
        randomUUID(),
        { quoteId: quote.id, paymentMethod: "pix" },
        b.userId,
        checkoutAudit(),
      );
      const policy = (await CommerceService.policy()).policy;
      await PaymentService.acceptPolicy(
        b.userId,
        receipt.body.paymentIntentId,
        policy.version,
        checkoutAudit(),
      );
      const verified = {
        provider: "isolated_test",
        eventId: randomUUID(),
        paymentReference: randomUUID(),
        intentId: receipt.body.paymentIntentId,
        status: "approved" as const,
        amountCents: receipt.body.totalCents,
        currency: "BRL" as const,
        method: "pix" as const,
        paidAt: new Date().toISOString(),
      };
      await pool().query(
        "UPDATE app_payment_intents SET gateway_reference=$2 WHERE id=$1",
        [verified.intentId, verified.paymentReference],
      );
      return { quote, receipt, verified };
    }
    async function paid(b: Buyer) {
      const value = await intent(b);
      const result = await commerceTransaction((client) =>
        settleVerifiedPayment(client, value.verified, checkoutAudit()),
      );
      return { ...value, orderIds: result.orderIds! };
    }
    const refundInput = (id: string, amount: number) => ({
      commandId: randomUUID(),
      orderId: id,
      reason: "quality",
      description:
        "Os produtos chegaram impróprios para consumo no teste local.",
      requestedAmountCents: amount,
    });
    beforeAll(async () => {
      catalog = await checkoutCatalog(pool());
      superAdmin = await admin("platform_super_admin");
      delegate = await admin("platform_admin", ["refund_management"]);
    }, 20000);
    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => {
      try {
        for (const id of admins)
          await pool().query("DELETE FROM auth.users WHERE id=$1", [id]);
        for (const b of buyers.reverse()) await b.cleanup();
        if (catalog) await catalog.cleanup();
      } finally {
        await dbPool?.end();
      }
    }, 20000);
    it("recusa webhook sem gateway e não escreve transações", async () => {
      const before = (
        await pool().query(
          "SELECT count(*)::int n FROM app_payment_transactions",
        )
      ).rows[0].n;
      await expect(
        PaymentService.webhook(
          { body: { status: "approved" }, headers: {}, query: {} },
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "GATEWAY_NOT_CONFIGURED" });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_payment_transactions",
          )
        ).rows[0].n,
      ).toBe(before);
    });
    it("liquida duas lojas em uma transação, consome reservas e não baixa o estoque duas vezes", async () => {
      const b = await buyer(),
        value = await intent(b);
      const stock = (
        await pool().query(
          "SELECT product_id,sum(current_quantity)::int n FROM app_inventory_lots WHERE product_id=ANY($1::uuid[]) GROUP BY product_id ORDER BY product_id",
          [[catalog.pa, catalog.pb]],
        )
      ).rows;
      const result = await commerceTransaction((client) =>
        settleVerifiedPayment(client, value.verified, checkoutAudit()),
      );
      expect(result.orderIds).toHaveLength(2);
      expect(
        (
          await pool().query(
            "SELECT product_id,sum(current_quantity)::int n FROM app_inventory_lots WHERE product_id=ANY($1::uuid[]) GROUP BY product_id ORDER BY product_id",
            [[catalog.pa, catalog.pb]],
          )
        ).rows,
      ).toEqual(stock);
      expect(
        (
          await pool().query(
            "SELECT is_consumed,is_released FROM app_inventory_reservations WHERE id=ANY($1::uuid[])",
            [value.receipt.body.reservations.map((r) => r.id)],
          )
        ).rows.every((row) => row.is_consumed && !row.is_released),
      ).toBe(true);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_cart_items WHERE cart_id=$1",
            [b.cartId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("reenvio do evento e outro evento da mesma aprovação não duplicam pedidos ou débitos", async () => {
      const b = await buyer(),
        value = await paid(b);
      expect(
        await commerceTransaction((client) =>
          settleVerifiedPayment(client, value.verified, checkoutAudit()),
        ),
      ).toMatchObject({ replayed: true });
      expect(
        await commerceTransaction((client) =>
          settleVerifiedPayment(
            client,
            { ...value.verified, eventId: randomUUID() },
            checkoutAudit(),
          ),
        ),
      ).toMatchObject({ replayed: true });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_orders WHERE payment_intent_id=$1",
            [value.verified.intentId],
          )
        ).rows[0].n,
      ).toBe(2);
    });
    it("valor divergente aborta a conversão sem qualquer pedido", async () => {
      const b = await buyer(),
        value = await intent(b);
      await expect(
        commerceTransaction((client) =>
          settleVerifiedPayment(
            client,
            { ...value.verified, amountCents: value.verified.amountCents + 1 },
            checkoutAudit(),
          ),
        ),
      ).rejects.toMatchObject({ code: "PAYMENT_VALUES_MISMATCH" });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_orders WHERE payment_intent_id=$1",
            [value.verified.intentId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("reserva expirada aborta todos os pedidos e movimentos da compra", async () => {
      const b = await buyer(),
        value = await intent(b);
      await pool().query(
        "UPDATE app_inventory_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [value.receipt.body.reservations[1].id],
      );
      await expect(
        commerceTransaction((client) =>
          settleVerifiedPayment(client, value.verified, checkoutAudit()),
        ),
      ).rejects.toMatchObject({ code: "INVENTORY_RESERVATION_EXPIRED" });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_orders WHERE payment_intent_id=$1",
            [value.verified.intentId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT bool_or(is_consumed) used FROM app_inventory_reservations WHERE id=ANY($1::uuid[])",
            [value.receipt.body.reservations.map((r) => r.id)],
          )
        ).rows[0].used,
      ).toBe(false);
    });
    it("consumidor confirma recebimento, inicia sete dias e não pode mudar o instante", async () => {
      const b = await buyer(),
        value = await paid(b),
        id = value.orderIds[0],
        cmd = randomUUID();
      await CommerceService.received(b.userId, id, cmd, checkoutAudit());
      const row = (
        await pool().query(
          "SELECT o.received_at,h.release_after FROM app_orders o JOIN app_financial_holds h ON h.order_id=o.id WHERE o.id=$1",
          [id],
        )
      ).rows[0];
      expect(row.release_after.getTime() - row.received_at.getTime()).toBe(
        7 * 86400000,
      );
      await CommerceService.received(b.userId, id, cmd, checkoutAudit());
      expect(
        (
          await pool().query("SELECT received_at FROM app_orders WHERE id=$1", [
            id,
          ])
        ).rows[0].received_at,
      ).toEqual(row.received_at);
      await expect(
        pool().query(
          "UPDATE app_orders SET total_cents=total_cents+1 WHERE id=$1",
          [id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("RLS isola consumidor, produtor titular e estranhos; authenticated não modifica", async () => {
      const b = await buyer(),
        stranger = await buyer([]),
        value = await paid(b),
        client = await pool().connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE authenticated");
        await client.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true)",
          [stranger.userId],
        );
        expect(
          (
            await client.query(
              "SELECT count(*)::int n FROM app_orders WHERE payment_intent_id=$1",
              [value.verified.intentId],
            )
          ).rows[0].n,
        ).toBe(0);
        await client.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true)",
          [b.userId],
        );
        expect(
          (
            await client.query(
              "SELECT count(*)::int n FROM app_orders WHERE payment_intent_id=$1",
              [value.verified.intentId],
            )
          ).rows[0].n,
        ).toBe(2);
        await client.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true)",
          [catalog.a.userId],
        );
        expect(
          (
            await client.query(
              "SELECT count(*)::int n FROM app_orders WHERE payment_intent_id=$1",
              [value.verified.intentId],
            )
          ).rows[0].n,
        ).toBe(1);
        await expect(
          client.query(
            "UPDATE app_orders SET status='refunded' WHERE payment_intent_id=$1",
            [value.verified.intentId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
    it("o caixa prepara venda idempotente sem consumir ou reservar estoque", async () => {
      const input = {
        commandId: randomUUID(),
        paymentMethod: "debit_card",
        paymentChannel: "terminal",
        items: [{ productId: catalog.pa, quantity: 1 }],
      };
      const before = (
        await pool().query(
          "SELECT sum(current_quantity)::int n FROM app_inventory_lots WHERE product_id=$1",
          [catalog.pa],
        )
      ).rows[0].n;
      const sale = await CommerceService.createPosSale(
        catalog.a.userId,
        input,
        checkoutAudit(),
      );
      expect(
        await CommerceService.createPosSale(
          catalog.a.userId,
          input,
          checkoutAudit(),
        ),
      ).toEqual(sale);
      expect(
        (
          await pool().query(
            "SELECT sum(current_quantity)::int n FROM app_inventory_lots WHERE product_id=$1",
            [catalog.pa],
          )
        ).rows[0].n,
      ).toBe(before);
      expect(sale.status).toBe("draft");
      expect(sale.paymentMethod).toBe("debit_card");
    });
    it("o caixa rejeita produto de outra loja e estoque inexistente", async () => {
      await expect(
        CommerceService.createPosSale(
          catalog.a.userId,
          {
            commandId: randomUUID(),
            paymentMethod: "pix",
            paymentChannel: "system_pix",
            items: [{ productId: catalog.pb, quantity: 1 }],
          },
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "POS_PRODUCT_UNAVAILABLE" });
      await expect(
        CommerceService.createPosSale(
          catalog.b.userId,
          {
            commandId: randomUUID(),
            paymentMethod: "pix",
            paymentChannel: "system_pix",
            items: [{ productId: catalog.zero, quantity: 1 }],
          },
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "POS_INSUFFICIENT_STOCK" });
    });
    it("revisão presencial pertence a um cliente e não atesta pagamento", async () => {
      const b = await buyer([]),
        other = await buyer([]),
        sale = await CommerceService.createPosSale(
          catalog.a.userId,
          {
            commandId: randomUUID(),
            paymentMethod: "pix",
            paymentChannel: "system_pix",
            items: [{ productId: catalog.pa, quantity: 1 }],
          },
          checkoutAudit(),
        );
      await CommerceService.acceptPosSale(
        b.userId,
        sale.code,
        { commandId: randomUUID(), policyVersion: sale.policy.version },
        checkoutAudit(),
      );
      await expect(
        CommerceService.acceptPosSale(
          other.userId,
          sale.code,
          { commandId: randomUUID(), policyVersion: sale.policy.version },
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "POS_SALE_NOT_FOUND" });
      expect((await CommerceService.posSale(b.userId, sale.code)).status).toBe(
        "accepted",
      );
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_orders WHERE customer_user_id=$1",
            [b.userId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("reembolso só aceita compra própria, bloqueia o repasse e rejeita excesso", async () => {
      const b = await buyer(),
        other = await buyer([]),
        value = await paid(b);
      await expect(
        AfterSalesService.requestRefund(
          other.userId,
          refundInput(value.orderIds[0], 100),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
      const order = (await CommerceService.purchases(b.userId)).orders[0];
      await expect(
        AfterSalesService.requestRefund(
          b.userId,
          refundInput(order.id, order.totalCents + 1),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "REFUND_AMOUNT_INVALID" });
      const input = refundInput(order.id, order.totalCents),
        refund = await AfterSalesService.requestRefund(
          b.userId,
          input,
          checkoutAudit(),
        );
      expect(
        await AfterSalesService.requestRefund(b.userId, input, checkoutAudit()),
      ).toEqual(refund);
      expect(
        (
          await pool().query(
            "SELECT state FROM app_financial_holds WHERE order_id=$1",
            [order.id],
          )
        ).rows[0].state,
      ).toBe("disputed");
    });
    it("delegação específica permite decidir; aprovação não simula estorno", async () => {
      const b = await buyer(),
        value = await paid(b),
        refund = await AfterSalesService.requestRefund(
          b.userId,
          refundInput(value.orderIds[0], 100),
          checkoutAudit(),
        );
      const next = await AfterSalesService.decideRefund(
        delegate,
        refund.id,
        {
          commandId: randomUUID(),
          expectedRevision: refund.revision,
          decision: "approve",
          approvedAmountCents: 100,
          notes: "Solicitação analisada e aprovada pela equipe de teste.",
        },
        checkoutAudit(),
      );
      expect(next.status).toBe("approved");
      expect(next.history).toHaveLength(2);
      expect(
        (
          await pool().query(
            "SELECT refunded_cents,state FROM app_financial_holds WHERE order_id=$1",
            [refund.orderId],
          )
        ).rows[0],
      ).toEqual({ refunded_cents: 0, state: "refund_pending" });
      await expect(
        AfterSalesService.processRefund(delegate, refund.id, checkoutAudit()),
      ).rejects.toMatchObject({ code: "GATEWAY_NOT_CONFIGURED" });
    });
    it("permissão revogada dentro da sessão não permite decisão", async () => {
      const b = await buyer(),
        value = await paid(b),
        refund = await AfterSalesService.requestRefund(
          b.userId,
          refundInput(value.orderIds[0], 100),
          checkoutAudit(),
        );
      await pool().query(
        "UPDATE app_admin_sector_members SET revoked_at=clock_timestamp() WHERE user_id=$1 AND sector_code='refund_management'",
        [delegate.userId],
      );
      try {
        await expect(
          AfterSalesService.decideRefund(
            delegate,
            refund.id,
            {
              commandId: randomUUID(),
              expectedRevision: 1,
              decision: "review",
              notes: "Não deve ser gravada porque o acesso foi revogado.",
            },
            checkoutAudit(),
          ),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await pool().query(
          "UPDATE app_admin_sector_members SET revoked_at=NULL WHERE user_id=$1 AND sector_code='refund_management'",
          [delegate.userId],
        );
      }
    });
    it("estorno confirmado é atômico e idempotente, inclusive parcial", async () => {
      const b = await buyer(),
        value = await paid(b),
        refund = await AfterSalesService.requestRefund(
          b.userId,
          refundInput(value.orderIds[0], 100),
          checkoutAudit(),
        );
      await AfterSalesService.decideRefund(
        superAdmin,
        refund.id,
        {
          commandId: randomUUID(),
          expectedRevision: 1,
          decision: "approve",
          approvedAmountCents: 100,
          notes: "Valor parcial validado antes de testar o estorno.",
        },
        checkoutAudit(),
      );
      const ref = randomUUID();
      expect(
        await commerceTransaction((client) =>
          completeVerifiedRefund(
            client,
            refund.id,
            "isolated_test",
            ref,
            100,
            superAdmin,
            checkoutAudit(),
          ),
        ),
      ).toMatchObject({ replayed: false });
      expect(
        await commerceTransaction((client) =>
          completeVerifiedRefund(
            client,
            refund.id,
            "isolated_test",
            ref,
            100,
            superAdmin,
            checkoutAudit(),
          ),
        ),
      ).toMatchObject({ replayed: true });
      expect(
        (
          await pool().query(
            "SELECT refunded_cents,state FROM app_financial_holds WHERE order_id=$1",
            [refund.orderId],
          )
        ).rows[0],
      ).toEqual({ refunded_cents: 100, state: "partially_refunded" });
    });
    it("denúncia de cliente exige relação de compra e não concede sanção", async () => {
      const b = await buyer(),
        stranger = await buyer([]),
        value = await paid(b),
        order = (
          await pool().query(
            "SELECT id FROM app_orders WHERE payment_intent_id=$1 AND producer_user_id=$2",
            [value.verified.intentId, catalog.a.userId],
          )
        ).rows[0];
      const input = {
        commandId: randomUUID(),
        targetType: "customer",
        targetId: b.userId,
        orderId: order.id,
        reason: "harassment",
        description:
          "Cliente da compra praticou comportamento abusivo no teste.",
      };
      await expect(
        AfterSalesService.createComplaint(
          catalog.a.userId,
          { ...input, targetId: stranger.userId },
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "COMPLAINT_RELATIONSHIP_REQUIRED" });
      const complaint = await AfterSalesService.createComplaint(
        catalog.a.userId,
        input,
        checkoutAudit(),
      );
      expect(complaint.status).toBe("submitted");
      expect(
        (
          await pool().query("SELECT status FROM app_users WHERE id=$1", [
            b.userId,
          ])
        ).rows[0].status,
      ).toBe("active");
      await expect(
        AfterSalesService.detail(b.userId, "complaint", complaint.id),
      ).rejects.toMatchObject({ code: "CASE_NOT_FOUND" });
      await expect(
        AfterSalesService.detail(
          delegate.userId,
          "complaint",
          complaint.id,
          delegate,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("consumidor denuncia produto, loja e produtor com protocolos privados", async () => {
      const b = await buyer([]);
      for (const [targetType, targetId] of [
        ["store", catalog.a.store.id],
        ["producer", catalog.a.store.id],
        ["product", catalog.pa],
      ]) {
        const value = await AfterSalesService.createComplaint(
          b.userId,
          {
            commandId: randomUUID(),
            targetType,
            targetId,
            orderId: null,
            reason: "misleading_information",
            description:
              "Informação da oferta precisa ser verificada pela equipe.",
          },
          checkoutAudit(),
        );
        expect(value.targetType).toBe(targetType);
        expect(value.history).toHaveLength(1);
      }
    });
    it("encerrar denúncia não libera valores com reembolso ainda aberto", async () => {
      const b = await buyer(),
        value = await paid(b),
        order = (await CommerceService.purchases(b.userId)).orders[0];
      await AfterSalesService.requestRefund(
        b.userId,
        refundInput(order.id, 100),
        checkoutAudit(),
      );
      const complaint = await AfterSalesService.createComplaint(
        b.userId,
        {
          commandId: randomUUID(),
          targetType: "product",
          targetId: order.items[0].productId,
          orderId: order.id,
          reason: "unsafe_food",
          description:
            "Produto vinculado à compra apresentou um problema de qualidade.",
        },
        checkoutAudit(),
      );
      await AfterSalesService.decideComplaint(
        superAdmin,
        complaint.id,
        {
          commandId: randomUUID(),
          expectedRevision: 1,
          decision: "resolve",
          notes:
            "Análise de segurança concluída; o reembolso continua em análise.",
        },
        checkoutAudit(),
      );
      expect(
        (
          await pool().query(
            "SELECT state FROM app_financial_holds WHERE order_id=$1",
            [order.id],
          )
        ).rows[0].state,
      ).toBe("disputed");
    });
    it("histórico de decisão e mensagens são imutáveis", async () => {
      const b = await buyer([]),
        complaint = await AfterSalesService.createComplaint(
          b.userId,
          {
            commandId: randomUUID(),
            targetType: "store",
            targetId: catalog.a.store.id,
            orderId: null,
            reason: "other",
            description:
              "Solicitação de segurança sintética para testar a auditoria.",
          },
          checkoutAudit(),
        );
      await AfterSalesService.message(
        b.userId,
        "complaint",
        complaint.id,
        {
          commandId: randomUUID(),
          message: "Informação adicional registrada pelo autor da denúncia.",
        },
        checkoutAudit(),
      );
      await expect(
        pool().query(
          "UPDATE app_case_history SET notes='Tentativa de alterar o histórico de segurança.' WHERE complaint_id=$1",
          [complaint.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool().query("DELETE FROM app_case_messages WHERE complaint_id=$1", [
          complaint.id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("evidência privada só é assinada para dono e setor autorizado", async () => {
      const b = await buyer([]),
        other = await buyer([]),
        complaint = await AfterSalesService.createComplaint(
          b.userId,
          {
            commandId: randomUUID(),
            targetType: "store",
            targetId: catalog.a.store.id,
            orderId: null,
            reason: "other",
            description: "Denúncia local para validar o anexo e a privacidade.",
          },
          checkoutAudit(),
        );
      const result = await AfterSalesService.uploadEvidence(
        b.userId,
        {
          commandId: randomUUID(),
          caseType: "complaint",
          caseId: complaint.id,
          fileName: "comprovante.pdf",
          mimeType: "application/pdf",
          base64: Buffer.from("%PDF-1.7\nsynthetic evidence").toString(
            "base64",
          ),
        },
        checkoutAudit(),
      );
      expect(
        await AfterSalesService.evidence(b.userId, result.id),
      ).toHaveProperty("url");
      await expect(
        AfterSalesService.evidence(other.userId, result.id),
      ).rejects.toMatchObject({ code: "CASE_NOT_FOUND" });
      await expect(
        AfterSalesService.evidence(delegate.userId, result.id, delegate),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("repetir o décimo anexo preserva o recibo, mas não aceita um décimo primeiro", async () => {
      const b = await buyer([]);
      const complaint = await AfterSalesService.createComplaint(
        b.userId,
        {
          commandId: randomUUID(),
          targetType: "store",
          targetId: catalog.a.store.id,
          orderId: null,
          reason: "other",
          description:
            "Comprovantes locais para validar o limite e a repetição do envio.",
        },
        checkoutAudit(),
      );
      let lastInput: any, lastResult: any;
      for (let i = 0; i < 10; i++) {
        lastInput = {
          commandId: randomUUID(),
          caseType: "complaint",
          caseId: complaint.id,
          fileName: `comprovante-${i}.pdf`,
          mimeType: "application/pdf",
          base64: Buffer.from("%PDF-1.7\nsynthetic local evidence").toString(
            "base64",
          ),
        };
        lastResult = await AfterSalesService.uploadEvidence(
          b.userId,
          lastInput,
          checkoutAudit(),
        );
      }
      expect(
        await AfterSalesService.uploadEvidence(
          b.userId,
          lastInput,
          checkoutAudit(),
        ),
      ).toEqual(lastResult);
      await expect(
        AfterSalesService.uploadEvidence(
          b.userId,
          { ...lastInput, fileName: "changed.pdf" },
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "COMMAND_REUSED" });
      await expect(
        AfterSalesService.uploadEvidence(
          b.userId,
          { ...lastInput, commandId: randomUUID() },
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "EVIDENCE_LIMIT" });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_case_evidence WHERE complaint_id=$1",
            [complaint.id],
          )
        ).rows[0].n,
      ).toBe(10);
    });
    it("pagina filas completas e filtra casos abertos e encerrados por titular", async () => {
      const b = await buyer([]),
        other = await buyer([]);
      await pool().query(
        `INSERT INTO app_complaints(reporter_user_id,reporter_role,target_type,target_id,reason,description,status)
        SELECT $1,'consumer','store',$2,'other','Denúncia local usada somente para conferir paginação de uma fila completa.',
        CASE WHEN i%2=0 THEN 'resolved' ELSE 'submitted' END FROM generate_series(1,52) AS i`,
        [b.userId, catalog.a.store.id],
      );
      const first = await AfterSalesService.cases(b.userId, "complaint"),
        second = await AfterSalesService.cases(
          b.userId,
          "complaint",
          undefined,
          2,
        );
      expect(first).toMatchObject({ page: 1, pages: 2, total: 52 });
      expect(first.cases).toHaveLength(50);
      expect(second.cases).toHaveLength(2);
      expect(
        new Set([...first.cases, ...second.cases].map((c) => c.id)).size,
      ).toBe(52);
      expect(
        (
          await AfterSalesService.cases(
            b.userId,
            "complaint",
            undefined,
            1,
            "open",
          )
        ).total,
      ).toBe(26);
      expect(
        (
          await AfterSalesService.cases(
            b.userId,
            "complaint",
            undefined,
            1,
            "closed",
          )
        ).total,
      ).toBe(26);
      expect(
        (await AfterSalesService.cases(other.userId, "complaint")).total,
      ).toBe(0);
    });
    it("a política aceita fica congelada após atualização administrativa", async () => {
      const b = await buyer(),
        value = await paid(b),
        settings = await CommerceService.settings(superAdmin);
      const next = await CommerceService.updateSettings(
        superAdmin,
        {
          commandId: randomUUID(),
          expectedRevision: settings.revision,
          policy: {
            onlineWithdrawalDays: 8,
            inPersonReturnDays: 1,
            holdingDays: 8,
            additionalTerms: "Termos ampliados para novas compras de teste.",
          },
          gateway: settings.gateway,
        },
        checkoutAudit(),
      );
      expect(
        (await CommerceService.purchases(b.userId)).orders[0].policy
          .onlineWithdrawalDays,
      ).toBe(settings.policy.onlineWithdrawalDays);
      await CommerceService.updateSettings(
        superAdmin,
        {
          commandId: randomUUID(),
          expectedRevision: next.revision,
          policy: {
            onlineWithdrawalDays: 7,
            inPersonReturnDays: 0,
            holdingDays: 7,
            additionalTerms: "",
          },
          gateway: settings.gateway,
        },
        checkoutAudit(),
      );
    });
  },
);
