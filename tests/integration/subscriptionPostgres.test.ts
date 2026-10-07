import { randomUUID } from "node:crypto";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import type { Pool } from "pg";
const provider = vi.hoisted(() => ({ enabled: true, fail: false, calls: 0 }));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T23_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const u = new URL(value);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55432" ||
    u.pathname !== "/postgres"
  )
    throw Error("T23_LOCAL_DATABASE_REQUIRED");
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
          provider: "t23_isolated_test",
          supportsPlatformRetention: true,
          createPayment: async (input: any) => {
            provider.calls++;
            await new Promise((resolve) => setTimeout(resolve, 25));
            if (provider.fail) throw Error("LOCAL_UNCERTAIN_PROVIDER");
            return {
              reference: "local-" + input.intentId,
              pixCopyPaste: "LOCAL_TEST_ONLY",
              pixQrCodeBase64: null,
              hostedPaymentUrl: null,
            };
          },
        }
      : null,
}));
import { dbPool } from "../../server/db/pool.ts";
import { SubscriptionService as service } from "../../server/services/SubscriptionService.ts";
import {
  PaymentService,
  settleVerifiedPayment,
} from "../../server/services/PaymentService.ts";
import { commerceTransaction } from "../../server/services/CommerceSupport.ts";
import { DeliveryLogisticsService } from "../../server/services/DeliveryLogisticsService.ts";
import {
  checkoutCatalog,
  checkoutBuyer,
  checkoutAudit,
} from "../helpers/checkoutFixtures.ts";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
describe.runIf(!!process.env.HVM_T23_LOCAL_DATABASE_URL)(
  "T23 PostgreSQL: trial, recorrência e cobrança segura",
  () => {
    const pool = () => dbPool as Pool;
    let catalog: Awaited<ReturnType<typeof checkoutCatalog>>,
      windowId: string,
      admin: AdminActorContext;
    const buyers: Array<Awaited<ReturnType<typeof checkoutBuyer>>> = [],
      planIds: string[] = [];
    async function buyer() {
      const b = await checkoutBuyer(pool(), []);
      buyers.push(b);
      return b;
    }
    async function plan(price = 0, audience = "consumer", active = true) {
      const id = randomUUID();
      await pool().query(
        `INSERT INTO app_plans(id,slug,name,target_audience,deliveries_per_week,price_cents,billing_period,description,store_id,is_active) VALUES($1,$2,'Plano sintético T23',$3,$4,$5,'weekly','Exclusivo do banco descartável.',$6,$7)`,
        [
          id,
          "t23-" + id,
          audience,
          audience === "producer" ? 0 : 1,
          price,
          audience === "producer" ? null : catalog.a.store.id,
          active,
        ],
      );
      planIds.push(id);
      return id;
    }
    const input = (
      planId: string,
      b: Awaited<ReturnType<typeof buyer>>,
      overrides = {},
    ) => ({
      planId,
      deliveryAddressId: b.addressId,
      recurrence: {
        dayOfWeek: 2,
        preferredWindowId: windowId,
        basketTemplate: [catalog.pa],
      },
      ...overrides,
    });
    async function subscription(price = 0) {
      const b = await buyer(),
        p = await plan(price),
        s = await service.createSubscription(
          b.userId,
          input(p, b),
          randomUUID(),
          checkoutAudit(),
        );
      return { b, p, s };
    }
    async function bill(
      v: Awaited<ReturnType<typeof subscription>>,
      cycleIndex?: number,
    ) {
      return service.runBillingCycle(
        v.s.id,
        v.b.userId,
        cycleIndex ? { cycleIndex } : {},
        randomUUID(),
        checkoutAudit(),
      );
    }
    async function approve(userId: string, paymentId: string) {
      await PaymentService.acceptPolicy(userId, paymentId, 1, checkoutAudit());
      const row = (
        await pool().query("SELECT * FROM app_payment_intents WHERE id=$1", [
          paymentId,
        ])
      ).rows[0];
      const p = {
        provider: "t23_isolated_test",
        eventId: randomUUID(),
        paymentReference: row.gateway_reference,
        intentId: paymentId,
        status: "approved" as const,
        amountCents: row.amount_cents,
        currency: "BRL" as const,
        method: "pix" as const,
        paidAt: new Date().toISOString(),
      };
      const result = await commerceTransaction((c) =>
        settleVerifiedPayment(c, p, checkoutAudit()),
      );
      return { p, result };
    }
    beforeAll(async () => {
      catalog = await checkoutCatalog(pool());
      windowId = (
        await DeliveryLogisticsService.saveWindow(
          catalog.a.userId,
          null,
          {
            dayOfWeek: 2,
            startTime: "08:00",
            endTime: "12:00",
            maxOrdersCapacity: 15,
            isActive: true,
          },
          randomUUID(),
          checkoutAudit(),
        )
      ).id;
      const person = await buyer(),
        id = randomUUID();
      await pool().query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
        [id, id + "@example.test"],
      );
      await pool().query("UPDATE app_users SET status='active' WHERE id=$1", [
        id,
      ]);
      await pool().query(
        "INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role,email_verified_at) VALUES($1,$2,$3,'platform_super_admin',now())",
        [id, person.personId, id + "@example.test"],
      );
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'platform_super_admin')",
        [id],
      );
      admin = {
        userId: id,
        role: "platform_super_admin",
        isSuperAdmin: true,
        sectors: [],
        sessionIssuedAt: new Date().toISOString(),
      } as AdminActorContext;
    }, 20000);
    beforeEach(() => {
      provider.enabled = true;
      provider.fail = false;
      provider.calls = 0;
    });
    afterAll(async () => {
      try {
        if (admin)
          await pool().query("DELETE FROM auth.users WHERE id=$1", [
            admin.userId,
          ]);
        for (const b of buyers.reverse()) await b.cleanup();
        if (catalog) await catalog.cleanup();
        await pool().query("DELETE FROM app_plans WHERE id=ANY($1::uuid[])", [
          planIds,
        ]);
      } finally {
        await dbPool?.end();
      }
    }, 20000);
    it("trial automático e idempotente mantém o início/fim em reenvios e após recriação do perfil", async () => {
      const b = await buyer(),
        id = randomUUID();
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'producer')",
        [b.userId],
      );
      await pool().query(
        "INSERT INTO app_producer_profiles(id,person_id) VALUES($1,$2)",
        [id, b.personId],
      );
      const first = await service.grantProducerTrial(id, b.userId);
      expect(await service.grantProducerTrial(id, b.userId)).toEqual(first);
      await pool().query("DELETE FROM app_producer_profiles WHERE id=$1", [id]);
      const second = randomUUID();
      await pool().query(
        "INSERT INTO app_producer_profiles(id,person_id) VALUES($1,$2)",
        [second, b.personId],
      );
      expect(await service.grantProducerTrial(second, b.userId)).toEqual(first);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_trial_grants WHERE producer_profile_id=$1",
            [second],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("trial permanece único após erasure e novo cadastro com a mesma identidade", async () => {
      const b = await buyer(),
        profile = randomUUID(),
        cpf = (
          await pool().query(
            "SELECT cpf_normalized FROM app_people WHERE id=$1",
            [b.personId],
          )
        ).rows[0].cpf_normalized;
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'producer')",
        [b.userId],
      );
      await pool().query(
        "INSERT INTO app_producer_profiles(id,person_id) VALUES($1,$2)",
        [profile, b.personId],
      );
      const before = await service.producerTrial(b.userId);
      await b.cleanup();
      const next = await buyer();
      await pool().query(
        "UPDATE app_people SET cpf_normalized=$2,registration_review_pending=false WHERE id=$1",
        [next.personId, cpf],
      );
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'producer')",
        [next.userId],
      );
      await pool().query(
        "INSERT INTO app_producer_profiles(person_id) VALUES($1)",
        [next.personId],
      );
      const after = await service.producerTrial(next.userId);
      expect(after.trial?.startsAt).toBe(before.trial?.startsAt);
      expect(after.trial?.endsAt).toBe(before.trial?.endsAt);
    });
    it("prazo do trial e conversão são imutáveis", async () => {
      const row = (
        await pool().query(
          "SELECT * FROM app_trial_grants WHERE producer_profile_id=$1",
          [catalog.a.profileId],
        )
      ).rows[0];
      await expect(
        pool().query(
          "UPDATE app_trial_grants SET starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day' WHERE id=$1",
          [row.id],
        ),
      ).rejects.toMatchObject({ code: "23514", message: "TRIAL_IMMUTABLE" });
    });
    it("criação idempotente conserva um contrato e uma recorrência", async () => {
      const b = await buyer(),
        p = await plan(),
        cmd = randomUUID(),
        body = input(p, b),
        first = await service.createSubscription(
          b.userId,
          body,
          cmd,
          checkoutAudit(),
        );
      expect(
        await service.createSubscription(b.userId, body, cmd, checkoutAudit()),
      ).toEqual(first);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_recurrence_schedules WHERE subscription_id=$1",
            [first.id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("janela de outra loja, dia incorreto, produto alheio e endereço alheio são recusados", async () => {
      const b = await buyer(),
        other = await buyer(),
        p = await plan();
      await expect(
        service.createSubscription(
          b.userId,
          input(p, b, { deliveryAddressId: other.addressId }),
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "ADDRESS_UNAVAILABLE" });
      for (const recurrence of [
        {
          dayOfWeek: 3,
          preferredWindowId: windowId,
          basketTemplate: [catalog.pa],
        },
        {
          dayOfWeek: 2,
          preferredWindowId: windowId,
          basketTemplate: [catalog.pb],
        },
      ])
        await expect(
          service.createSubscription(
            b.userId,
            input(p, b, { recurrence }),
            randomUUID(),
            checkoutAudit(),
          ),
        ).rejects.toMatchObject({ status: 422 });
      expect((await service.mine(b.userId)).subscriptions).toHaveLength(0);
    });
    it("plano inativo some do catálogo; contratos mantêm snapshot/preço e podem renovar", async () => {
      const v = await subscription();
      await pool().query(
        "UPDATE app_plans SET is_active=false,price_cents=9000 WHERE id=$1",
        [v.p],
      );
      expect(
        (await service.publicPlans("consumer")).plans.some((p) => p.id === v.p),
      ).toBe(false);
      expect(
        (await service.mine(v.b.userId)).subscriptions[0].plan.priceCents,
      ).toBe(0);
      expect((await bill(v)).subscription.cycles[0].amountCents).toBe(0);
      await expect(
        service.createSubscription(
          (await buyer()).userId,
          { planId: v.p },
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "PLAN_UNAVAILABLE" });
    });
    it("pausa dura exatamente 14 dias e não altera cobrança paga nem período corrente", async () => {
      const v = await subscription(),
        charged = await bill(v),
        before = (
          await pool().query("SELECT * FROM app_billing_cycles WHERE id=$1", [
            charged.cycleId,
          ])
        ).rows[0];
      const paused = await service.pauseSubscription(
        v.s.id,
        v.b.userId,
        { expectedRevision: charged.subscription.revision },
        randomUUID(),
        checkoutAudit(),
      );
      expect(paused.status).toBe("paused");
      expect(
        Date.parse(paused.pauseUntil!) - Date.parse(paused.pausedAt!),
      ).toBe(14 * 86400000);
      expect(paused.currentPeriodEnd).toBe(
        charged.subscription.currentPeriodEnd,
      );
      expect(
        (
          await pool().query("SELECT * FROM app_billing_cycles WHERE id=$1", [
            charged.cycleId,
          ])
        ).rows[0],
      ).toEqual(before);
      const resumed = await service.changeSubscription(
        v.b.userId,
        v.s.id,
        "resume",
        { expectedRevision: paused.revision },
        randomUUID(),
        checkoutAudit(),
      );
      await expect(
        service.pauseSubscription(
          v.s.id,
          v.b.userId,
          { expectedRevision: resumed.revision },
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "PAUSE_ALREADY_USED" });
    });
    it("pausa não apaga ou cancela um ciclo já pendente", async () => {
      const v = await subscription(1500),
        b = await bill(v);
      await pool().query(
        "UPDATE app_subscriptions SET status='active' WHERE id=$1",
        [v.s.id],
      );
      const paused = await service.pauseSubscription(
        v.s.id,
        v.b.userId,
        { expectedRevision: b.subscription.revision },
        randomUUID(),
        checkoutAudit(),
      );
      expect(paused.cycles[0].status).toBe("pending");
      expect(paused.cycles[0].paymentIntentId).toBe(b.payment!.id);
      expect(
        (await PaymentService.view(v.b.userId, b.payment!.id)).status,
      ).toBe("pending");
    });
    it("duas chamadas concorrentes do mesmo ciclo criam uma cobrança e uma chamada ao provedor", async () => {
      const v = await subscription(1800),
        results = await Promise.all([bill(v, 1), bill(v, 1)]);
      expect(results[0].cycleId).toBe(results[1].cycleId);
      expect(results[0].payment!.id).toBe(results[1].payment!.id);
      expect(provider.calls).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_billing_cycles WHERE subscription_id=$1 AND cycle_index=1",
            [v.s.id],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_payment_intents WHERE billing_cycle_id=$1",
            [results[0].cycleId],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("Pix do ciclo reutiliza T20, confirmação idempotente ativa assinatura sem pedidos/estoque/holds", async () => {
      const v = await subscription(2000),
        b = await bill(v),
        counts = (
          await pool().query(
            "SELECT (SELECT count(*) FROM app_orders)::int orders,(SELECT count(*) FROM app_financial_holds)::int holds,(SELECT sum(current_quantity) FROM app_inventory_lots)::int stock",
          )
        ).rows[0];
      const a = await approve(v.b.userId, b.payment!.id);
      expect(a.result.orderIds).toEqual([]);
      expect(
        (
          await commerceTransaction((c) =>
            settleVerifiedPayment(c, a.p, checkoutAudit()),
          )
        ).replayed,
      ).toBe(true);
      expect((await service.mine(v.b.userId)).subscriptions[0].status).toBe(
        "active",
      );
      expect(
        (
          await pool().query(
            "SELECT (SELECT count(*) FROM app_orders)::int orders,(SELECT count(*) FROM app_financial_holds)::int holds,(SELECT sum(current_quantity) FROM app_inventory_lots)::int stock",
          )
        ).rows[0],
      ).toEqual(counts);
      expect(
        (await PaymentService.view(v.b.userId, b.payment!.id)).subscriptionId,
      ).toBe(v.s.id);
    });
    it("gateway inativo aborta antes de faturar; nenhum ciclo ou intent fictício", async () => {
      const v = await subscription(1200);
      provider.enabled = false;
      await expect(bill(v)).rejects.toMatchObject({
        code: "GATEWAY_NOT_CONFIGURED",
      });
      expect(
        (await service.mine(v.b.userId)).subscriptions[0].cycles,
      ).toHaveLength(0);
    });
    it("timeout do provedor conserva tentativa durável e nunca cria outra cobrança no retry", async () => {
      const v = await subscription(1200);
      provider.fail = true;
      await expect(bill(v)).rejects.toMatchObject({
        code: "PIX_CREATION_UNCERTAIN",
      });
      provider.fail = false;
      await expect(bill(v)).rejects.toMatchObject({
        code: "PIX_RECONCILIATION_REQUIRED",
      });
      expect(provider.calls).toBe(1);
      const s = (await service.mine(v.b.userId)).subscriptions[0];
      expect(s.cycles).toHaveLength(1);
      expect(s.cycles[0].paymentCreationState).toBe("uncertain");
      expect(s.cycles[0].paymentIntentId).not.toBeNull();
    });
    it("cancelar suspende recorrência/futuros ciclos, conserva a cobrança já faturada", async () => {
      const v = await subscription(1100),
        b = await bill(v),
        s = await service.changeSubscription(
          v.b.userId,
          v.s.id,
          "cancel",
          { expectedRevision: b.subscription.revision },
          randomUUID(),
          checkoutAudit(),
        );
      expect(s.status).toBe("cancelled");
      expect(s.recurrences[0].isActive).toBe(false);
      expect(s.cycles[0].status).toBe("pending");
      expect(
        (await PaymentService.view(v.b.userId, b.payment!.id)).status,
      ).toBe("pending");
      await expect(bill(v)).rejects.toMatchObject({
        code: "SUBSCRIPTION_CANCELLED",
      });
    });
    it("RLS ENABLE/FORCE e SELECT isolam A/B; clientes não têm mutações/helpers", async () => {
      const a = await subscription(),
        b = await subscription();
      const c = await pool().connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE authenticated");
        await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
          a.b.userId,
        ]);
        expect(
          (await c.query("SELECT id FROM app_subscriptions")).rows.map(
            (r) => r.id,
          ),
        ).toEqual([a.s.id]);
        expect(
          (
            await c.query(
              "SELECT id FROM app_recurrence_schedules WHERE subscription_id=$1",
              [b.s.id],
            )
          ).rows,
        ).toHaveLength(0);
        expect(
          (
            await c.query(
              "SELECT id FROM app_billing_cycles WHERE subscription_id=$1",
              [b.s.id],
            )
          ).rows,
        ).toHaveLength(0);
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
      const flags = (
        await pool().query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])",
          [
            [
              "app_plans",
              "app_subscriptions",
              "app_trial_grants",
              "app_recurrence_schedules",
              "app_billing_cycles",
            ],
          ],
        )
      ).rows;
      expect(flags).toHaveLength(5);
      expect(
        flags.every((r) => r.relrowsecurity && r.relforcerowsecurity),
      ).toBe(true);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM information_schema.role_table_grants WHERE grantee IN ('anon','authenticated') AND table_name=ANY($1::text[]) AND privilege_type<>'SELECT'",
            [
              [
                "app_plans",
                "app_subscriptions",
                "app_trial_grants",
                "app_recurrence_schedules",
                "app_billing_cycles",
              ],
            ],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='hvm_subscription_private' AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))",
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("papel/posse são revalidados; consumidor não ganha trial alheio ou muda assinatura B", async () => {
      const v = await subscription(),
        b = await buyer();
      await expect(service.producerTrial(b.userId)).rejects.toMatchObject({
        code: "PRODUCER_REQUIRED",
      });
      await expect(
        service.changeSubscription(
          b.userId,
          v.s.id,
          "cancel",
          { expectedRevision: v.s.revision },
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "SUBSCRIPTION_NOT_FOUND" });
      await pool().query("UPDATE app_users SET status='blocked' WHERE id=$1", [
        v.b.userId,
      ]);
      await expect(service.mine(v.b.userId)).rejects.toMatchObject({
        code: "AUTH_REQUIRED",
      });
    });
    it("produtor tem trial sem endereço, não é cobrado antes do fim, e só pagamento converte", async () => {
      const id = await plan(1000, "producer"),
        s = await service.createSubscription(
          catalog.a.userId,
          { planId: id },
          randomUUID(),
          checkoutAudit(),
        );
      expect(s.status).toBe("trialing");
      expect(s.recurrences).toHaveLength(0);
      await expect(
        service.runBillingCycle(
          s.id,
          catalog.a.userId,
          {},
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "BILLING_NOT_DUE" });
      expect(
        (await service.producerTrial(catalog.a.userId)).trial?.isConverted,
      ).toBe(false);
    });
  it("admin configura/inativa plano com revisão; delegação inexistente é recusada", async () => {
      const body = {
        slug: "admin-" + randomUUID(),
        name: "Plano do operador local",
        targetAudience: "producer",
        deliveriesPerWeek: 0,
        priceCents: 3900,
        billingPeriod: "monthly",
        description: "Benefícios definidos pelo operador no teste",
        storeId: null,
        isActive: true,
      };
      const p = await service.savePlan(
        admin,
        null,
        body,
        randomUUID(),
        checkoutAudit(),
      );
      planIds.push(p.id);
      expect(
        (await service.publicPlans("producer")).plans.some(
          (x) => x.id === p.id,
        ),
      ).toBe(true);
      await service.savePlan(
        admin,
        p.id,
        { plan: { ...body, isActive: false }, expectedRevision: 1 },
        randomUUID(),
        checkoutAudit(),
      );
      await expect(
        service.savePlan(
          admin,
          p.id,
          { plan: body, expectedRevision: 1 },
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      await expect(
        service.adminPlans({ ...admin, userId: catalog.a.userId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("pausa expirada retoma a recorrência e permite uma nova pausa de 14 dias",async()=>{
    const v=await subscription(),b=await bill(v),paused=await service.pauseSubscription(v.s.id,v.b.userId,{expectedRevision:b.subscription.revision},randomUUID(),checkoutAudit());
    await pool().query("UPDATE app_subscriptions SET paused_at=statement_timestamp()-interval '15 days',pause_until=statement_timestamp()-interval '1 day' WHERE id=$1",[v.s.id]);
    const resumed=(await service.mine(v.b.userId)).subscriptions[0];expect(resumed.status).toBe("active");expect(resumed.recurrences[0].isActive).toBe(true);
    expect((await service.pauseSubscription(v.s.id,v.b.userId,{expectedRevision:paused.revision},randomUUID(),checkoutAudit())).status).toBe("paused");
  });
  it("após o trial, apenas a confirmação Pix converte o produtor",async()=>{
    const p=await plan(4900,"producer"),s=await service.createSubscription(catalog.a.userId,{planId:p},randomUUID(),checkoutAudit());
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+31*86400000);
    try{const b=await service.runBillingCycle(s.id,catalog.a.userId,{},randomUUID(),checkoutAudit());expect((await service.producerTrial(catalog.a.userId)).trial?.isConverted).toBe(false);await approve(catalog.a.userId,b.payment!.id);expect((await service.producerTrial(catalog.a.userId)).trial?.isConverted).toBe(true);expect((await service.mine(catalog.a.userId)).subscriptions.find(x=>x.id===s.id)?.status).toBe("active");}finally{vi.useRealTimers();}
  });
    it("exclusão homologada de endereço/conta continua; trial anti-renovação conserva prazo", async () => {
      const v = await subscription();
      await pool().query("DELETE FROM app_user_addresses WHERE id=$1", [
        v.b.addressId,
      ]);
      expect(
        (await service.mine(v.b.userId)).subscriptions[0].recurrences,
      ).toHaveLength(1);
      await v.b.cleanup();
      expect(
        (
          await pool().query("SELECT id FROM app_subscriptions WHERE id=$1", [
            v.s.id,
          ])
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await pool().query(
            "SELECT id FROM app_recurrence_schedules WHERE subscription_id=$1",
            [v.s.id],
          )
        ).rows,
      ).toHaveLength(0);
    });
  },
);
