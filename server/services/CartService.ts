import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { dbPool } from "../db/pool.ts";
import { signedMediaUrls } from "../storage/signedMedia.ts";
import {
  PRODUCT_MEDIA_BUCKET,
  PRODUCT_MEDIA_ORIGIN,
} from "../../shared/contracts/product.ts";
import {
  AddCartItemSchema,
  AddHortiMixSchema,
  CartResponseSchema,
  CartSessionSchema,
  UpdateCartItemSchema,
  RemoveCartItemSchema,
  type AddCartItem,
  type Cart,
} from "../../shared/contracts/cart.ts";

export class CartError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
    this.name = "CartError";
  }
}
type Owner = { id: string; session_id: string; user_id: string | null };
type Scope = { sessionId: string; userId?: string };
type Context = { requestId: string; ipHash: string };
const MAX_ITEMS = 200;
const visible = `p.is_published AND c.is_active AND hvm_store_private.store_is_visible(p.store_id)`;

async function transaction<T>(
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!dbPool) throw new CartError("DEPENDENCY_UNAVAILABLE", 503);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof CartError) throw error;
    if (error instanceof z.ZodError)
      throw new CartError("CART_VALIDATION_FAILED", 422);
    throw new CartError("DEPENDENCY_UNAVAILABLE", 503);
  } finally {
    client.release();
  }
}

// All APIs resolve ownership themselves; no cartId, userId or storeId from a body.
// Locks precede lookup/creation so simultaneous first requests and login merge
// cannot create competing saved baskets or lose a guest addition.
async function resolve(client: PoolClient, scope: Scope): Promise<Owner> {
  CartSessionSchema.parse(scope.sessionId);
  if (scope.userId) {
    z.uuid().parse(scope.userId);
    const owner = await client.query(
      `SELECT id FROM public.app_users
      WHERE id=$1 AND public.effective_account_status(status,block_starts_at,block_ends_at)='active' FOR SHARE`,
      [scope.userId],
    );
    if (!owner.rowCount) throw new CartError("CART_OWNER_REQUIRED", 403);
    await client.query("SELECT pg_advisory_xact_lock(18,hashtext($1))", [
      "user:" + scope.userId,
    ]);
  }
  await client.query("SELECT pg_advisory_xact_lock(18,hashtext($1))", [
    "session:" + scope.sessionId,
  ]);
  const guest = (
    await client.query<Owner>(
      "SELECT id,session_id,user_id FROM public.app_carts WHERE session_id=$1 FOR UPDATE",
      [scope.sessionId],
    )
  ).rows[0];
  // A logged-out browser or another account cannot inherit a saved owner's cart.
  if (guest?.user_id && guest.user_id !== scope.userId)
    throw new CartError("CART_SESSION_OWNED", 409);
  if (scope.userId) {
    const saved = (
      await client.query<Owner>(
        "SELECT id,session_id,user_id FROM public.app_carts WHERE user_id=$1 FOR UPDATE",
        [scope.userId],
      )
    ).rows[0];
    if (saved && guest && saved.id !== guest.id) {
      await client.query(
        `INSERT INTO public.app_cart_items(cart_id,product_id,store_id,quantity,cut_type,added_at)
        SELECT $1,product_id,store_id,quantity,cut_type,added_at FROM public.app_cart_items WHERE cart_id=$2
        ON CONFLICT ON CONSTRAINT uq_cart_product_customization DO UPDATE
          SET quantity=least(99,app_cart_items.quantity+excluded.quantity),updated_at=clock_timestamp()`,
        [saved.id, guest.id],
      );
      await client.query("DELETE FROM public.app_carts WHERE id=$1", [
        guest.id,
      ]);
      await client.query(
        "UPDATE public.app_carts SET updated_at=clock_timestamp() WHERE id=$1",
        [saved.id],
      );
      return saved;
    }
    if (saved) return saved;
    if (guest) {
      await client.query(
        "UPDATE public.app_carts SET user_id=$2,updated_at=clock_timestamp() WHERE id=$1",
        [guest.id, scope.userId],
      );
      return { ...guest, user_id: scope.userId };
    }
  } else if (guest) return guest;
  return (
    await client.query<Owner>(
      `INSERT INTO public.app_carts(session_id,user_id) VALUES($1,$2) RETURNING id,session_id,user_id`,
      [scope.sessionId, scope.userId ?? null],
    )
  ).rows[0];
}

