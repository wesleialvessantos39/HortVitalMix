import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T25_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const u = new URL(value);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55432" ||
    u.pathname !== "/postgres"
  )
    throw Error("T25_LOCAL_DATABASE_REQUIRED");
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
import { OfflineSyncService as sync } from "../../server/services/OfflineSyncService.ts";
import { KpiAggregationService as kpi } from "../../server/services/KpiAggregationService.ts";
import { InventoryService } from "../../server/services/InventoryService.ts";
import { SubscriptionService } from "../../server/services/SubscriptionService.ts";
import {
  PaymentService,
  settleVerifiedPayment,
} from "../../server/services/PaymentService.ts";
import { commerceTransaction } from "../../server/services/CommerceSupport.ts";
import { OrderService } from "../../server/services/OrderService.ts";
import type { SyncCommand } from "../../shared/contracts/offlineSync.ts";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
vi.mock("../../server/payments/gateway.ts", () => ({
  getPaymentGateway: () => ({
    provider: "t25_isolated_test",
    supportsPlatformRetention: true,
    createPayment: async (input: any) => ({
      reference: "local-" + input.intentId,
      pixCopyPaste: "LOCAL_TEST_ONLY",
      pixQrCodeBase64: null,
      hostedPaymentUrl: null,
    }),
  }),
}));
const plans: string[] = [];
const device = "isolated-t25-device";
describe.runIf(!!process.env.HVM_T25_LOCAL_DATABASE_URL)(
  "T25 PostgreSQL real: comandos atômicos, revisões e fatos calculados",
  () => {
    let f: Awaited<ReturnType<typeof reviewFixtures>>,
      root: AdminActorContext,
      today: string;
    const p = () => dbPool as Pool;
    beforeAll(async () => {
      f = await reviewFixtures(p());
      root = await f.admin();
      today = (
        await p().query(
          "select (clock_timestamp() at time zone timezone)::date::text today from app_global_config where singleton_guard",
        )
      ).rows[0].today;
    });
    afterAll(async () => {
      try {
        if (f) await f.cleanup();
        await p().query("DELETE FROM app_kpi_metrics");
        for (const id of plans)
          await p().query("DELETE FROM app_plans WHERE id=$1", [id]);
      } finally {
        await dbPool?.end();
      }
    });
    async function harvest(
      productId: string = f.catalog.pa,
      baseRevision?: number,
      lotCode: string = randomUUID(),
    ): Promise<SyncCommand> {
      const revision =
        baseRevision ??
        (
          await p().query("select revision from app_products where id=$1", [
            productId,
          ])
        ).rows[0]?.revision ??
        1;
      const date = (await p().query("select CURRENT_DATE::text date")).rows[0]
        .date;
      return {
        commandId: randomUUID(),
        commandType: "inventory.harvest",
        baseRevision: revision,
        payload: {
          productId,
          harvest: {
            lotCode,
            harvestDate: date,
            expirationDate: "2027-12-31",
            quantity: 7,
          },
        },
      };
    }
    function transition(
      orderId: string,
      baseRevision = 1,
      toStatus = "in_preparation",
    ): SyncCommand {
      return {
        commandId: randomUUID(),
        commandType: "order.transition",
        baseRevision,
        payload: {
          orderId,
          transition: { expectedRevision: baseRevision, toStatus },
        },
      };
    }
    const run = (
      commands: SyncCommand[],
      uid: string = f.catalog.a.userId,
      d = device,
    ) => sync.reconcileBatch(d, uid, commands, checkoutAudit());
    it("três tabelas ENABLE/FORCE e nenhum SELECT ou DML de clientes", async () => {
      const rows = (
        await p().query(
          "select relname,relrowsecurity,relforcerowsecurity from pg_class where relname=any($1)",
          [
            [
              "app_sync_command_journal",
              "app_kpi_definitions",
              "app_kpi_metrics",
            ],
          ],
        )
      ).rows;
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(
        true,
      );
      const c = await p().connect();
      try {
        for (const role of ["anon", "authenticated"])
          for (const table of rows) {
            await c.query("BEGIN");
            await c.query("SET LOCAL ROLE " + role);
            await expect(
              c.query("select * from public." + table.relname),
            ).rejects.toMatchObject({ code: "42501" });
            await c.query("ROLLBACK");
          }
      } finally {
        c.release();
      }
    });
    it("colheita aceita, reenvio concorrente não duplica lote, movimento, auditoria ou notificação", async () => {
      const command = await harvest(),
        before = (
          await p().query("select count(*)::int n from app_notifications")
        ).rows[0].n;
      const [a, b] = await Promise.all([run([command]), run([command])]);
      expect(a).toEqual(b);
      expect(a.results[0].status).toBe("confirmed");
      expect(
        (
          await p().query(
            "select count(*)::int n from app_inventory_lots where lot_code=$1",
            [(command.payload.harvest as any).lotCode],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await p().query(
            "select count(*)::int n from app_audit_events where command_id=$1",
            [command.commandId],
          )
        ).rows[0].n,
      ).toBe(1);
      const notices = (
        await p().query("select count(*)::int n from app_notifications")
      ).rows[0].n;
      expect(notices).toBeGreaterThanOrEqual(before);
      await run([command]);
      expect(
        (await p().query("select count(*)::int n from app_notifications"))
          .rows[0].n,
      ).toBe(notices);
    });
    it("itens sequenciais do mesmo pedido usam a revisão resultante na ordem enviada", async () => {
      const paid = await f.paid(),
        a = transition(paid.id),
        b = transition(paid.id, 2, "ready_for_dispatch");
      const r = await run([a, b]);
      expect(r.results.map((v) => [v.status, v.revision])).toEqual([
        ["confirmed", 2],
        ["confirmed", 3],
      ]);
      expect(
        (await OrderService.get(paid.id, f.catalog.a.userId, "producer"))
          .status,
      ).toBe("ready_for_dispatch");
    });
    it("cancelamento em outra sessão gera conflito sem impedir a colheita seguinte", async () => {
      const paid = await f.paid(),
        command = transition(paid.id);
      await OrderService.cancelOrder(
        paid.id,
        f.catalog.a.userId,
        "Cancelamento sintético isolado",
        1,
        randomUUID(),
        checkoutAudit(),
      );
      const r = await run([command, await harvest()]);
      expect(r.results[0]).toMatchObject({
        status: "conflict",
        code: "REVISION_CONFLICT",
        conflictDetails: { revision: 2, status: "cancelled" },
      });
      expect(r.results[1].status).toBe("confirmed");
      expect(await run([command])).toEqual({ results: [r.results[0]] });
    });
    it("produto atualizado gera conflito e não lança quantidade ou lote", async () => {
      const command = await harvest();
      await p().query(
        "update app_products set revision=revision+1 where id=$1",
        [f.catalog.pa],
      );
      const r = await run([command]);
      expect(r.results[0]).toMatchObject({
        status: "conflict",
        conflictDetails: { title: expect.any(String) },
      });
      expect(
        (
          await p().query(
            "select count(*)::int n from app_inventory_lots where lot_code=$1",
            [(command.payload.harvest as any).lotCode],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("pedido inexistente ou de outra loja é rejeitado sem detalhes privados", async () => {
      const paid = await f.paid();
      for (const id of [randomUUID(), paid.id]) {
        const r = await run([transition(id)], f.catalog.b.userId);
        expect(r.results[0]).toMatchObject({
          status: "rejected",
          code: "ORDER_NOT_FOUND",
          conflictDetails: null,
        });
      }
    });
    it("commandId não pode trocar ator, dispositivo, payload ou revisão", async () => {
      const command = await harvest();
      await run([command]);
      for (const [commands, uid, d] of [
        [[command], f.catalog.b.userId, device],
        [[command], f.catalog.a.userId, "other-t25-device"],
        [
          [{ ...command, baseRevision: command.baseRevision + 1 }],
          f.catalog.a.userId,
          device,
        ],
      ] as [SyncCommand[], string, string][])
        expect((await run(commands, uid, d)).results[0]).toMatchObject({
          status: "rejected",
          code: "COMMAND_REUSED",
          conflictDetails: null,
        });
    });
    it("payload inválido e tipo fora da lista são rejeitados por item", async () => {
      const a = await harvest(),
        b = await harvest();
      a.payload = {};
      b.commandType = "payment.approve";
      expect(
        (await run([a, b, await harvest()])).results.map((v) => v.status),
      ).toEqual(["rejected", "rejected", "confirmed"]);
    });
    it("regra de esteira preservada e falha não deixa evento/estoque confirmado", async () => {
      const paid = await f.paid(),
        command = transition(paid.id, 1, "delivered");
      const r = await run([command]);
      expect(r.results[0]).toMatchObject({
        status: "rejected",
        code: "ILLEGAL_TRANSITION",
      });
      expect(
        (await OrderService.get(paid.id, f.catalog.a.userId, "producer"))
          .events,
      ).toHaveLength(1);
    });
    it("prova de entrega offline mantém T22 e confirmação única", async () => {
      const paid = await f.paid();
      await f.advance(paid, "out_for_delivery");
      const command: SyncCommand = {
        commandId: randomUUID(),
        commandType: "delivery.proof",
        baseRevision: 4,
        payload: {
          orderId: paid.id,
          proof: {
            expectedRevision: 4,
            receivedByName: "Recebedor sintético offline",
          },
        },
      };
      const r = await run([command]);
      expect(r.results[0]).toMatchObject({ status: "confirmed", revision: 5 });
      expect(await run([command])).toEqual(r);
      expect(
        (
          await p().query(
            "select count(*)::int n from app_delivery_proofs where order_id=$1",
            [paid.id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("resposta online perdida é reconhecida pelo recibo anterior", async () => {
      const paid = await f.paid(),
        command = transition(paid.id);
      await OrderService.transitionStatus(
        paid.id,
        f.catalog.a.userId,
        "producer",
        command.payload.transition,
        command.commandId,
        checkoutAudit(),
      );
      expect((await run([command])).results[0]).toMatchObject({
        status: "confirmed",
        revision: 2,
      });
      const h = await harvest();
      await InventoryService.registerHarvest(
        f.catalog.pa,
        f.catalog.a.personId,
        { ...(h.payload.harvest as any), commandId: h.commandId },
        f.catalog.a.userId,
        checkoutAudit(),
      );
      expect((await run([h])).results[0].status).toBe("confirmed");
    });
    it("restrição de lote único reverte a ação, preservando o restante do lote", async () => {
      const a = await harvest(),
        b = await harvest(
          f.catalog.pa,
          undefined,
          (a.payload.harvest as any).lotCode,
        );
      expect(
        (await run([a, b, await harvest()])).results.map((v) => v.status),
      ).toEqual(["confirmed", "rejected", "confirmed"]);
    });
    it("revogação real do papel impede a aplicação mesmo com fila antiga", async () => {
      const command = await harvest(f.catalog.pb);
      await p().query(
        "update app_user_role_assignments set revoked_at=clock_timestamp() where user_id=$1 and role_code='producer'",
        [f.catalog.b.userId],
      );
      await expect(run([command], f.catalog.b.userId)).rejects.toMatchObject({
        status: 401,
      });
      expect(
        (
          await p().query(
            "select count(*)::int n from app_sync_command_journal where command_id=$1",
            [command.commandId],
          )
        ).rows[0].n,
      ).toBe(0);
      await p().query(
        "update app_user_role_assignments set revoked_at=null where user_id=$1 and role_code='producer'",
        [f.catalog.b.userId],
      );
    });
    it("journal é imutável e exclusão operacional da conta continua possível", async () => {
      const command = await harvest();
      await run([command]);
      await expect(
        p().query(
          "update app_sync_command_journal set execution_status='rejected' where command_id=$1",
          [command.commandId],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        message: "SYNC_JOURNAL_IMMUTABLE",
      });
      await expect(
        p().query("delete from app_sync_command_journal where command_id=$1", [
          command.commandId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("KPIs seguem fatos de entrega, valores e lojas, com upsert determinístico", async () => {
      await f.delivered();
      await f.delivered([f.catalog.pb], f.catalog.b.userId);
      await kpi.calculateDailyKpis(today, root, checkoutAudit());
      const first = await kpi.dashboard(root, {
        startDate: today,
        endDate: today,
      });
      const expected = (
        await p().query(
          "select sum(o.total_cents)::float8 gmv,count(*)::int orders,count(distinct o.store_id)::int producers from app_orders o join app_order_fulfillment f on f.order_id=o.id where f.status='delivered'",
        )
      ).rows[0];
      const v = (code: string) =>
        first.metrics.find((m) => m.code === code)!.value;
      expect(v("gmv_cents")).toBe(expected.gmv);
      expect(v("delivered_orders")).toBe(expected.orders);
      expect(v("avg_ticket_cents")).toBeCloseTo(
        expected.gmv / expected.orders,
        2,
      );
      expect(v("active_producers")).toBe(expected.producers);
      const ids = (
        await p().query(
          "select id from app_kpi_metrics where reference_date=$1 order by id",
          [today],
        )
      ).rows;
      await kpi.calculateDailyKpis(today, root, checkoutAudit());
      const second = await kpi.dashboard(root, {
        startDate: today,
        endDate: today,
      });
      expect(second.metrics.map(({ calculatedAt, ...m }) => m)).toEqual(
        first.metrics.map(({ calculatedAt, ...m }) => m),
      );
      expect(
        (
          await p().query(
            "select id from app_kpi_metrics where reference_date=$1 order by id",
            [today],
          )
        ).rows,
      ).toEqual(ids);
      expect(second.metrics).toHaveLength(8);
    });
    it("GET lê somente fatos pré-calculados até o próximo cálculo explícito", async () => {
      const before = await kpi.dashboard(root, {
        startDate: today,
        endDate: today,
      });
      await f.delivered();
      expect(
        await kpi.dashboard(root, { startDate: today, endDate: today }),
      ).toEqual(before);
      await kpi.calculateDailyKpis(today, root, checkoutAudit());
      expect(
        (
          await kpi.dashboard(root, { startDate: today, endDate: today })
        ).metrics.find((m) => m.code === "delivered_orders")!.value,
      ).toBe(
        before.metrics.find((m) => m.code === "delivered_orders")!.value + 1,
      );
    });
    it("conversão conta cotações únicas e assinatura paga não infla GMV de alimentos", async () => {
      const id = randomUUID();
      plans.push(id);
      await p().query(
        "INSERT INTO app_plans(id,slug,name,target_audience,deliveries_per_week,price_cents,billing_period,description,store_id,is_active) VALUES($1,$2,'Plano sintético T25','producer',0,1200,'monthly','Somente no banco descartável.',null,true)",
        [id, "t25-" + id],
      );
      const uid = f.catalog.a.userId,
        subscription = await SubscriptionService.createSubscription(
          uid,
          { planId: id },
          randomUUID(),
          checkoutAudit(),
        );
      await p().query(
        "UPDATE app_subscriptions SET current_period_start=clock_timestamp()-interval '31 days',current_period_end=clock_timestamp()-interval '1 minute' WHERE id=$1",
        [subscription.id],
      );
      const billed = await SubscriptionService.runBillingCycle(
        subscription.id,
        uid,
        {},
        randomUUID(),
        checkoutAudit(),
      );
      await PaymentService.acceptPolicy(
        uid,
        billed.payment!.id,
        1,
        checkoutAudit(),
      );
      const row = (
        await p().query("SELECT * FROM app_payment_intents WHERE id=$1", [
          billed.payment!.id,
        ])
      ).rows[0];
      await commerceTransaction((c) =>
        settleVerifiedPayment(
          c,
          {
            provider: "t25_isolated_test",
            eventId: randomUUID(),
            paymentReference: row.gateway_reference,
            intentId: row.id,
            status: "approved",
            amountCents: 1200,
            currency: "BRL",
            method: "pix",
            paidAt: new Date().toISOString(),
          },
          checkoutAudit(),
        ),
      );
      await kpi.calculateDailyKpis(today, root, checkoutAudit());
      const dashboard = await kpi.dashboard(root, {
        startDate: today,
        endDate: today,
      });
      const value = (code: string) =>
        dashboard.metrics.find((m) => m.code === code)!.value;
      expect(value("subscription_revenue_cents")).toBe(1200);
      expect(value("gmv_cents")).toBe(
        (
          await p().query(
            "SELECT sum(o.total_cents)::float8 n FROM app_orders o JOIN app_order_fulfillment f ON f.order_id=o.id WHERE f.status='delivered'",
          )
        ).rows[0].n,
      );
      const quotes = (
        await p().query(
          "SELECT count(*)::int n,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM app_payment_intents i WHERE i.quote_id=q.id AND i.status IN ('approved','refunded')))::int converted FROM app_checkout_quotes q",
        )
      ).rows[0];
      expect(value("checkout_quotes")).toBe(quotes.n);
      expect(value("converted_quotes")).toBe(quotes.converted);
      expect(value("conversion_rate")).toBeCloseTo(
        (quotes.converted * 100) / quotes.n,
        2,
      );
    });
    it("dia vazio é zero; futuro rejeitado; Admin setorial e Super revogado não acessam", async () => {
      await kpi.calculateDailyKpis("2000-01-01", root, checkoutAudit());
      expect(
        (
          await kpi.dashboard(root, {
            startDate: "2000-01-01",
            endDate: "2000-01-01",
          })
        ).metrics.every((m) => m.value === 0),
      ).toBe(true);
      await expect(
        kpi.calculateDailyKpis("2099-01-01", root, checkoutAudit()),
      ).rejects.toMatchObject({ code: "KPI_FUTURE_DATE" });
      const admin = await f.admin("platform_admin", true);
      await expect(
        kpi.dashboard(admin, { startDate: today, endDate: today }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await p().query(
        "update app_user_role_assignments set revoked_at=now() where user_id=$1",
        [root.userId],
      );
      await expect(
        kpi.dashboard(root, { startDate: today, endDate: today }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  },
);
