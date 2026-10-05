import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T18_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("T18_LOCAL_DATABASE_REQUIRED");
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
import { CartService } from "../../server/services/CartService.ts";
import { productFixture } from "../helpers/productFixtures.ts";
const pool = () => dbPool as Pool,
  context = () => ({ requestId: randomUUID(), ipHash: "a".repeat(64) });
type Fixture = Awaited<ReturnType<typeof productFixture>>;
describe.runIf(Boolean(process.env.HVM_T18_LOCAL_DATABASE_URL))(
  "T18 PostgreSQL real: sessão, fusão, isolamento e intenção",
  () => {
    let a: Fixture, b: Fixture, categoryId: string, pa: string, pb: string;
    const sessions: string[] = [];
    const scope = (userId?: string) => {
      const sessionId = randomUUID();
      sessions.push(sessionId);
      return { sessionId, userId };
    };
    const add = (
      s: { sessionId: string; userId?: string },
      productId = pa,
      quantity = 1,
      cutType: any = null,
      commandId = randomUUID(),
    ) =>
      CartService.addItem(
        s,
        { productId, quantity, cutType, commandId },
        context(),
      );
    async function createProduct(
      f: Fixture,
      title: string,
      price: number,
      weight: number,
    ) {
      const id = randomUUID();
      await pool().query(
        "INSERT INTO app_products(id,store_id,category_id,title,description,packaging_type,net_weight_grams,unit_type) VALUES($1,$2,$3,$4,'Alimento sintético exclusivamente local.','porcao_embalada',$5,'un')",
        [id, f.store.id, categoryId, title, weight],
      );
      await pool().query(
        "INSERT INTO app_price_versions(product_id,price_cents,created_by_user_id) VALUES($1,$2,$3)",
        [id, price, f.userId],
      );
      await pool().query(
        "INSERT INTO app_product_media(product_id,media_url,is_primary) VALUES($1,$2,true)",
        [
          id,
          `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/product-media/${f.store.id}/${id}/${randomUUID()}-${"a".repeat(64)}.webp`,
        ],
      );
      await pool().query(
        "UPDATE app_products SET is_published=true WHERE id=$1",
        [id],
      );
      return id;
    }
    beforeAll(async () => {
      a = await productFixture(pool());
      b = await productFixture(pool());
      categoryId = randomUUID();
      await pool().query(
        "INSERT INTO app_categories(id,name,slug,icon_name) VALUES($1,'Teste T18',$2,'leaf')",
        [categoryId, "t18-" + categoryId],
      );
      pa = await createProduct(a, "Cenoura local", 700, 300);
      pb = await createProduct(b, "Couve local", 900, 200);
      await pool().query(
        "INSERT INTO app_delivery_rules(store_id,min_order_cents) VALUES($1,2500)",
        [a.store.id],
      );
      await pool().query(
        "UPDATE app_producer_stores SET min_order_amount_cents=800 WHERE id=$1",
        [b.store.id],
      );
    });
    afterAll(async () => {
      try {
        await pool().query(
          "DELETE FROM app_carts WHERE session_id=ANY($1::text[])",
          [sessions],
        );
        for (const f of [a, b])
          if (f)
            await pool().query("DELETE FROM auth.users WHERE id=$1", [
              f.userId,
            ]);
        if (categoryId)
          await pool().query("DELETE FROM app_categories WHERE id=$1", [
            categoryId,
          ]);
      } finally {
        await dbPool?.end();
      }
    });
    it("criação concorrente da mesma sessão gera uma única cesta", async () => {
      const s = scope();
      const carts = await Promise.all(
        Array.from({ length: 5 }, () =>
          CartService.getOrCreateCart(s.sessionId),
        ),
      );
      expect(new Set(carts.map((c) => c.id)).size).toBe(1);
    });
    it("agrupa duas lojas com mínimos T16/T12 independentes", async () => {
      const s = scope();
      await add(s);
      const cart = await add(s, pb);
      expect(cart.stores).toHaveLength(2);
      expect(cart.stores.find((s) => s.storeId === a.store.id)).toMatchObject({
        subtotalCents: 700,
        minOrderCents: 2500,
        meetsMinOrder: false,
      });
      expect(cart.stores.find((s) => s.storeId === b.store.id)).toMatchObject({
        subtotalCents: 900,
        minOrderCents: 800,
        meetsMinOrder: true,
      });
      expect(cart.subtotalCents).toBe(1600);
    });
    it("porção sem corte não duplica; cortes distintos permanecem separados", async () => {
      const s = scope();
      await add(s);
      await add(s, pa, 2);
      await add(s, pa, 1, "cubos");
      const cart = await add(s, pa, 1, "rodelas");
      expect(cart.stores[0].items).toHaveLength(3);
      expect(
        cart.stores[0].items.find((i) => i.cutType === null)?.quantity,
      ).toBe(3);
    });
    it("limita soma a 99 e rejeita quantidade 100 antes de mutação", async () => {
      const s = scope();
      await add(s, pa, 98);
      expect((await add(s, pa, 5)).itemCount).toBe(99);
      await expect(add(s, pa, 100)).rejects.toThrow();
      expect((await CartService.getCartGroupedByStore(s)).itemCount).toBe(99);
    });
    it("preço permanece vigente e futuro não substitui preço atual", async () => {
      const s = scope();
      await add(s, pb);
      await pool().query(
        "INSERT INTO app_price_versions(product_id,price_cents,created_by_user_id,valid_from) VALUES($1,1100,$2,clock_timestamp())",
        [pb, b.userId],
      );
      await pool().query(
        "INSERT INTO app_price_versions(product_id,price_cents,created_by_user_id,valid_from) VALUES($1,9900,$2,clock_timestamp()+interval '1 day')",
        [pb, b.userId],
      );
      expect((await CartService.getCartGroupedByStore(s)).subtotalCents).toBe(
        1100,
      );
    });
    it("produto despublicado é erro explícito na adição e não conta no subtotal", async () => {
      const s = scope();
      await add(s);
      await pool().query(
        "UPDATE app_products SET is_published=false WHERE id=$1",
        [pa],
      );
      try {
        await expect(add(s)).rejects.toMatchObject({
          status: 404,
          code: "CART_PRODUCT_UNAVAILABLE",
        });
        expect(
          (await CartService.getCartGroupedByStore(s)).stores[0].items[0],
        ).toMatchObject({
          available: false,
          imageUrl: null,
          unitPriceCents: 0,
        });
        expect((await CartService.getCartGroupedByStore(s)).subtotalCents).toBe(
          0,
        );
      } finally {
        await pool().query(
          "UPDATE app_products SET is_published=true WHERE id=$1",
          [pa],
        );
      }
    });
    it("loja pausada e categoria inativa não aceitam novos itens", async () => {
      await pool().query(
        "UPDATE app_producer_stores SET status='paused' WHERE id=$1",
        [a.store.id],
      );
      try {
        await expect(add(scope())).rejects.toMatchObject({
          code: "CART_PRODUCT_UNAVAILABLE",
        });
      } finally {
        await pool().query(
          "UPDATE app_producer_stores SET status='active' WHERE id=$1",
          [a.store.id],
        );
      }
      await pool().query(
        "UPDATE app_categories SET is_active=false WHERE id=$1",
        [categoryId],
      );
      try {
        await expect(add(scope())).rejects.toMatchObject({
          code: "CART_PRODUCT_UNAVAILABLE",
        });
      } finally {
        await pool().query(
          "UPDATE app_categories SET is_active=true WHERE id=$1",
          [categoryId],
        );
      }
    });
    it("adição e HortiMix repetidos recuperam o resultado sem somar novamente", async () => {
      const s = scope(),
        key = randomUUID();
      await add(s, pa, 2, null, key);
      expect((await add(s, pa, 2, null, key)).itemCount).toBe(2);
      const mix = {
        items: [
          { productId: pa, quantity: 2, cutType: "cubos" as const },
          { productId: pb, quantity: 1, cutType: "picado_fino" as const },
        ],
        commandId: randomUUID(),
      };
      await CartService.addHortiMix(s, mix, context());
      expect((await CartService.addHortiMix(s, mix, context())).itemCount).toBe(
        5,
      );
      await expect(add(s, pb, 1, null, key)).rejects.toMatchObject({
        status: 409,
        code: "CART_COMMAND_CONFLICT",
      });
    });
    it("HortiMix aborta integralmente se uma das porções não está pública", async () => {
      const s = scope();
      await expect(
        CartService.addHortiMix(
          s,
          {
            items: [
              { productId: pa, quantity: 1 },
              { productId: randomUUID(), quantity: 1 },
            ],
            commandId: randomUUID(),
          },
          context(),
        ),
      ).rejects.toMatchObject({ code: "CART_PRODUCT_UNAVAILABLE" });
      expect((await CartService.getCartGroupedByStore(s)).itemCount).toBe(0);
    });
    it("concorrência não perde incrementos", async () => {
      const s = scope();
      await Promise.all(Array.from({ length: 8 }, () => add(s)));
      expect((await CartService.getCartGroupedByStore(s)).itemCount).toBe(8);
    });
    it("associa a cesta anônima à conta e a recupera em outro aparelho", async () => {
      const guest = scope();
      await add(guest);
      await CartService.mergeCartOnLogin(guest.sessionId, a.userId);
      expect(
        (await CartService.getCartGroupedByStore(scope(a.userId))).itemCount,
      ).toBe(1);
    });
    it("fusão soma variantes, preserva lojas/cortes e é idempotente", async () => {
      const guest = scope();
      await add(guest, pa, 2);
      await add(guest, pb, 3, "tiras");
      const saved = await CartService.mergeCartOnLogin(
        guest.sessionId,
        a.userId,
      );
      const cart = await CartService.getCartGroupedByStore({
        ...guest,
        userId: a.userId,
      });
      expect(
        cart.stores
          .flatMap((s) => s.items)
          .find((i) => i.productId === pa && i.cutType === null)?.quantity,
      ).toBe(3);
      expect(cart.itemCount).toBe(6);
      await CartService.mergeCartOnLogin(guest.sessionId, a.userId);
      expect(
        (
          await CartService.getCartGroupedByStore({
            ...guest,
            userId: a.userId,
          })
        ).itemCount,
      ).toBe(6);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_carts WHERE user_id=$1",
            [a.userId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(saved.user_id).toBe(a.userId);
    });
    it("fusão e adições concorrentes preservam todos os itens", async () => {
      const guest = scope();
      await add(guest, pb);
      await Promise.all([
        CartService.mergeCartOnLogin(guest.sessionId, b.userId),
        add({ ...guest, userId: b.userId }, pa),
        add({ ...guest, userId: b.userId }, pa),
      ]);
      expect(
        (await CartService.getCartGroupedByStore(scope(b.userId))).itemCount,
      ).toBe(3);
    });
    it("outra sessão/conta não lê nem altera os itens do titular", async () => {
      const s = scope();
      const cart = await add(s);
      const id = cart.stores[0].items[0].id;
      const other = scope();
      expect((await CartService.getCartGroupedByStore(other)).itemCount).toBe(
        0,
      );
      await expect(
        CartService.updateItem(
          other,
          id,
          { quantity: 2, commandId: randomUUID() },
          context(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        CartService.removeItem(
          other,
          id,
          { commandId: randomUUID() },
          context(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      const saved = await CartService.mergeCartOnLogin(s.sessionId, b.userId);
      await expect(
        CartService.getCartGroupedByStore({
          sessionId: saved.session_id,
          userId: a.userId,
        }),
      ).rejects.toMatchObject({ code: "CART_SESSION_OWNED" });
      await expect(
        CartService.getCartGroupedByStore({ sessionId: saved.session_id }),
      ).rejects.toMatchObject({ code: "CART_SESSION_OWNED" });
    });
    it("quantidade e remoção são persistidas; retry não remove outro item", async () => {
      const s = scope();
      const initial = await add(s),
        id = initial.stores[0].items[0].id;
      const update = { quantity: 4, commandId: randomUUID() };
      await CartService.updateItem(s, id, update, context());
      expect(
        (await CartService.updateItem(s, id, update, context())).itemCount,
      ).toBe(4);
      const remove = { commandId: randomUUID() };
      expect(
        (await CartService.removeItem(s, id, remove, context())).itemCount,
      ).toBe(0);
      expect(
        (await CartService.removeItem(s, id, remove, context())).itemCount,
      ).toBe(0);
    });
    it("não cria reservas, movimentos, cotações nem modifica estoque", async () => {
      const before = (
        await pool().query(
          "SELECT (SELECT count(*) FROM app_inventory_reservations)::int reserves,(SELECT count(*) FROM app_inventory_movements)::int moves,(SELECT count(*) FROM app_delivery_quotes)::int quotes",
        )
      ).rows[0];
      const s = scope();
      await add(s);
      await CartService.getCartGroupedByStore(s);
      const after = (
        await pool().query(
          "SELECT (SELECT count(*) FROM app_inventory_reservations)::int reserves,(SELECT count(*) FROM app_inventory_movements)::int moves,(SELECT count(*) FROM app_delivery_quotes)::int quotes",
        )
      ).rows[0];
      expect(after).toEqual(before);
    });
    it("RLS ENABLE/FORCE, clientes sem SELECT/escrita e role restaurado", async () => {
      const tables = (
        await pool().query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('app_carts','app_cart_items')",
        )
      ).rows;
      expect(tables).toHaveLength(2);
      expect(
        tables.every((t) => t.relrowsecurity && t.relforcerowsecurity),
      ).toBe(true);
      for (const role of ["anon", "authenticated"]) {
        for (const table of ["app_carts", "app_cart_items"]) {
          for (const privilege of [
            "SELECT",
            "INSERT",
            "UPDATE",
            "DELETE",
            "TRUNCATE",
            "REFERENCES",
            "TRIGGER",
          ])
            expect(
              (
                await pool().query(
                  "SELECT has_table_privilege($1,$2,$3) allowed",
                  [role, table, privilege],
                )
              ).rows[0].allowed,
            ).toBe(false);
        }
      }
      expect(
        (await pool().query("SELECT current_user")).rows[0].current_user,
      ).toBe("postgres");
    });
    it("exclusão do produto cascata apenas às intenções e bloqueio da conta impede acesso", async () => {
      const id = await createProduct(a, "Alimento temporário", 200, 100),
        s = scope();
      await add(s, id);
      await pool().query("DELETE FROM app_products WHERE id=$1", [id]);
      expect((await CartService.getCartGroupedByStore(s)).itemCount).toBe(0);
      await pool().query("UPDATE app_users SET status='blocked' WHERE id=$1", [
        a.userId,
      ]);
      try {
        await expect(
          CartService.getCartGroupedByStore(scope(a.userId)),
        ).rejects.toMatchObject({ status: 403 });
      } finally {
        await pool().query("UPDATE app_users SET status='active' WHERE id=$1", [
          a.userId,
        ]);
      }
    });
  },
);