async function add(client: PoolClient, owner: Owner, raw: AddCartItem) {
  const input = AddCartItemSchema.parse(raw);
  const product = (
    await client.query<{ store_id: string }>(
      `SELECT p.store_id FROM public.app_products p
    JOIN public.app_categories c ON c.id=p.category_id
    JOIN public.app_producer_stores s ON s.id=p.store_id
    WHERE p.id=$1 AND ${visible} AND EXISTS(SELECT 1 FROM public.app_price_versions v
      WHERE v.product_id=p.id AND v.valid_from<=clock_timestamp()) FOR SHARE OF p,c,s`,
      [input.productId],
    )
  ).rows[0];
  if (!product) throw new CartError("CART_PRODUCT_UNAVAILABLE", 404);
  const variant = await client.query(
    "SELECT id FROM public.app_cart_items WHERE cart_id=$1 AND product_id=$2 AND cut_type IS NOT DISTINCT FROM $3::text",
    [owner.id, input.productId, input.cutType ?? null],
  );
  if (
    !variant.rowCount &&
    (
      await client.query<{ n: number }>(
        "SELECT count(*)::int n FROM public.app_cart_items WHERE cart_id=$1",
        [owner.id],
      )
    ).rows[0].n >= MAX_ITEMS
  )
    throw new CartError("CART_FULL", 422);
  await client.query(
    `INSERT INTO public.app_cart_items(cart_id,product_id,store_id,quantity,cut_type)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT ON CONSTRAINT uq_cart_product_customization DO UPDATE
    SET quantity=least(99,app_cart_items.quantity+excluded.quantity),updated_at=clock_timestamp()`,
    [
      owner.id,
      input.productId,
      product.store_id,
      input.quantity,
      input.cutType ?? null,
    ],
  );
}

async function grouped(client: PoolClient, owner: Owner): Promise<Cart> {
  const rows = (
    await client.query<{
      id: string;
      product_id: string;
      store_id: string;
      store_name: string;
      store_slug: string;
      title: string;
      quantity: number;
      cut_type: AddCartItem["cutType"];
      unit_type: string;
      net_weight_grams: number;
      price_cents: number | null;
      min_order_cents: number;
      available: boolean;
      media_url: string | null;
    }>(
      `SELECT i.*,p.title,p.unit_type,p.net_weight_grams,s.store_name,s.store_slug,
    coalesce(r.min_order_cents,s.min_order_amount_cents) AS min_order_cents,
    v.price_cents,(${visible} AND v.price_cents IS NOT NULL) AS available,
    CASE WHEN ${visible} THEN m.media_url ELSE NULL END AS media_url
    FROM public.app_cart_items i JOIN public.app_products p ON p.id=i.product_id
    JOIN public.app_categories c ON c.id=p.category_id JOIN public.app_producer_stores s ON s.id=i.store_id
    LEFT JOIN public.app_delivery_rules r ON r.store_id=s.id
    LEFT JOIN LATERAL (SELECT price_cents FROM public.app_price_versions
      WHERE product_id=p.id AND valid_from<=clock_timestamp() ORDER BY valid_from DESC LIMIT 1) v ON true
    LEFT JOIN LATERAL (SELECT media_url FROM public.app_product_media
      WHERE product_id=p.id ORDER BY is_primary DESC,display_order,id LIMIT 1) m ON true
    WHERE i.cart_id=$1 ORDER BY s.store_name,s.id,i.added_at,i.id`,
      [owner.id],
    )
  ).rows;
  const prefix = `${PRODUCT_MEDIA_ORIGIN}/storage/v1/object/${PRODUCT_MEDIA_BUCKET}/`;
  const urls = await signedMediaUrls(
    PRODUCT_MEDIA_BUCKET,
    rows.flatMap((r) =>
      r.media_url ? [r.media_url.slice(prefix.length)] : [],
    ),
  );
  const stores: Cart["stores"] = [];
  for (const row of rows) {
    let store = stores.find((s) => s.storeId === row.store_id);
    if (!store) {
      store = {
        storeId: row.store_id,
        storeName: row.store_name,
        storeSlug: row.store_slug,
        items: [],
        subtotalCents: 0,
        minOrderCents: row.min_order_cents,
        meetsMinOrder: false,
      };
      stores.push(store);
    }
    store.items.push({
      id: row.id,
      productId: row.product_id,
      title: row.title,
      quantity: row.quantity,
      cutType: row.cut_type ?? null,
      unitPriceCents: row.available ? (row.price_cents ?? 0) : 0,
      unitType:
        row.unit_type as Cart["stores"][number]["items"][number]["unitType"],
      netWeightGrams: row.net_weight_grams,
      imageUrl: row.media_url
        ? (urls.get(row.media_url.slice(prefix.length)) ?? null)
        : null,
      available: row.available,
    });
    if (row.available)
      store.subtotalCents += (row.price_cents ?? 0) * row.quantity;
    store.meetsMinOrder = store.subtotalCents >= store.minOrderCents;
  }
  return CartResponseSchema.parse({
    stores,
    itemCount: stores.reduce(
      (n, s) => n + s.items.reduce((q, i) => q + i.quantity, 0),
      0,
    ),
    subtotalCents: stores.reduce((n, s) => n + s.subtotalCents, 0),
  });
}

