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
import type { Pool, PoolClient } from "pg";
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T21_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("T21_LOCAL_DATABASE_REQUIRED");
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
import { AfterSalesService } from "../../server/services/AfterSalesService.ts";
import {
  CommerceError,
  commerceTransaction,
} from "../../server/services/CommerceSupport.ts";
import { OrderService } from "../../server/services/OrderService.ts";
import {
  checkoutAudit,
  checkoutBuyer,
  checkoutCatalog,
} from "../helpers/checkoutFixtures.ts";
import type { OrderStatus } from "../../shared/contracts/order.ts";
type Buyer = Awaited<ReturnType<typeof checkoutBuyer>>;

describe.runIf(!!process.env.HVM_T21_LOCAL_DATABASE_URL)(
  "T21 PostgreSQL: estados, rastreabilidade e preservação da T20",
  () => {
    const pool = () => dbPool as Pool;
    let catalog: Awaited<ReturnType<typeof checkoutCatalog>>;
    const buyers: Buyer[] = [];
    const buyer = async (products?: string[]) => {
      const b = await checkoutBuyer(pool(), products ?? [catalog.pa]);
      buyers.push(b);
      return b;
    };
    async function pending(b: Buyer) {
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
      await PaymentService.acceptPolicy(
        b.userId,
        receipt.body.paymentIntentId,
        (await CommerceService.policy()).policy.version,
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
    async function paid(b?: Buyer) {
      const owner = b ?? (await buyer()),
        value = await pending(owner);
      const result = await commerceTransaction((client) =>
        settleVerifiedPayment(client, value.verified, checkoutAudit()),
      );
      return {
        ...value,
        buyer: owner,
        ids: result.orderIds!,
        id: result.orderIds![0],
      };
    }
    const transition = (
      id: string,
      status: OrderStatus,
      revision: number,
      userId = catalog.a.userId,
      commandId = randomUUID(),
    ) =>
      OrderService.transitionStatus(
        id,
        userId,
        "producer",
        { toStatus: status, expectedRevision: revision },
        commandId,
        checkoutAudit(),
      );
    const balance = async (id: string) =>
      (
        await pool().query(
          "SELECT l.id,l.current_quantity FROM app_inventory_lots l JOIN app_inventory_reservations r ON r.lot_id=l.id WHERE r.consumed_order_id=$1 ORDER BY l.id",
          [id],
        )
      ).rows;
    beforeAll(async () => {
      catalog = await checkoutCatalog(pool());
    }, 20000);
    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => {
      try {
        for (const b of buyers.reverse()) await b.cleanup();
        if (catalog) await catalog.cleanup();
      } finally {
        await dbPool?.end();
      }
    }, 20000);

    it("pagamento de duas lojas cria estados, itens completos e um evento inicial por pedido na mesma transação", async () => {
      const p = await paid(await buyer([catalog.pa, catalog.pb]));
      expect(p.ids).toHaveLength(2);
      for (const id of p.ids) {
        const o = await OrderService.get(id, p.buyer.userId);
        expect(o.status).toBe("confirmed");
        expect(o.revision).toBe(1);
        expect(o.allowedTransitions).toEqual([]);
        expect(o.items[0]).toMatchObject({
          netWeightGrams: 300,
          packaging: "porcao_embalada",
          quantity: 2,
        });
        expect(o.events).toHaveLength(1);
        expect(o.events[0]).toMatchObject({
          fromStatus: null,
          toStatus: "confirmed",
          actorRole: "payment_gateway",
          revision: 1,
        });
      }
      await commerceTransaction((client) =>
        OrderService.createFromApprovedIntent(p.verified.intentId, client),
      );
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_order_events WHERE order_id=ANY($1::uuid[])",
            [p.ids],
          )
        ).rows[0].n,
      ).toBe(2);
      const repeated = await commerceTransaction((client) =>
        settleVerifiedPayment(client, p.verified, checkoutAudit()),
      );
      expect(repeated.replayed).toBe(true);
    });
    it("pending_payment não cria pedido confirmado nem por SQL privilegiado", async () => {
      const template = await paid(),
        b = await buyer(),
        value = await pending(b);
      await expect(
        commerceTransaction((client) =>
          OrderService.createFromApprovedIntent(
            value.verified.intentId,
            client,
          ),
        ),
      ).rejects.toMatchObject({
        code: "ORDER_PAYMENT_NOT_APPROVED",
        status: 422,
      });
      await expect(
        pool().query(
          `INSERT INTO app_orders(payment_intent_id,customer_user_id,producer_user_id,store_id,store_snapshot,source,items_snapshot,address_snapshot,subtotal_cents,delivery_fee_cents,total_cents,policy_snapshot)
      SELECT $2,$3,producer_user_id,store_id,store_snapshot,source,items_snapshot,$4,subtotal_cents,delivery_fee_cents,total_cents,policy_snapshot FROM app_orders WHERE id=$1`,
          [
            template.id,
            value.verified.intentId,
            b.userId,
            JSON.stringify(value.quote.addressSnapshot),
          ],
        ),
      ).rejects.toThrow("ORDER_PAYMENT_NOT_APPROVED");
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_orders WHERE payment_intent_id=$1",
            [value.verified.intentId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("confirmed → delivered retorna 422 sem evento, revisão ou alteração de estoque", async () => {
      const p = await paid(),
        before = await balance(p.id);
      await expect(transition(p.id, "delivered", 1)).rejects.toMatchObject({
        code: "ILLEGAL_TRANSITION",
        status: 422,
      });
      expect((await OrderService.get(p.id, p.buyer.userId)).revision).toBe(1);
      expect(
        (await OrderService.get(p.id, p.buyer.userId)).events,
      ).toHaveLength(1);
      expect(await balance(p.id)).toEqual(before);
    });
    it("dois avanços simultâneos da revisão 1 geram exatamente um sucesso e um HTTP 409", async () => {
      const p = await paid(),
        results = await Promise.allSettled([
          transition(p.id, "in_preparation", 1),
          transition(p.id, "in_preparation", 1),
        ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "REVISION_CONFLICT", status: 409 },
      });
      const o = await OrderService.get(p.id, p.buyer.userId);
      expect(o.revision).toBe(2);
      expect(o.events).toHaveLength(2);
    });
    it("reenvio de commandId depois da resposta perdida não repete transição ou evento", async () => {
      const p = await paid(),
        commandId = randomUUID();
      const first = await transition(
        p.id,
        "in_preparation",
        1,
        catalog.a.userId,
        commandId,
      );
      expect(
        await transition(
          p.id,
          "in_preparation",
          1,
          catalog.a.userId,
          commandId,
        ),
      ).toEqual(first);
      expect(
        (await OrderService.get(p.id, p.buyer.userId)).events,
      ).toHaveLength(2);
      await expect(
        transition(p.id, "ready_for_dispatch", 2, catalog.a.userId, commandId),
      ).rejects.toMatchObject({ code: "COMMAND_REUSED" });
    });
    it("máquina é estrita no banco mesmo com identidade administrativa forjada", async () => {
      const p = await paid(),
        client = await pool().connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('hvm.order_actor_user_id',$1,true),set_config('hvm.order_actor_role','platform_super_admin',true)",
          [catalog.a.userId],
        );
        await expect(
          client.query(
            "UPDATE app_order_fulfillment SET status='delivered',revision=2 WHERE order_id=$1",
            [p.id],
          ),
        ).rejects.toThrow("ILLEGAL_TRANSITION");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      await expect(
        OrderService.transitionStatus(
          p.id,
          catalog.a.userId,
          "platform_super_admin",
          { toStatus: "in_preparation", expectedRevision: 1 },
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("percorre somente as quatro etapas legais e delivered/cancelled são terminais", async () => {
      const p = await paid();
      let revision = 1;
      for (const status of [
        "in_preparation",
        "ready_for_dispatch",
        "out_for_delivery",
        "delivered",
      ] as const) {
        const o = await transition(p.id, status, revision++);
        expect(o.revision).toBe(revision);
      }
      const o = await OrderService.get(p.id, p.buyer.userId);
      expect(o.events.map((e) => e.toStatus)).toEqual([
        "confirmed",
        "in_preparation",
        "ready_for_dispatch",
        "out_for_delivery",
        "delivered",
      ]);
      expect(o.allowedTransitions).toEqual([]);
      await expect(transition(p.id, "in_preparation", 5)).rejects.toMatchObject(
        { code: "ILLEGAL_TRANSITION" },
      );
      await expect(
        OrderService.cancelOrder(
          p.id,
          catalog.a.userId,
          "Entrega já foi concluída no teste.",
          5,
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
    });
    it("alterações posteriores do preço, título e endereço não mudam o snapshot comprado", async () => {
      const p = await paid(),
        before = await OrderService.get(p.id, p.buyer.userId);
      await pool().query(
        "INSERT INTO app_price_versions(product_id,price_cents,created_by_user_id) VALUES($1,800,$2)",
        [catalog.pa, catalog.a.userId],
      );
      await pool().query(
        "UPDATE app_user_addresses SET street='Outro endereço' WHERE id=$1",
        [p.buyer.addressId],
      );
      const after = await OrderService.get(p.id, p.buyer.userId);
      expect(after.items).toEqual(before.items);
      expect(after.address).toEqual(before.address);
      expect(after.totalCents).toBe(before.totalCents);
      await expect(
        pool().query(
          "UPDATE app_order_items SET unit_price_cents=unit_price_cents+1 WHERE order_id=$1",
          [p.id],
        ),
      ).rejects.toThrow("ORDER_RECORD_IMMUTABLE");
      await expect(
        pool().query("DELETE FROM app_order_events WHERE order_id=$1", [p.id]),
      ).rejects.toThrow("ORDER_RECORD_IMMUTABLE");
    });
    it("serviço isola comprador/loja e não permite cancelar pedido de outro produtor", async () => {
      const p = await paid(),
        stranger = await buyer([]);
      expect(
        (await OrderService.list(p.buyer.userId, "customer", {})).orders.map(
          (o) => o.id,
        ),
      ).toEqual([p.id]);
      expect(
        (await OrderService.list(catalog.a.userId, "producer", {})).orders.some(
          (o) => o.id === p.id,
        ),
      ).toBe(true);
      expect(
        (await OrderService.list(catalog.b.userId, "producer", {})).orders.some(
          (o) => o.id === p.id,
        ),
      ).toBe(false);
      for (const userId of [stranger.userId, catalog.b.userId])
        await expect(OrderService.get(p.id, userId)).rejects.toMatchObject({
          code: "ORDER_NOT_FOUND",
          status: 404,
        });
      await expect(
        transition(p.id, "in_preparation", 1, catalog.b.userId),
      ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    });
    it("inserções privilegiadas não falsificam histórico ou acrescentam itens ao snapshot", async () => {
      const p = await paid();
      await expect(
        pool().query(
          "INSERT INTO app_order_events(order_id,actor_user_id,actor_role,from_status,to_status,revision) VALUES($1,$2,'producer','confirmed','delivered',2)",
          [p.id, catalog.a.userId],
        ),
      ).rejects.toThrow("ORDER_HISTORY_MISMATCH");
      await expect(
        pool().query(
          `INSERT INTO app_order_items(order_id,product_id,product_title_snapshot,packaging_snapshot,net_weight_grams,unit_type,cut_type,quantity,unit_price_cents,total_price_cents,item_position)
        SELECT order_id,product_id,product_title_snapshot,packaging_snapshot,net_weight_grams,unit_type,cut_type,quantity,unit_price_cents,total_price_cents,99 FROM app_order_items WHERE order_id=$1`,
          [p.id],
        ),
      ).rejects.toThrow("ORDER_SNAPSHOT_MISMATCH");
      const order = await OrderService.get(p.id, p.buyer.userId);
      expect(order.items).toHaveLength(1);
      expect(order.events).toHaveLength(1);
    });
    it("RLS ENABLE/FORCE permite somente SELECT dos participantes e nenhum DML de cliente", async () => {
      const p = await paid(),
        outsider = await buyer([]),
        client = await pool().connect();
      try {
        for (const [userId, expected] of [
          [p.buyer.userId, 1],
          [catalog.a.userId, 1],
          [catalog.b.userId, 0],
          [outsider.userId, 0],
        ] as const) {
          await client.query("BEGIN");
          await client.query("SET LOCAL ROLE authenticated");
          await client.query(
            "SELECT set_config('request.jwt.claim.sub',$1,true)",
            [userId],
          );
          for (const table of [
            "app_orders",
            "app_order_fulfillment",
            "app_order_items",
            "app_order_events",
          ]) {
            const key = table === "app_orders" ? "id" : "order_id";
            expect(
              (
                await client.query(
                  `SELECT * FROM public.${table} WHERE ${key}=$1`,
                  [p.id],
                )
              ).rowCount,
            ).toBe(expected);
            for (const permission of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"])
              expect(
                (
                  await client.query(
                    "SELECT has_table_privilege('authenticated',$1,$2) granted",
                    ["public." + table, permission],
                  )
                ).rows[0].granted,
              ).toBe(false);
          }
          await client.query("ROLLBACK");
        }
        const flags = (
          await client.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=ANY($1::regclass[])",
            [
              [
                "public.app_order_fulfillment",
                "public.app_order_items",
                "public.app_order_events",
                "public.app_order_stock_returns",
              ],
            ],
          )
        ).rows;
        expect(flags).toHaveLength(4);
        expect(
          flags.every((r) => r.relrowsecurity && r.relforcerowsecurity),
        ).toBe(true);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
    it("cancelamento confirmado restitui o lote de origem uma única vez e aciona a proteção financeira T20", async () => {
      const p = await paid(),
        before = await balance(p.id),
        commandId = randomUUID(),
        reason = "A colheita não passou no controle de qualidade.";
      const o = await OrderService.cancelOrder(
        p.id,
        catalog.a.userId,
        reason,
        1,
        commandId,
        checkoutAudit(),
      );
      expect(o.status).toBe("cancelled");
      expect(o.cancellationReason).toBe(reason);
      expect(o.refundState).toBe("disputed");
      expect((await balance(p.id))[0].current_quantity).toBe(
        before[0].current_quantity + 2,
      );
      expect(
        (
          await pool().query(
            "SELECT r.quantity,sr.quantity returned FROM app_inventory_reservations r JOIN app_order_stock_returns sr ON sr.reservation_id=r.id WHERE r.consumed_order_id=$1 AND r.is_consumed",
            [p.id],
          )
        ).rows,
      ).toEqual([{ quantity: 2, returned: 2 }]);
      const refund = (
        await pool().query(
          "SELECT * FROM app_refund_requests WHERE order_id=$1",
          [p.id],
        )
      ).rows[0];
      expect(refund.status).toBe("requested");
      expect(refund.requester_user_id).toBe(p.buyer.userId);
      expect(refund.requested_amount_cents).toBe(o.totalCents);
      await OrderService.cancelOrder(
        p.id,
        catalog.a.userId,
        reason,
        1,
        commandId,
        checkoutAudit(),
      );
      expect((await balance(p.id))[0].current_quantity).toBe(
        before[0].current_quantity + 2,
      );
      expect(
        (await OrderService.get(p.id, p.buyer.userId)).events,
      ).toHaveLength(2);
      await expect(
        OrderService.cancelOrder(
          p.id,
          catalog.a.userId,
          reason,
          2,
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
    });
    it("cancelamento em preparo é permitido; pronto para despacho não pode mais cancelar", async () => {
      const a = await paid();
      await transition(a.id, "in_preparation", 1);
      expect(
        (
          await OrderService.cancelOrder(
            a.id,
            catalog.a.userId,
            "Não há qualidade suficiente para enviar.",
            2,
            randomUUID(),
            checkoutAudit(),
          )
        ).status,
      ).toBe("cancelled");
      const b = await paid();
      await transition(b.id, "in_preparation", 1);
      await transition(b.id, "ready_for_dispatch", 2);
      await expect(
        OrderService.cancelOrder(
          b.id,
          catalog.a.userId,
          "Cancelamento depois do preparo encerrado.",
          3,
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
    });
    it("falha após a restituição reverte estoque, evento, revisão e solicitação de reembolso", async () => {
      const p = await paid(),
        before = await balance(p.id),
        real = await pool().connect(),
        query = real.query.bind(real);
      const wrapped = {
        query: (...args: any[]) => {
          if (
            typeof args[0] === "string" &&
            args[0].includes("INSERT INTO public.app_case_history")
          )
            throw new CommerceError("SIMULATED_WRITE_FAILURE", 503);
          return (query as any)(...args);
        },
        release: () => real.release(),
      } as PoolClient;
      vi.spyOn(pool(), "connect").mockResolvedValueOnce(wrapped as any);
      await expect(
        OrderService.cancelOrder(
          p.id,
          catalog.a.userId,
          "Motivo válido para testar o rollback.",
          1,
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "SIMULATED_WRITE_FAILURE" });
      const o = await OrderService.get(p.id, p.buyer.userId);
      expect(o.status).toBe("confirmed");
      expect(o.revision).toBe(1);
      expect(o.events).toHaveLength(1);
      expect(await balance(p.id)).toEqual(before);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_refund_requests WHERE order_id=$1",
            [p.id],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("banco rejeita cancelamento que tente omitir restituição e reembolso", async () => {
      const p = await paid(),
        client = await pool().connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('hvm.order_actor_user_id',$1,true),set_config('hvm.order_actor_role','producer',true),set_config('hvm.order_notes','Motivo válido de cancelamento',true)",
          [catalog.a.userId],
        );
        await client.query(
          "UPDATE app_order_fulfillment SET status='cancelled',revision=2 WHERE order_id=$1",
          [p.id],
        );
        await expect(client.query("COMMIT")).rejects.toThrow(
          "ORDER_STOCK_RETURN_REQUIRED",
        );
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      expect((await OrderService.get(p.id, p.buyer.userId)).status).toBe(
        "confirmed",
      );
    });
    it("reembolso parcial aberto impede cancelamento sem sobrescrever a análise T20", async () => {
      const p = await paid();
      await AfterSalesService.requestRefund(
        p.buyer.userId,
        {
          commandId: randomUUID(),
          orderId: p.id,
          reason: "quality",
          description: "Um item apresentou problema de qualidade.",
          requestedAmountCents: 100,
        },
        checkoutAudit(),
      );
      const before = await balance(p.id);
      await expect(
        OrderService.cancelOrder(
          p.id,
          catalog.a.userId,
          "Pedido será totalmente cancelado no teste.",
          1,
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "ORDER_REFUND_IN_PROGRESS" });
      expect((await OrderService.get(p.id, p.buyer.userId)).status).toBe(
        "confirmed",
      );
      expect(await balance(p.id)).toEqual(before);
    });
    it("recebimento/carência da T20 são preservados e entrega pelo produtor não libera repasse", async () => {
      const p = await paid();
      let revision = 1;
      for (const status of [
        "in_preparation",
        "ready_for_dispatch",
        "out_for_delivery",
        "delivered",
      ] as const)
        await transition(p.id, status, revision++);
      const hold = (
        await pool().query(
          "SELECT release_after,state FROM app_financial_holds WHERE order_id=$1",
          [p.id],
        )
      ).rows[0];
      expect(hold.release_after).toBeNull();
      expect(hold.state).toBe("held");
      await CommerceService.received(
        p.buyer.userId,
        p.id,
        randomUUID(),
        checkoutAudit(),
      );
      const o = await OrderService.get(p.id, p.buyer.userId);
      expect(o.status).toBe("delivered");
      expect(o.commercialStatus).toBe("received");
      expect(o.receivedAt).not.toBeNull();
      const second = await paid();
      await CommerceService.received(
        second.buyer.userId,
        second.id,
        randomUUID(),
        checkoutAudit(),
      );
      expect(
        (await OrderService.get(second.id, catalog.a.userId))
          .allowedTransitions,
      ).not.toContain("cancelled");
      await expect(
        OrderService.cancelOrder(
          second.id,
          catalog.a.userId,
          "Cliente já recebeu os produtos desta compra.",
          1,
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "ORDER_ALREADY_RECEIVED" });
    });
    it("revogação do produtor é revalidada no domínio e deixa pedido/histórico intactos", async () => {
      const p = await paid();
      await pool().query(
        "UPDATE app_user_role_assignments SET revoked_at=clock_timestamp() WHERE user_id=$1 AND role_code='producer'",
        [catalog.a.userId],
      );
      try {
        await expect(
          transition(p.id, "in_preparation", 1),
        ).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
      } finally {
        await pool().query(
          "UPDATE app_user_role_assignments SET revoked_at=NULL WHERE user_id=$1 AND role_code='producer'",
          [catalog.a.userId],
        );
      }
      expect((await OrderService.get(p.id, p.buyer.userId)).revision).toBe(1);
    });
    it("exclusão operacional do produtor conserva compra e fatos imutáveis do cliente", async () => {
      const p = await paid(),
        before = await OrderService.get(p.id, p.buyer.userId);
      await pool().query("DELETE FROM auth.users WHERE id=$1", [
        catalog.a.userId,
      ]);
      const after = await OrderService.get(p.id, p.buyer.userId);
      expect(after.storeName).toBe(before.storeName);
      expect(after.totalCents).toBe(before.totalCents);
      expect(after.items[0].productId).toBeNull();
      expect(after.items[0].unitPriceCents).toBe(
        before.items[0].unitPriceCents,
      );
      expect(after.events).toHaveLength(1);
    });
  },
);
