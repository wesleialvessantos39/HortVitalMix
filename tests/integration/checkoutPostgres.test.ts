import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T19_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const u = new URL(value);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55432" ||
    u.pathname !== "/postgres"
  )
    throw Error("T19_LOCAL_DATABASE_REQUIRED");
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
import { CartService } from "../../server/services/CartService.ts";
import { ProductService } from "../../server/services/ProductService.ts";
import { DeliveryQuoteService } from "../../server/services/DeliveryQuoteService.ts";
import { InventoryService } from "../../server/services/InventoryService.ts";
import {
  checkoutAudit,
  checkoutBuyer,
  checkoutCatalog,
} from "../helpers/checkoutFixtures.ts";
type Buyer = Awaited<ReturnType<typeof checkoutBuyer>>;
describe.runIf(!!process.env.HVM_T19_LOCAL_DATABASE_URL)(
  "T19 PostgreSQL real: atomicidade e idempotência",
  () => {
    const pool = () => dbPool as Pool;
    let catalog: Awaited<ReturnType<typeof checkoutCatalog>>;
    const buyers: Buyer[] = [];
    const buyer = async (products?: string[], quantity = 2) => {
      const b = await checkoutBuyer(
        pool(),
        products ?? [catalog.pa, catalog.pb],
        quantity,
      );
      buyers.push(b);
      return b;
    };
    const quote = (b: Buyer) =>
      CheckoutService.createQuote(
        b.userId,
        b.cartId,
        b.addressId,
        checkoutAudit(),
      );
    const confirm = (
      b: Buyer,
      quoteId: string,
      commandId: string = randomUUID(),
      paymentMethod: "pix" | "credit_card" = "pix",
    ) =>
      CheckoutService.confirmCheckout(
        commandId,
        { quoteId, paymentMethod },
        b.userId,
        checkoutAudit(),
      );
    async function inventory() {
      return (
        await pool().query(
          "SELECT product_id,sum(current_quantity)::int AS quantity FROM app_inventory_lots WHERE product_id=ANY($1::uuid[]) GROUP BY product_id ORDER BY product_id",
          [[catalog.pa, catalog.pb, catalog.low]],
        )
      ).rows;
    }
    beforeAll(async () => {
      catalog = await checkoutCatalog(pool());
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      for (const b of buyers.splice(0)) await b.cleanup();
    });
    afterAll(async () => {
      try {
        if (catalog) await catalog.cleanup();
      } finally {
        await dbPool?.end();
      }
    });
    it("congela duas lojas, endereço, versões e frete sem reservar na criação", async () => {
      const b = await buyer(),
        before = await inventory(),
        q = await quote(b);
      expect(q.stores).toHaveLength(2);
      expect(q.subtotalCents).toBe(3200);
      expect(q.totalCents).toBe(q.subtotalCents + q.deliveryFeeCents);
      expect(q.addressSnapshot.street).toBe("Rua Sintética T19");
      expect(Date.parse(q.expiresAt) - Date.parse(q.createdAt)).toBe(900000);
      expect(q.isConsumed).toBe(false);
      expect(
        q.stores.every((s) =>
          s.items.every((i) => i.priceVersionId && i.imageUrl),
        ),
      ).toBe(true);
      expect(await inventory()).toEqual(before);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_inventory_reservations WHERE cart_session_id=$1",
            ["checkout_" + q.id],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("dez confirmações paralelas do mesmo comando têm body/código idênticos e um intent", async () => {
      const b = await buyer(),
        q = await quote(b),
        id = randomUUID();
      const all = await Promise.all(
        Array.from({ length: 10 }, () => confirm(b, q.id, id)),
      );
      for (const r of all) {
        expect(r.statusCode).toBe(201);
        expect(r.body).toEqual(all[0].body);
        expect(JSON.stringify(r.body)).toBe(JSON.stringify(all[0].body));
      }
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_payment_intents WHERE quote_id=$1",
            [q.id],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_command_receipts WHERE command_id=$1",
            [id],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT sum(quantity)::int n FROM app_inventory_reservations WHERE cart_session_id=$1",
            ["checkout_" + q.id],
          )
        ).rows[0].n,
      ).toBe(4);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_audit_events WHERE action='checkout.confirmed' AND command_id=$1",
            [id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("mesmo ID com outro método retorna 409 sem outro débito", async () => {
      const b = await buyer(),
        q = await quote(b),
        id = randomUUID();
      await confirm(b, q.id, id);
      const before = await inventory();
      await expect(confirm(b, q.id, id, "credit_card")).rejects.toMatchObject({
        status: 409,
        code: "COMMAND_ID_REUSED_DIFFERENT_PAYLOAD",
      });
      expect(await inventory()).toEqual(before);
    });
    it("duas chaves diferentes para a mesma cotação geram só uma confirmação", async () => {
      const b = await buyer(),
        q = await quote(b);
      const outcomes = await Promise.allSettled([
        confirm(b, q.id),
        confirm(b, q.id),
      ]);
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      expect(
        (outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult)
          .reason,
      ).toMatchObject({ status: 410 });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_payment_intents WHERE quote_id=$1",
            [q.id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("cotação expirada retorna 410 sem estoque, intent ou recibo", async () => {
      const b = await buyer(),
        q = await quote(b),
        id = randomUUID();
      const expired = (
        await pool().query<{ id: string }>(
          `INSERT INTO app_checkout_quotes(user_id,person_id,cart_id,delivery_address_id,cart_fingerprint,address_snapshot,items_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at,expires_at)
      SELECT user_id,person_id,cart_id,delivery_address_id,cart_fingerprint,address_snapshot,items_snapshot,subtotal_cents,delivery_fee_cents,total_cents,clock_timestamp()-interval '16 minutes',clock_timestamp()-interval '2 minutes' FROM app_checkout_quotes WHERE id=$1 RETURNING id`,
          [q.id],
        )
      ).rows[0].id;
      const before = await inventory();
      await expect(confirm(b, expired, id)).rejects.toMatchObject({
        status: 410,
        code: "CHECKOUT_QUOTE_EXPIRED",
      });
      expect(await inventory()).toEqual(before);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_command_receipts WHERE command_id=$1",
            [id],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("expiração enquanto aguarda trava reverte todas as reservas", async () => {
      const b = await buyer(),
        q = await quote(b),
        before = await inventory();
      const near = (
        await pool().query<{ id: string }>(
          `WITH stamp AS (SELECT clock_timestamp() ts)
        INSERT INTO app_checkout_quotes(user_id,person_id,cart_id,delivery_address_id,cart_fingerprint,address_snapshot,items_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at,expires_at)
        SELECT user_id,person_id,cart_id,delivery_address_id,cart_fingerprint,address_snapshot,items_snapshot,subtotal_cents,delivery_fee_cents,total_cents,ts,ts+interval '1 second' FROM app_checkout_quotes,stamp WHERE id=$1 RETURNING id`,
          [q.id],
        )
      ).rows[0].id;
      const c = await pool().connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT id FROM app_products WHERE id=$1 FOR UPDATE", [
          catalog.pa,
        ]);
        const pending = confirm(b, near).then(
          () => ({ ok: true as const }),
          (e) => ({ ok: false as const, error: e }),
        );
        await new Promise((done) => setTimeout(done, 1250));
        await c.query("ROLLBACK");
        const outcome = await pending;
        expect(outcome.ok).toBe(false);
        if (!outcome.ok)
          expect(outcome.error).toMatchObject({
            status: 410,
            code: "CHECKOUT_QUOTE_EXPIRED",
          });
        expect(await inventory()).toEqual(before);
        expect(
          (
            await pool().query(
              "SELECT count(*)::int n FROM app_inventory_reservations WHERE cart_session_id=$1",
              ["checkout_" + near],
            )
          ).rows[0].n,
        ).toBe(0);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
    it("preço alterado depois da cotação é congelado até a confirmação", async () => {
      const b = await buyer(),
        q = await quote(b);
      const price = q.stores
        .flatMap((s) => s.items)
        .find((i) => i.productId === catalog.pa)!.unitPriceCents;
      try {
        await ProductService.updatePrice(
          catalog.pa,
          catalog.a.personId,
          {
            commandId: randomUUID(),
            expectedRevision: (
              await pool().query(
                "SELECT revision FROM app_products WHERE id=$1",
                [catalog.pa],
              )
            ).rows[0].revision,
            newPriceCents: 1100,
          },
          catalog.a.userId,
          checkoutAudit(),
        );
        const reread = await CheckoutService.getQuote(b.userId, q.id);
        expect(
          reread.stores
            .flatMap((s) => s.items)
            .find((i) => i.productId === catalog.pa)!.unitPriceCents,
        ).toBe(price);
        const r = await confirm(b, q.id);
        expect(r.body.totalCents).toBe(q.totalCents);
      } finally {
        await ProductService.updatePrice(
          catalog.pa,
          catalog.a.personId,
          {
            commandId: randomUUID(),
            expectedRevision: (
              await pool().query(
                "SELECT revision FROM app_products WHERE id=$1",
                [catalog.pa],
              )
            ).rows[0].revision,
            newPriceCents: 700,
          },
          catalog.a.userId,
          checkoutAudit(),
        );
      }
    });
    it("preço futuro não entra na cotação atual", async () => {
      const b = await buyer();
      await pool().query(
        "INSERT INTO app_price_versions(product_id,price_cents,created_by_user_id,valid_from) VALUES($1,9999,$2,clock_timestamp()+interval '1 day')",
        [catalog.pa, catalog.a.userId],
      );
      const q = await quote(b);
      expect(
        q.stores
          .flatMap((s) => s.items)
          .find((i) => i.productId === catalog.pa)!.unitPriceCents,
      ).toBe(700);
      // T14 price history remains append-only; fixture teardown cascades the product.
    });
    it("snapshots e recibo resistem a alteração direta", async () => {
      const b = await buyer(),
        q = await quote(b),
        r = await confirm(b, q.id);
      await expect(
        pool().query(
          "UPDATE app_checkout_quotes SET address_snapshot='{}' WHERE id=$1",
          [q.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool().query(
          "UPDATE app_command_receipts SET response_body='{}' WHERE command_id=$1",
          [r.body.commandId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool().query("DELETE FROM app_command_receipts WHERE command_id=$1", [
          r.body.commandId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        await CheckoutService.getConfirmation(b.userId, r.body.commandId),
      ).toEqual(r.body);
    });
    it("falta de estoque na segunda loja reverte inclusive a primeira reserva", async () => {
      const b = await buyer([catalog.pa, catalog.low]),
        q = await quote(b),
        before = await inventory(),
        id = randomUUID();
      await expect(confirm(b, q.id, id)).rejects.toMatchObject({
        status: 409,
        code: "CHECKOUT_INSUFFICIENT_STOCK",
      });
      expect(await inventory()).toEqual(before);
      expect(
        (
          await pool().query(
            "SELECT is_consumed FROM app_checkout_quotes WHERE id=$1",
            [q.id],
          )
        ).rows[0].is_consumed,
      ).toBe(false);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_inventory_reservations WHERE cart_session_id=$1",
            ["checkout_" + q.id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_payment_intents WHERE quote_id=$1",
            [q.id],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("falha ao persistir o recibo reverte intent, cotação e estoque", async () => {
      const b = await buyer(),
        q = await quote(b),
        before = await inventory(),
        id = randomUUID();
      await pool().query(
        "ALTER TABLE app_command_receipts ADD CONSTRAINT t19_test_persistence_failure CHECK(status_code<>201)",
      );
      try {
        await expect(confirm(b, q.id, id)).rejects.toMatchObject({
          status: 503,
        });
      } finally {
        await pool().query(
          "ALTER TABLE app_command_receipts DROP CONSTRAINT t19_test_persistence_failure",
        );
      }
      expect(await inventory()).toEqual(before);
      expect(
        (
          await pool().query(
            "SELECT is_consumed FROM app_checkout_quotes WHERE id=$1",
            [q.id],
          )
        ).rows[0].is_consumed,
      ).toBe(false);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_payment_intents WHERE quote_id=$1",
            [q.id],
          )
        ).rows[0].n,
      ).toBe(0);
      const retry = await confirm(b, q.id, id);
      expect(retry.statusCode).toBe(201);
    });
    it("alteração da cesta exige nova cotação", async () => {
      const b = await buyer(),
        q = await quote(b);
      await CartService.addItem(
        { sessionId: b.sessionId, userId: b.userId },
        { productId: catalog.pa, quantity: 1, commandId: randomUUID() },
        checkoutAudit(),
      );
      await expect(confirm(b, q.id)).rejects.toMatchObject({
        status: 409,
        code: "CHECKOUT_VALUES_CHANGED",
      });
      const next = await quote(b);
      expect(next.id).not.toBe(q.id);
      expect(next.subtotalCents).toBe(q.subtotalCents + 700);
      expect((await confirm(b, next.id)).statusCode).toBe(201);
    });
    it("mudar o endereço não regrava o snapshot e exige recálculo", async () => {
      const b = await buyer(),
        q = await quote(b);
      await pool().query(
        "UPDATE app_user_addresses SET number='11' WHERE id=$1",
        [b.addressId],
      );
      expect(
        (await CheckoutService.getQuote(b.userId, q.id)).addressSnapshot.number,
      ).toBe("10");
      await expect(confirm(b, q.id)).rejects.toMatchObject({
        status: 409,
        code: "CHECKOUT_VALUES_CHANGED",
      });
    });
    it("alteração de frete rejeita consumo da cotação anterior", async () => {
      const b = await buyer(),
        q = await quote(b),
        f = catalog.a;
      const before = await DeliveryQuoteService.getOwnerSettings(
        f.personId,
        f.userId,
      );
      try {
        await DeliveryQuoteService.saveOwnerSettings(
          f.personId,
          f.userId,
          {
            commandId: randomUUID(),
            expectedRevision: before.revision,
            radiusKm: 50,
            isActive: true,
            rules: { ...before.rules, baseFeeCents: 1000 },
          },
          checkoutAudit(),
        );
        await expect(confirm(b, q.id)).rejects.toMatchObject({
          status: 409,
          code: "CHECKOUT_VALUES_CHANGED",
        });
        expect(
          (await CheckoutService.getQuote(b.userId, q.id)).deliveryFeeCents,
        ).toBe(q.deliveryFeeCents);
      } finally {
        const current = await DeliveryQuoteService.getOwnerSettings(
          f.personId,
          f.userId,
        );
        await DeliveryQuoteService.saveOwnerSettings(
          f.personId,
          f.userId,
          {
            commandId: randomUUID(),
            expectedRevision: current.revision,
            radiusKm: 50,
            isActive: true,
            rules: before.rules,
          },
          checkoutAudit(),
        );
      }
    });
    it("mínimo por loja e endereço fora da área são rejeitados atomicamente", async () => {
      const b = await buyer([catalog.pa], 1);
      await expect(quote(b)).rejects.toMatchObject({
        code: "CHECKOUT_MINIMUM_NOT_MET",
        status: 422,
      });
      await CartService.addItem(
        { sessionId: b.sessionId, userId: b.userId },
        { productId: catalog.pa, quantity: 1, commandId: randomUUID() },
        checkoutAudit(),
      );
      await pool().query(
        "UPDATE app_user_addresses SET latitude=-8,longitude=-62 WHERE id=$1",
        [b.addressId],
      );
      await expect(quote(b)).rejects.toMatchObject({
        code: "CHECKOUT_DELIVERY_OUTSIDE_AREA",
        status: 422,
      });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_checkout_quotes WHERE user_id=$1",
            [b.userId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("cesta, endereço, cotação e recibo alheios nunca são acessíveis", async () => {
      const a = await buyer(),
        b = await buyer(),
        q = await quote(a);
      await expect(
        CheckoutService.createQuote(b.userId, a.cartId, b.addressId),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        CheckoutService.createQuote(b.userId, b.cartId, a.addressId),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        CheckoutService.getQuote(b.userId, q.id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(confirm(b, q.id)).rejects.toMatchObject({ status: 404 });
      const r = await confirm(a, q.id);
      await expect(confirm(b, q.id, r.body.commandId)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        CheckoutService.getConfirmation(b.userId, r.body.commandId),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("RLS ENABLE/FORCE: SELECT só do dono, recibos e mutações sem grant de cliente", async () => {
      const a = await buyer(),
        b = await buyer(),
        qa = await quote(a),
        qb = await quote(b);
      await confirm(a, qa.id);
      const metadata = (
        await pool().query(
          "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('app_checkout_quotes','app_command_receipts','app_payment_intents')",
        )
      ).rows;
      expect(metadata).toHaveLength(3);
      expect(
        metadata.every((r) => r.relrowsecurity && r.relforcerowsecurity),
      ).toBe(true);
      const c = await pool().connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE authenticated");
        await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
          a.userId,
        ]);
        const read = (
          await c.query("SELECT id FROM app_checkout_quotes ORDER BY id")
        ).rows.map((r) => r.id);
        expect(read).toContain(qa.id);
        expect(read).not.toContain(qb.id);
        expect(
          (await c.query("SELECT count(*)::int n FROM app_payment_intents"))
            .rows[0].n,
        ).toBe(1);
        expect(
          (
            await c.query(
              "SELECT has_table_privilege('authenticated','app_command_receipts','SELECT') AS receipt,has_table_privilege('authenticated','app_checkout_quotes','UPDATE') AS mutation,has_table_privilege('anon','app_checkout_quotes','SELECT') AS anonymous",
            )
          ).rows[0],
        ).toEqual({ receipt: false, mutation: false, anonymous: false });
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
    it("produto despublicado e conta bloqueada são revalidados antes do consumo/replay", async () => {
      const b = await buyer(),
        q = await quote(b);
      await pool().query(
        "UPDATE app_products SET is_published=false WHERE id=$1",
        [catalog.pa],
      );
      try {
        await expect(confirm(b, q.id)).rejects.toMatchObject({
          status: 409,
          code: "CHECKOUT_PRODUCT_UNAVAILABLE",
        });
      } finally {
        await pool().query(
          "UPDATE app_products SET is_published=true WHERE id=$1",
          [catalog.pa],
        );
      }
      const r = await confirm(b, q.id);
      await pool().query("UPDATE app_users SET status='blocked' WHERE id=$1", [
        b.userId,
      ]);
      await expect(confirm(b, q.id, r.body.commandId)).rejects.toMatchObject({
        status: 403,
        code: "CHECKOUT_OWNER_REQUIRED",
      });
    });
    it("contexto recupera confirmação em outro aparelho e impede nova reserva da mesma cesta", async () => {
      const b = await buyer(),
        q = await quote(b),
        r = await confirm(b, q.id);
      const ctx = await CheckoutService.getContext(b.userId, randomUUID());
      expect(ctx.cartId).toBe(b.cartId);
      expect(ctx.pendingConfirmation).toEqual(r.body);
      await expect(quote(b)).rejects.toMatchObject({
        status: 409,
        code: "CHECKOUT_ALREADY_PENDING",
      });
    });
    it("retirada de endereço preserva sua exclusão legada e snapshot", async () => {
      const b = await buyer(),
        q = await quote(b);
      await pool().query("DELETE FROM app_user_addresses WHERE id=$1", [
        b.addressId,
      ]);
      const read = await CheckoutService.getQuote(b.userId, q.id);
      expect(read.deliveryAddressId).toBe(null);
      expect(read.addressSnapshot.number).toBe("10");
      await expect(confirm(b, q.id)).rejects.toMatchObject({
        status: 409,
        code: "CHECKOUT_VALUES_CHANGED",
      });
    });
    it("exclusão operacional da conta remove PII/recibo/intent e libera sua reserva", async () => {
      const b = await buyer(),
        before = await inventory(),
        q = await quote(b),
        r = await confirm(b, q.id);
      await b.cleanup();
      expect(await inventory()).toEqual(before);
      for (const [table, col, id] of [
        ["app_checkout_quotes", "id", q.id],
        ["app_command_receipts", "command_id", r.body.commandId],
        ["app_payment_intents", "id", r.body.paymentIntentId],
      ])
        expect(
          (
            await pool().query(
              `SELECT count(*)::int n FROM ${table} WHERE ${col}=$1`,
              [id],
            )
          ).rows[0].n,
        ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT is_released FROM app_inventory_reservations WHERE id=ANY($1::uuid[])",
            [r.body.reservations.map((i) => i.id)],
          )
        ).rows.every((x) => x.is_released),
      ).toBe(true);
    });
    it("variações de corte do mesmo produto reservam quantidades distintas sem venda antecipada", async () => {
      const b = await buyer([catalog.pa]);
      await CartService.addItem(
        { sessionId: b.sessionId, userId: b.userId },
        {
          productId: catalog.pa,
          quantity: 2,
          cutType: "cubos",
          commandId: randomUUID(),
        },
        checkoutAudit(),
      );
      const q = await quote(b),
        r = await confirm(b, q.id);
      expect(q.stores[0].items).toHaveLength(2);
      expect(r.body.reservations.reduce((n, x) => n + x.quantity, 0)).toBe(4);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_inventory_movements WHERE reservation_id=ANY($1::uuid[])",
            [r.body.reservations.map((x) => x.id)],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it.each(["zero", "expired"] as const)(
      "estoque real %s rejeita confirmação mesmo com foto publicada",
      async (kind) => {
        const b = await buyer([catalog[kind]]),
          q = await quote(b);
        await expect(confirm(b, q.id)).rejects.toMatchObject({
          status: 409,
          code: "CHECKOUT_INSUFFICIENT_STOCK",
        });
        expect(
          (
            await pool().query(
              "SELECT count(*)::int n FROM app_payment_intents WHERE quote_id=$1",
              [q.id],
            )
          ).rows[0].n,
        ).toBe(0);
      },
    );
    it("dois compradores disputando o mesmo lote nunca excedem o saldo", async () => {
      const a = await buyer([catalog.scarce]),
        b = await buyer([catalog.scarce]);
      const qa = await quote(a),
        qb = await quote(b);
      const all = await Promise.allSettled([
        confirm(a, qa.id),
        confirm(b, qb.id),
      ]);
      expect(all.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const failure = all.find(
        (x) => x.status === "rejected",
      ) as PromiseRejectedResult;
      expect(failure.reason).toMatchObject({
        status: 409,
        code: "CHECKOUT_INSUFFICIENT_STOCK",
      });
      const state = (
        await pool().query(
          "SELECT sum(current_quantity)::int n FROM app_inventory_lots WHERE product_id=$1",
          [catalog.scarce],
        )
      ).rows[0];
      expect(state.n).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT sum(quantity)::int n FROM app_inventory_reservations WHERE product_id=$1 AND NOT is_released AND NOT is_consumed",
            [catalog.scarce],
          )
        ).rows[0].n,
      ).toBe(2);
    });
  },
);
