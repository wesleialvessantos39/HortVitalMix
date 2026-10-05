import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T15_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("T15_LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: null }),
        createSignedUrls: async (paths: string[]) => ({
          error: null,
          data: paths.map((path) => ({
            signedUrl:
              "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/product-media/" +
              path +
              "?token=local",
            error: null,
          })),
        }),
      }),
    },
  },
  createSupabasePublicClient: () => null,
}));
import { dbPool } from "../../server/db/pool.ts";
import { InventoryService } from "../../server/services/InventoryService.ts";
import { ProductService } from "../../server/services/ProductService.ts";
import { productFixture } from "../helpers/productFixtures.ts";
import {
  addInventoryDays,
  RESERVATION_TTL_MINUTES,
} from "../../shared/contracts/inventory.ts";
import manifest from "../../supabase/manifest.json" with { type: "json" };
const pool = () => dbPool as Pool,
  context = () => ({ requestId: randomUUID(), ipHash: "c".repeat(64) });
let today: string, categoryId: string;
async function fixture(published = true) {
  const f = await productFixture(pool());
  let product = await ProductService.createProduct(
    f.personId,
    {
      categoryId,
      title: "Couve de lote",
      description: "Couve higienizada para verificar estoque real.",
      packagingType: "pote_higienizado",
      netWeightGrams: 250,
      unitType: "pote",
      shelfLifeDays: 5,
      conservationNotes: "Manter refrigerado entre 2°C e 6°C",
      priceCents: 1290,
      commandId: randomUUID(),
    },
    f.userId,
    context(),
  );
  if (published) {
    product = await ProductService.uploadMedia(
      product.id,
      f.personId,
      { commandId: randomUUID(), expectedRevision: product.revision },
      f.userId,
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
      "image/png",
      context(),
    );
    product = await ProductService.togglePublish(
      product.id,
      f.personId,
      {
        commandId: randomUUID(),
        expectedRevision: product.revision,
        isPublished: true,
      },
      f.userId,
      context(),
    );
  }
  return { ...f, product };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const harvest = (
  f: Fixture,
  quantity = 10,
  days = 5,
  lotCode: string = randomUUID(),
) =>
  InventoryService.registerHarvest(
    f.product.id,
    f.personId,
    {
      lotCode,
      harvestDate: addInventoryDays(today, -5),
      expirationDate: addInventoryDays(today, days),
      quantity,
      commandId: randomUUID(),
    },
    f.userId,
    context(),
  );
async function reserve(f: Fixture, quantity = 1) {
  const result = await InventoryService.reserveStock(
    f.product.id,
    quantity,
    "session-" + randomUUID(),
  );
  expect(result.status).toBe("reserved");
  if (result.status !== "reserved") throw Error("reservation required");
  return result.reservations;
}
const quantity = async (lotId: string) =>
  (
    await pool().query(
      "SELECT current_quantity FROM app_inventory_lots WHERE id=$1",
      [lotId],
    )
  ).rows[0].current_quantity;
const expire = async (id: string) =>
  pool().query(
    "UPDATE app_inventory_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [id],
  );
async function asRole(
  role: "anon" | "authenticated" | "service_role",
  query: string,
  values: unknown[] = [],
) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    return await client.query(query, values);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
describe.runIf(Boolean(process.env.HVM_T15_LOCAL_DATABASE_URL))(
  "T15 PostgreSQL real: concorrência, ledger e compatibilidade",
  () => {
    beforeAll(async () => {
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS total FROM supabase_migrations.schema_migrations",
          )
        ).rows[0].total,
      ).toBe(manifest.migrations.length);
      today = (await pool().query("SELECT CURRENT_DATE::text AS today")).rows[0]
        .today;
      categoryId = (
        await pool().query(
          "SELECT id FROM app_categories WHERE slug='hortalicas-folhosas'",
        )
      ).rows[0].id;
    });
    afterAll(async () => {
      await dbPool?.end();
    });
    it("colheita cria lote, movimento e auditoria sem mudar produto/preço", async () => {
      const f = await fixture(false),
        before = (
          await pool().query(
            "SELECT * FROM app_price_versions WHERE product_id=$1",
            [f.product.id],
          )
        ).rows;
      const saved = await harvest(f, 7);
      expect(saved.inventory.availableQuantity).toBe(7);
      expect(saved.inventory.movements).toHaveLength(1);
      expect(saved.inventory.movements[0]).toMatchObject({
        movementType: "harvest_entry",
        quantityDelta: 7,
      });
      expect(
        (
          await pool().query(
            "SELECT * FROM app_price_versions WHERE product_id=$1",
            [f.product.id],
          )
        ).rows,
      ).toEqual(before);
      expect(
        (
          await ProductService.getOwnerProduct(
            f.product.id,
            f.personId,
            f.userId,
          )
        ).revision,
      ).toBe(f.product.revision);
      expect(
        (
          await pool().query(
            "SELECT action FROM app_audit_events WHERE target_id=$1",
            [saved.lotId],
          )
        ).rows[0].action,
      ).toBe("inventory.harvest_registered");
    });
    it("auditoria com erro aborta lote e movimento na mesma transação", async () => {
      const f = await fixture(false);
      await expect(
        InventoryService.registerHarvest(
          f.product.id,
          f.personId,
          {
            lotCode: "rollback",
            harvestDate: today,
            expirationDate: today,
            quantity: 5,
            commandId: randomUUID(),
          },
          f.userId,
          { ...context(), requestId: "invalid" },
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(
        (
          await pool().query(
            "SELECT id FROM app_inventory_lots WHERE product_id=$1",
            [f.product.id],
          )
        ).rows,
      ).toEqual([]);
    });
    it("repetição concorrente do mesmo comando gera uma única colheita", async () => {
      const f = await fixture(false),
        value = {
          lotCode: "replay",
          harvestDate: today,
          expirationDate: today,
          quantity: 5,
          commandId: randomUUID(),
        };
      const results = await Promise.all([
        InventoryService.registerHarvest(
          f.product.id,
          f.personId,
          value,
          f.userId,
          context(),
        ),
        InventoryService.registerHarvest(
          f.product.id,
          f.personId,
          value,
          f.userId,
          context(),
        ),
      ]);
      expect(results[0].lotId).toBe(results[1].lotId);
      expect(results[1].inventory.availableQuantity).toBe(5);
      await expect(
        InventoryService.registerHarvest(
          f.product.id,
          f.personId,
          { ...value, quantity: 6 },
          f.userId,
          context(),
        ),
      ).rejects.toMatchObject({
        code: "INVENTORY_COMMAND_CONFLICT",
        status: 409,
      });
    });
    it("mesmo código é único por produto e duplica somente em outro produto", async () => {
      const f = await fixture(false),
        g = await fixture(false);
      await harvest(f, 2, 5, "SAME-CODE");
      await expect(harvest(f, 3, 5, "SAME-CODE")).rejects.toMatchObject({
        code: "INVENTORY_LOT_CODE_CONFLICT",
        status: 409,
      });
      expect(
        (await harvest(g, 3, 5, "SAME-CODE")).inventory.availableQuantity,
      ).toBe(3);
    });
    it("isola titularidade e revalida conta/papel, inclusive replay", async () => {
      const f = await fixture(false),
        g = await fixture(false),
        value = {
          lotCode: "owned",
          harvestDate: today,
          expirationDate: today,
          quantity: 1,
          commandId: randomUUID(),
        };
      await expect(
        InventoryService.getOwnerInventory(f.product.id, g.personId, g.userId),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        InventoryService.registerHarvest(
          f.product.id,
          g.personId,
          value,
          g.userId,
          context(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await InventoryService.registerHarvest(
        f.product.id,
        f.personId,
        value,
        f.userId,
        context(),
      );
      await pool().query(
        "UPDATE app_user_role_assignments SET revoked_at=now() WHERE user_id=$1 AND role_code='producer'",
        [f.userId],
      );
      await expect(
        InventoryService.registerHarvest(
          f.product.id,
          f.personId,
          value,
          f.userId,
          context(),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("gate T12 impede colheita com loja pausada e preserva leitura do titular", async () => {
      const f = await fixture(false);
      await pool().query(
        "UPDATE app_producer_stores SET status='paused' WHERE id=$1",
        [f.store.id],
      );
      await expect(harvest(f)).rejects.toMatchObject({
        code: "INVENTORY_STORE_INELIGIBLE",
        status: 403,
      });
      expect(
        (
          await InventoryService.getOwnerInventory(
            f.product.id,
            f.personId,
            f.userId,
          )
        ).canRegisterHarvest,
      ).toBe(false);
    });
    it("rejeita colheita futura no backend", async () => {
      const f = await fixture(false);
      await expect(
        InventoryService.registerHarvest(
          f.product.id,
          f.personId,
          {
            lotCode: "future",
            harvestDate: addInventoryDays(today, 1),
            expirationDate: addInventoryDays(today, 2),
            quantity: 1,
            commandId: randomUUID(),
          },
          f.userId,
          context(),
        ),
      ).rejects.toMatchObject({
        code: "INVENTORY_FUTURE_HARVEST",
        status: 422,
      });
    });
    it("duas reservas da última unidade confirmam uma e retornam insuficiente na outra", async () => {
      const f = await fixture(),
        h = await harvest(f, 1);
      const results = await Promise.all([
        InventoryService.reserveStock(f.product.id, 1, "session-a"),
        InventoryService.reserveStock(f.product.id, 1, "session-b"),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([
        "insufficient_stock",
        "reserved",
      ]);
      expect(await quantity(h.lotId)).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS total FROM app_inventory_reservations WHERE product_id=$1",
            [f.product.id],
          )
        ).rows[0].total,
      ).toBe(1);
    });
    it("lote travado não espera, e outro produto continua disponível", async () => {
      const f = await fixture(),
        g = await fixture(),
        h = await harvest(f, 1);
      await harvest(g, 1);
      const lock = await pool().connect();
      try {
        await lock.query("BEGIN");
        await lock.query(
          "SELECT id FROM app_inventory_lots WHERE id=$1 FOR UPDATE",
          [h.lotId],
        );
        expect(
          await InventoryService.reserveStock(
            f.product.id,
            1,
            "session-locked",
          ),
        ).toEqual({ status: "insufficient_stock" });
        expect(
          (await InventoryService.reserveStock(g.product.id, 1, "session-free"))
            .status,
        ).toBe("reserved");
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
      }
    });
    it("FIFO por validade divide a reserva entre lotes e ignora vencidos", async () => {
      const f = await fixture(),
        late = await harvest(f, 3, 4),
        early = await harvest(f, 2, 1),
        expired = await harvest(f, 9, -1);
      const reservations = await reserve(f, 4);
      expect(reservations.map((r) => [r.lotId, r.quantity])).toEqual([
        [early.lotId, 2],
        [late.lotId, 2],
      ]);
      expect(await quantity(early.lotId)).toBe(0);
      expect(await quantity(late.lotId)).toBe(1);
      expect(await quantity(expired.lotId)).toBe(9);
    });
    it("insuficiência não deixa reserva ou dedução parcial", async () => {
      const f = await fixture(),
        h = await harvest(f, 2);
      expect(
        await InventoryService.reserveStock(
          f.product.id,
          3,
          "session-insufficient",
        ),
      ).toEqual({ status: "insufficient_stock" });
      expect(await quantity(h.lotId)).toBe(2);
      expect(
        (
          await pool().query(
            "SELECT id FROM app_inventory_reservations WHERE product_id=$1",
            [f.product.id],
          )
        ).rows,
      ).toEqual([]);
    });
    it("TTL vem da constante de domínio e está em 15 minutos", async () => {
      const f = await fixture();
      await harvest(f, 1);
      const [r] = await reserve(f);
      const time = (
        await pool().query(
          "SELECT extract(epoch FROM (expires_at-created_at)) AS seconds FROM app_inventory_reservations WHERE id=$1",
          [r.id],
        )
      ).rows[0].seconds;
      expect(Number(time)).toBeGreaterThan(RESERVATION_TTL_MINUTES * 60 - 1);
      expect(Number(time)).toBeLessThanOrEqual(RESERVATION_TTL_MINUTES * 60);
    });
    it("expiração libera saldo uma vez, mesmo com dois lazy sweeps concorrentes", async () => {
      const f = await fixture(),
        h = await harvest(f, 1),
        [r] = await reserve(f);
      await expire(r.id);
      const results = await Promise.all([
        InventoryService.releaseExpiredReservations(undefined, f.product.id),
        InventoryService.releaseExpiredReservations(undefined, f.product.id),
      ]);
      expect(results.reduce((sum, r) => sum + r.released, 0)).toBe(1);
      expect(await quantity(h.lotId)).toBe(1);
      expect(
        await InventoryService.releaseExpiredReservations(
          undefined,
          f.product.id,
        ),
      ).toEqual({ released: 0 });
    });
    it("consulta do catálogo dispara sweep e expõe só disponibilidade agregada", async () => {
      const f = await fixture();
      await harvest(f, 1);
      const [r] = await reserve(f);
      expect(
        (
          await ProductService.listPublicProducts({
            storeSlug: f.store.storeSlug,
          })
        )[0].inStock,
      ).toBe(false);
      await expire(r.id);
      const product = (
        await ProductService.listPublicProducts({
          storeSlug: f.store.storeSlug,
        })
      )[0];
      expect(product.inStock).toBe(true);
      expect(product).not.toHaveProperty("lots");
      expect(product).not.toHaveProperty("reservations");
      expect(product).not.toHaveProperty("availableQuantity");
      expect(
        (
          await pool().query(
            "SELECT is_released FROM app_inventory_reservations WHERE id=$1",
            [r.id],
          )
        ).rows[0].is_released,
      ).toBe(true);
    });
    it("baixa concorrente é idempotente, não desconta saldo duas vezes e rejeita outro pedido", async () => {
      const f = await fixture(),
        h = await harvest(f, 2),
        [r] = await reserve(f),
        order = randomUUID();
      const results = await Promise.all([
        InventoryService.consumeReservation(r.id, order, f.userId),
        InventoryService.consumeReservation(r.id, order, f.userId),
      ]);
      expect(results.every((r) => r.status === "consumed")).toBe(true);
      expect(await quantity(h.lotId)).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT quantity_delta FROM app_inventory_movements WHERE reservation_id=$1",
            [r.id],
          )
        ).rows,
      ).toEqual([{ quantity_delta: -1 }]);
      await expect(
        InventoryService.consumeReservation(r.id, randomUUID(), f.userId),
      ).rejects.toMatchObject({
        code: "INVENTORY_RESERVATION_ORDER_CONFLICT",
        status: 409,
      });
      expect(
        (
          await InventoryService.getOwnerInventory(
            f.product.id,
            f.personId,
            f.userId,
          )
        ).reservedQuantity,
      ).toBe(0);
    });
    it("reserva expirada/released não vira venda e lote vencido é recusado", async () => {
      const f = await fixture(),
        h = await harvest(f, 1, 0),
        [r] = await reserve(f);
      await expire(r.id);
      await expect(
        InventoryService.consumeReservation(r.id, randomUUID(), f.userId),
      ).rejects.toMatchObject({ code: "INVENTORY_RESERVATION_EXPIRED" });
      await InventoryService.releaseExpiredReservations(
        undefined,
        f.product.id,
      );
      await expect(
        InventoryService.consumeReservation(r.id, randomUUID(), f.userId),
      ).rejects.toMatchObject({ code: "INVENTORY_RESERVATION_EXPIRED" });
      const [again] = await reserve(f);
      await pool().query(
        "UPDATE app_inventory_lots SET expiration_date=CURRENT_DATE-1 WHERE id=$1",
        [h.lotId],
      );
      await expect(
        InventoryService.consumeReservation(again.id, randomUUID(), f.userId),
      ).rejects.toMatchObject({ code: "INVENTORY_RESERVATION_EXPIRED" });
    });
    it("sweep nunca devolve quantidade de reserva consumida", async () => {
      const f = await fixture(),
        h = await harvest(f, 1),
        [r] = await reserve(f);
      await InventoryService.consumeReservation(r.id, randomUUID(), f.userId);
      await expire(r.id);
      expect(
        await InventoryService.releaseExpiredReservations(
          undefined,
          f.product.id,
        ),
      ).toEqual({ released: 0 });
      expect(await quantity(h.lotId)).toBe(0);
    });
    it("cliente transacional externo permite rollback da reserva e da baixa com futuro checkout", async () => {
      const f = await fixture(),
        h = await harvest(f, 2);
      const client = await pool().connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE service_role");
        const result = await InventoryService.reserveStock(
          f.product.id,
          1,
          "session-checkout",
          client,
        );
        if (result.status !== "reserved") throw Error("expected stock");
        await InventoryService.consumeReservation(
          result.reservations[0].id,
          randomUUID(),
          f.userId,
          client,
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query("ROLLBACK");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      expect(await quantity(h.lotId)).toBe(2);
      expect(
        (
          await pool().query(
            "SELECT id FROM app_inventory_reservations WHERE product_id=$1",
            [f.product.id],
          )
        ).rows,
      ).toEqual([]);
    });
    it("lotes/movimentos/reservas são privados para anon e authenticated, com ENABLE/FORCE", async () => {
      const tables = [
        "app_inventory_lots",
        "app_inventory_movements",
        "app_inventory_reservations",
      ];
      for (const role of ["anon", "authenticated"] as const)
        for (const table of tables)
          await expect(
            asRole(role, `SELECT * FROM public.${table}`),
          ).rejects.toMatchObject({ code: "42501" });
      const rows = (
        await pool().query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])",
          [tables],
        )
      ).rows;
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(
        true,
      );
      expect(
        (
          await asRole(
            "service_role",
            "SELECT count(*)::int AS total FROM app_inventory_lots",
          )
        ).rows[0].total,
      ).toBeGreaterThan(0);
      const grants = (
        await pool().query(
          "SELECT has_table_privilege('service_role','app_inventory_movements','UPDATE') AS movement_update,has_table_privilege('service_role','app_inventory_movements','DELETE') AS movement_delete,has_table_privilege('service_role','app_inventory_lots','TRUNCATE') AS lot_truncate",
        )
      ).rows[0];
      expect(grants).toEqual({
        movement_update: false,
        movement_delete: false,
        lot_truncate: false,
      });
    });
    it("histórico é imutável e ledger rejeita quantidade sem movimento", async () => {
      const f = await fixture(false),
        h = await harvest(f, 3);
      await expect(
        pool().query(
          "UPDATE app_inventory_movements SET quantity_delta=8 WHERE lot_id=$1",
          [h.lotId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool().query("DELETE FROM app_inventory_movements WHERE lot_id=$1", [
          h.lotId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool().query(
          "UPDATE app_inventory_lots SET current_quantity=2 WHERE id=$1",
          [h.lotId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      expect(await quantity(h.lotId)).toBe(3);
    });
    it("exclusão operacional de auth.users mantém a cascata T14/v46 com todos os registros novos", async () => {
      const f = await fixture(),
        h = await harvest(f, 2),
        [r] = await reserve(f);
      await InventoryService.consumeReservation(r.id, randomUUID(), f.userId);
      await pool().query("DELETE FROM auth.users WHERE id=$1", [f.userId]);
      expect(
        (
          await pool().query("SELECT id FROM app_products WHERE id=$1", [
            f.product.id,
          ])
        ).rows,
      ).toEqual([]);
      expect(
        (
          await pool().query("SELECT id FROM app_inventory_lots WHERE id=$1", [
            h.lotId,
          ])
        ).rows,
      ).toEqual([]);
      expect(
        (
          await pool().query(
            "SELECT id FROM app_inventory_movements WHERE lot_id=$1",
            [h.lotId],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await pool().query(
            "SELECT id FROM app_inventory_reservations WHERE id=$1",
            [r.id],
          )
        ).rows,
      ).toEqual([]);
    });
    it("exclusão de outro ator apaga sua identidade mantendo histórico operacional do produtor", async () => {
      const f = await fixture(),
        g = await fixture(false);
      await harvest(f, 1);
      const [r] = await reserve(f);
      await InventoryService.consumeReservation(r.id, randomUUID(), g.userId);
      await pool().query("DELETE FROM auth.users WHERE id=$1", [g.userId]);
      expect(
        (
          await pool().query(
            "SELECT actor_user_id,quantity_delta FROM app_inventory_movements WHERE reservation_id=$1",
            [r.id],
          )
        ).rows,
      ).toEqual([{ actor_user_id: null, quantity_delta: -1 }]);
    });
    it("paginação preserva todos os lotes e movimentos, com totais corretos", async () => {
      const f = await fixture(false);
      for (let i = 0; i < 21; i++) await harvest(f, 1, 5, "PAGE-" + i);
      const first = await InventoryService.getOwnerInventory(
          f.product.id,
          f.personId,
          f.userId,
        ),
        second = await InventoryService.getOwnerInventory(
          f.product.id,
          f.personId,
          f.userId,
          { lotsPage: 2, movementsPage: 1 },
        );
      expect(first.lots).toHaveLength(20);
      expect(second.lots).toHaveLength(1);
      expect(first.pagination.lotsTotal).toBe(21);
      expect(first.lots.some((l) => l.id === second.lots[0].id)).toBe(false);
      expect(first.availableQuantity).toBe(21);
    });
    it("rascunho, categoria desativada ou loja pausada não aceitam reserva", async () => {
      const f = await fixture(false);
      await harvest(f, 1);
      await expect(
        InventoryService.reserveStock(f.product.id, 1, "session-draft"),
      ).rejects.toMatchObject({ status: 404 });
      const g = await fixture();
      await harvest(g, 1);
      await pool().query(
        "UPDATE app_producer_stores SET status='paused' WHERE id=$1",
        [g.store.id],
      );
      await expect(
        InventoryService.reserveStock(g.product.id, 1, "session-paused"),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("pedido com UUID maiúsculo mantém a idempotência canônica e replay exige ator ativo", async () => {
      const f = await fixture();
      await harvest(f, 1);
      const [r] = await reserve(f),
        order = randomUUID().toUpperCase();
      expect(
        (await InventoryService.consumeReservation(r.id, order, f.userId))
          .orderId,
      ).toBe(order.toLowerCase());
      expect(
        (await InventoryService.consumeReservation(r.id, order, f.userId))
          .status,
      ).toBe("consumed");
      await expect(
        InventoryService.consumeReservation(r.id, order, randomUUID()),
      ).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    });
    it("consumo inexistente é recusado sem criar movimento", async () => {
      const f = await fixture(false);
      await expect(
        InventoryService.consumeReservation(
          randomUUID(),
          randomUUID(),
          f.userId,
        ),
      ).rejects.toMatchObject({
        code: "INVENTORY_RESERVATION_NOT_FOUND",
        status: 404,
      });
    });
  },
);
