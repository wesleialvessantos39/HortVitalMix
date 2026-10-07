import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T22_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const u = new URL(value);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55432" ||
    u.pathname !== "/postgres"
  )
    throw Error("T22_LOCAL_DATABASE_REQUIRED");
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
import { dbPool } from "../../server/db/pool.ts";
import { OrderService } from "../../server/services/OrderService.ts";
import { DeliveryLogisticsService as service } from "../../server/services/DeliveryLogisticsService.ts";
import { commerceTransaction } from "../../server/services/CommerceSupport.ts";
import { checkoutCatalog, checkoutAudit } from "../helpers/checkoutFixtures.ts";
import { paidOrder } from "../helpers/paidOrderFixtures.ts";
describe.runIf(!!process.env.HVM_T22_LOCAL_DATABASE_URL)(
  "T22 PostgreSQL: concorrência, prova atômica e isolamento",
  () => {
    const pool = () => dbPool as Pool;
    let catalog: Awaited<ReturnType<typeof checkoutCatalog>>,
      date: string,
      day: number;
    const purchases: Awaited<ReturnType<typeof paidOrder>>[] = [];
    const move = (id: string, toStatus: string, expectedRevision: number) =>
      OrderService.transitionStatus(
        id,
        catalog.a.userId,
        "producer",
        { toStatus, expectedRevision },
        randomUUID(),
        checkoutAudit(),
      );
    async function ready() {
      const p = await paidOrder(pool(), catalog.pa);
      purchases.push(p);
      await move(p.id, "in_preparation", 1);
      await move(p.id, "ready_for_dispatch", 2);
      return p;
    }
    const window = async (
      capacity = 1,
      start = "08:00",
      end = "12:00",
      userId?: string,
    ) =>
      service.saveWindow(
        userId ?? catalog.a.userId,
        null,
        {
          dayOfWeek: day,
          startTime: start,
          endTime: end,
          maxOrdersCapacity: capacity,
          isActive: true,
        },
        randomUUID(),
        checkoutAudit(),
      );
    const allocate = (
      id: string,
      w: string,
      d = date,
      command = randomUUID(),
    ) =>
      service.allocateOrderToWindow(
        id,
        catalog.a.userId,
        { windowId: w, scheduledDate: d, expectedRevision: 3 },
        command,
        checkoutAudit(),
      );
    async function out() {
      const p = await ready(),
        w = await window(15, "13:00", "18:00");
      await allocate(p.id, w.id);
      await move(p.id, "out_for_delivery", 3);
      return p;
    }
    beforeAll(async () => {
      catalog = await checkoutCatalog(pool());
      date = (
        await pool().query(
          "SELECT ((clock_timestamp() AT TIME ZONE timezone)::date+1)::text AS date FROM app_global_config WHERE singleton_guard",
        )
      ).rows[0].date;
      day = new Date(date + "T12:00:00Z").getUTCDay();
    }, 20000);
    afterAll(async () => {
      try {
        for (const p of purchases.reverse()) await p.buyer.cleanup();
        if (catalog) await catalog.cleanup();
      } finally {
        await dbPool?.end();
      }
    }, 20000);
    it("última vaga: duas transações concorrentes resultam em uma alocação e CAPACITY_EXCEEDED", async () => {
      const a = await ready(),
        b = await ready(),
        w = await window();
      const results = await Promise.allSettled([
        allocate(a.id, w.id),
        allocate(b.id, w.id),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
          .reason,
      ).toMatchObject({ code: "CAPACITY_EXCEEDED" });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS n FROM app_delivery_allocations WHERE window_id=$1 AND scheduled_date=$2",
            [w.id, date],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("capacidade por data não pode ser reduzida abaixo das vagas existentes", async () => {
      const p = await ready(),
        q = await ready(),
        w = await window(2, "09:00", "11:00");
      await allocate(p.id, w.id);
      await allocate(q.id, w.id);
      await expect(
        service.saveWindow(
          catalog.a.userId,
          w.id,
          {
            dayOfWeek: day,
            startTime: "09:00",
            endTime: "11:00",
            maxOrdersCapacity: 1,
            isActive: true,
            expectedRevision: 1,
          },
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toMatchObject({ code: "CAPACITY_BELOW_ALLOCATIONS" });
    });
    it("replay do comando não duplica alocação nem auditoria", async () => {
      const p = await ready(),
        w = await window(2, "10:00", "12:00"),
        cmd = randomUUID();
      expect(await allocate(p.id, w.id, date, cmd)).toEqual(
        await allocate(p.id, w.id, date, cmd),
      );
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_delivery_allocations WHERE order_id=$1",
            [p.id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("janela de outra loja é rejeitada", async () => {
      const p = await ready(),
        w = await window(2, "08:00", "12:00", catalog.b.userId);
      await expect(allocate(p.id, w.id)).rejects.toMatchObject({
        code: "WINDOW_UNAVAILABLE",
      });
    });
    it("dia errado e data passada não recebem alocação", async () => {
      const p = await ready(),
        w = await window(2, "14:00", "15:00");
      const bad = (
        await pool().query("SELECT ($1::date+1)::text AS date", [date])
      ).rows[0].date;
      await expect(allocate(p.id, w.id, bad)).rejects.toMatchObject({
        code: "INVALID_DELIVERY_DATE",
      });
      await expect(allocate(p.id, w.id, "2020-01-01")).rejects.toMatchObject({
        code: "INVALID_DELIVERY_DATE",
      });
    });
    it("não sai para entrega sem janela e não entrega sem prova", async () => {
      const p = await ready();
      await expect(move(p.id, "out_for_delivery", 3)).rejects.toMatchObject({
        code: "DELIVERY_ALLOCATION_REQUIRED",
      });
      const w = await window(2, "15:00", "16:00");
      await allocate(p.id, w.id);
      await move(p.id, "out_for_delivery", 3);
      await expect(move(p.id, "delivered", 4)).rejects.toMatchObject({
        code: "DELIVERY_PROOF_REQUIRED",
      });
      expect((await OrderService.get(p.id, p.buyer.userId)).revision).toBe(4);
    });
    it("nome obrigatório e limites de coordenadas são validados antes da gravação", async () => {
      const p = await ready();
      for (const input of [
        { receivedByName: "" },
        { receivedByName: "Alguém", latitude: 91, longitude: 0 },
        { receivedByName: "Alguém", latitude: 0 },
      ])
        await expect(
          service.registerDeliveryProof(
            p.id,
            catalog.a.userId,
            { expectedRevision: 3, ...input },
            randomUUID(),
            checkoutAudit(),
          ),
        ).rejects.toBeDefined();
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_delivery_proofs WHERE order_id=$1",
            [p.id],
          )
        ).rowCount,
      ).toBe(0);
    });
    it("prova, estado e evento são atômicos e idempotentes; documento fica mascarado", async () => {
      const p = await out(),
        cmd = randomUUID(),
        input = {
          expectedRevision: 4,
          receivedByName: "Pessoa recebedora",
          receiverDocumentLastDigits: "123",
          notes: "Recebido na porta",
          latitude: -9.91,
          longitude: -63.04,
        };
      const result = await service.registerDeliveryProof(
        p.id,
        catalog.a.userId,
        input,
        cmd,
        checkoutAudit(),
      );
      expect(result.status).toBe("delivered");
      expect(
        await service.registerDeliveryProof(
          p.id,
          catalog.a.userId,
          input,
          cmd,
          checkoutAudit(),
        ),
      ).toEqual(result);
      const data = await service.tracking(p.id, p.buyer.userId);
      expect(data.proof).toMatchObject({
        receivedByName: "Pessoa recebedora",
        receiverDocumentMasked: "***.***.123-**",
      });
      expect((await service.tracking(p.id, catalog.a.userId)).proof).toBeNull();
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_order_events WHERE order_id=$1",
            [p.id],
          )
        ).rows[0].n,
      ).toBe(5);
    });
    it("falha após INSERT da prova desfaz prova e deixa estado anterior", async () => {
      const p = await ready(),
        w = await window(2, "16:00", "17:00");
      await allocate(p.id, w.id);
      await move(p.id, "out_for_delivery", 3);
      const spy = vi
        .spyOn(OrderService, "transitionStatus")
        .mockRejectedValueOnce(Error("falha controlada"));
      await expect(
        service.registerDeliveryProof(
          p.id,
          catalog.a.userId,
          { expectedRevision: 4, receivedByName: "Recebedor" },
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toBeDefined();
      spy.mockRestore();
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_delivery_proofs WHERE order_id=$1",
            [p.id],
          )
        ).rowCount,
      ).toBe(0);
      expect((await OrderService.get(p.id, p.buyer.userId)).status).toBe(
        "out_for_delivery",
      );
    });
    it("prova solta não pode ser confirmada e prova concluída é imutável", async () => {
      const p = await ready(),
        w = await window(2, "17:00", "18:00");
      await allocate(p.id, w.id);
      await move(p.id, "out_for_delivery", 3);
      await expect(
        commerceTransaction(async (c) => {
          await c.query(
            "SELECT set_config('hvm.order_actor_user_id',$1,true),set_config('hvm.order_actor_role','producer',true)",
            [catalog.a.userId],
          );
          await c.query(
            "INSERT INTO app_delivery_proofs(order_id,received_by_name,recorded_by_user_id) VALUES($1,'Recebedor',$2)",
            [p.id, catalog.a.userId],
          );
        }),
      ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
      await service.registerDeliveryProof(
        p.id,
        catalog.a.userId,
        { expectedRevision: 4, receivedByName: "Recebedor" },
        randomUUID(),
        checkoutAudit(),
      );
      await expect(
        pool().query(
          "UPDATE app_delivery_proofs SET received_by_name='Outra pessoa' WHERE order_id=$1",
          [p.id],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        message: "DELIVERY_RECORD_IMMUTABLE",
      });
    });
    it("RLS: comprador titular lê prova; produtor e terceiro não; clientes sem mutação", async () => {
      const p = purchases[0];
      const delivered = purchases.filter((x) => x.id).at(-1)!;
      const client = await pool().connect();
      try {
        for (const [userId, count] of [
          [delivered.buyer.userId, 1],
          [catalog.a.userId, 0],
          [p.buyer.userId, 0],
        ] as const) {
          await client.query("BEGIN");
          await client.query("SET LOCAL ROLE authenticated");
          await client.query(
            "SELECT set_config('request.jwt.claim.sub',$1,true)",
            [userId],
          );
          expect(
            (
              await client.query(
                "SELECT id FROM app_delivery_proofs WHERE order_id=$1",
                [delivered.id],
              )
            ).rowCount,
          ).toBe(count);
          await client.query("ROLLBACK");
        }
        const checks = (
          await client.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1)",
            [
              [
                "app_delivery_windows",
                "app_delivery_allocations",
                "app_delivery_proofs",
              ],
            ],
          )
        ).rows;
        expect(checks).toHaveLength(3);
        expect(
          checks.every((r) => r.relrowsecurity && r.relforcerowsecurity),
        ).toBe(true);
        expect(
          (
            await client.query(
              "SELECT has_table_privilege('authenticated','app_delivery_proofs','INSERT') permitted",
            )
          ).rows[0].permitted,
        ).toBe(false);
      } finally {
        client.release();
      }
    });
  },
);