async function mutate(
  scope: Scope,
  commandId: string,
  action: string,
  input: unknown,
  context: Context,
  run: (client: PoolClient, owner: Owner) => Promise<void>,
) {
  return transaction(async (client) => {
    const owner = await resolve(client, scope);
    await client.query("SELECT pg_advisory_xact_lock(18,hashtext($1))", [
      "command:" + commandId,
    ]);
    // Session hash stays valid after an anonymous cart is fused/deleted on login.
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ sessionId: scope.sessionId, action, input }))
      .digest("hex");
    const previous = (
      await client.query<{
        action: string;
        payload_after: { fingerprint?: string };
      }>(
        "SELECT action,payload_after FROM public.app_audit_events WHERE command_id=$1",
        [commandId],
      )
    ).rows[0];
    if (previous) {
      if (
        previous.action !== action ||
        previous.payload_after?.fingerprint !== fingerprint
      )
        throw new CartError("CART_COMMAND_CONFLICT", 409);
    } else {
      await run(client, owner);
      await client.query(
        "UPDATE public.app_carts SET updated_at=clock_timestamp() WHERE id=$1",
        [owner.id],
      );
      await client.query(
        `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash,command_id)
        VALUES($1,$2,$3,$4,'app_carts',$5,$6,$7,$8)`,
        [
          context.requestId,
          scope.userId ?? null,
          scope.userId ? "authenticated" : "anonymous",
          action,
          owner.id,
          JSON.stringify({ fingerprint }),
          context.ipHash,
          commandId,
        ],
      );
    }
    return grouped(client, owner);
  });
}

export const CartService = {
  getOrCreateCart(sessionId: string, userId?: string) {
    return transaction((c) => resolve(c, { sessionId, userId }));
  },
  mergeCartOnLogin(sessionId: string, userId: string) {
    return this.getOrCreateCart(sessionId, userId);
  },
  getCartGroupedByStore(scope: Scope) {
    return transaction(async (c) => grouped(c, await resolve(c, scope)));
  },
  async addItem(scope: Scope, raw: AddCartItem, context: Context) {
    const input = AddCartItemSchema.parse(raw),
      { commandId = randomUUID(), ...item } = input;
    return mutate(scope, commandId, "cart.add", item, context, (c, o) =>
      add(c, o, item),
    );
  },
  async addHortiMix(
    scope: Scope,
    raw: z.infer<typeof AddHortiMixSchema>,
    context: Context,
  ) {
    const { items, commandId } = AddHortiMixSchema.parse(raw);
    return mutate(
      scope,
      commandId,
      "cart.mix",
      items,
      context,
      async (c, o) => {
        for (const item of items) await add(c, o, item);
      },
    );
  },
  async updateItem(
    scope: Scope,
    id: string,
    raw: z.infer<typeof UpdateCartItemSchema>,
    context: Context,
  ) {
    z.uuid().parse(id);
    const { quantity, commandId } = UpdateCartItemSchema.parse(raw);
    return mutate(
      scope,
      commandId,
      "cart.update",
      { id, quantity },
      context,
      async (c, o) => {
        const current = (
          await c.query<{ quantity: number; available: boolean }>(
            `SELECT i.quantity,(${visible}) AS available
          FROM public.app_cart_items i JOIN public.app_products p ON p.id=i.product_id
          JOIN public.app_categories c ON c.id=p.category_id JOIN public.app_producer_stores s ON s.id=p.store_id
          WHERE i.id=$1 AND i.cart_id=$2 FOR UPDATE OF i FOR SHARE OF p,c,s`,
            [id, o.id],
          )
        ).rows[0];
        if (!current) throw new CartError("CART_ITEM_NOT_FOUND", 404);
        if (quantity > current.quantity && !current.available)
          throw new CartError("CART_PRODUCT_UNAVAILABLE", 404);
        if (
          !(
            await c.query(
              "UPDATE public.app_cart_items SET quantity=$3,updated_at=clock_timestamp() WHERE id=$1 AND cart_id=$2 RETURNING id",
              [id, o.id, quantity],
            )
          ).rowCount
        )
          throw new CartError("CART_ITEM_NOT_FOUND", 404);
      },
    );
  },
  async removeItem(
    scope: Scope,
    id: string,
    raw: z.infer<typeof RemoveCartItemSchema>,
    context: Context,
  ) {
    z.uuid().parse(id);
    const { commandId } = RemoveCartItemSchema.parse(raw);
    return mutate(
      scope,
      commandId,
      "cart.remove",
      { id },
      context,
      async (c, o) => {
        if (
          !(
            await c.query(
              "DELETE FROM public.app_cart_items WHERE id=$1 AND cart_id=$2 RETURNING id",
              [id, o.id],
            )
          ).rowCount
        )
          throw new CartError("CART_ITEM_NOT_FOUND", 404);
      },
    );
  },
};
