import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { dbPool } from "../db/pool.ts";
import { reportFailure } from "../config/reportFailure.ts";
import { CartService, CartError } from "./CartService.ts";
import { DeliveryQuoteService, DeliveryError } from "./DeliveryQuoteService.ts";
import { InventoryService, InventoryError } from "./InventoryService.ts";
import { signedMediaUrls } from "../storage/signedMedia.ts";
import {
  PRODUCT_MEDIA_BUCKET,
  PRODUCT_MEDIA_ORIGIN,
} from "../../shared/contracts/product.ts";
import {
  CHECKOUT_QUOTE_TTL_MINUTES,
  CheckoutAddressSnapshotSchema,
  CheckoutCommandIdSchema,
  CheckoutConfirmationSchema,
  CheckoutContextSchema,
  CheckoutQuoteResponseSchema,
  CheckoutStoreSnapshotSchema,
  ConfirmCheckoutSchema,
  CreateQuoteSchema,
  type CheckoutConfirmation,
  type CheckoutStoreSnapshot,
} from "../../shared/contracts/checkout.ts";

export class CheckoutError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
    this.name = "CheckoutError";
  }
}
type Audit = { requestId: string; ipHash: string };
const ENDPOINT = "/v1/checkout/confirm";
const MAX_MONEY = 2147483647;
const prefix = `${PRODUCT_MEDIA_ORIGIN}/storage/v1/object/${PRODUCT_MEDIA_BUCKET}/`;
type CartItem = {
  id: string;
  product_id: string;
  store_id: string;
  quantity: number;
  cut_type: string | null;
};
type QuoteRow = {
  id: string;
  user_id: string;
  person_id: string;
  cart_id: string | null;
  cart_fingerprint: string;
  delivery_address_id: string | null;
  address_snapshot: z.infer<typeof CheckoutAddressSnapshotSchema>;
  items_snapshot: CheckoutStoreSnapshot[];
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
  total_cents: number;
  expires_at: Date;
  created_at: Date;
  is_consumed: boolean;
  reservation_ids: string[];
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function checkoutPayloadHash(raw: unknown) {
  return hash(ConfirmCheckoutSchema.parse(raw));
}
function cartFingerprint(items: CartItem[]) {
  return hash(
    [...items]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((i) => ({
        id: i.id,
        productId: i.product_id,
        storeId: i.store_id,
        quantity: i.quantity,
        cutType: i.cut_type,
      })),
  );
}
function translate(error: unknown): never {
  if (error instanceof CheckoutError) throw error;
  if (error instanceof CartError)
    throw new CheckoutError(error.code, error.status);
  if (error instanceof DeliveryError) {
    const stale = [
      "DELIVERY_QUOTE_EXPIRED",
      "DELIVERY_QUOTE_STALE",
      "DELIVERY_CONFIGURATION_STALE",
    ].includes(error.code);
    throw new CheckoutError(
      stale ? "CHECKOUT_VALUES_CHANGED" : error.code,
      stale ? 409 : error.status,
    );
  }
  if (error instanceof InventoryError)
    throw new CheckoutError(
      error.code === "INVENTORY_PRODUCT_UNAVAILABLE"
        ? "CHECKOUT_PRODUCT_UNAVAILABLE"
        : error.code,
      error.code === "INVENTORY_PRODUCT_UNAVAILABLE" ? 409 : error.status,
    );
  if (error instanceof z.ZodError)
    throw new CheckoutError("CHECKOUT_VALIDATION_FAILED", 422);
  reportFailure({
    category: "checkout_dependency_failed",
    detail: (error as { code?: string }).code ?? "unknown",
  });
  throw new CheckoutError("DEPENDENCY_UNAVAILABLE", 503);
}
async function transaction<T>(run: (c: PoolClient) => Promise<T>): Promise<T> {
  if (!dbPool) throw new CheckoutError("DEPENDENCY_UNAVAILABLE", 503);
  const c = await dbPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE service_role");
    const result = await run(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    return translate(e);
  } finally {
    c.release();
  }
}
async function identity(c: PoolClient, userId: string) {
  z.uuid().parse(userId);
  const row = (
    await c.query<{ id: string }>(
      `SELECT pe.id FROM public.app_users u
    JOIN public.app_people pe ON pe.user_id=u.id WHERE u.id=$1 AND pe.archived_at IS NULL
    AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
    AND EXISTS(SELECT 1 FROM public.app_user_role_assignments r WHERE r.user_id=u.id
      AND r.role_code IN ('consumer','producer') AND r.revoked_at IS NULL
      AND (r.expires_at IS NULL OR r.expires_at>clock_timestamp())) FOR SHARE OF u,pe`,
      [userId],
    )
  ).rows[0];
  if (!row) throw new CheckoutError("CHECKOUT_OWNER_REQUIRED", 403);
  // Shares T18's account lock: basket mutation/login merge cannot race a snapshot.
  await c.query("SELECT pg_advisory_xact_lock(18,hashtext($1))", [
    "user:" + userId,
  ]);
  return { userId, personId: row.id };
}
async function ownedCart(c: PoolClient, userId: string, cartId: string) {
  const row = (
    await c.query<{ id: string }>(
      "SELECT id FROM public.app_carts WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [cartId, userId],
    )
  ).rows[0];
  if (!row) throw new CheckoutError("CHECKOUT_CART_NOT_FOUND", 404);
  return row;
}
async function audit(
  c: PoolClient,
  userId: string,
  action: string,
  quoteId: string,
  details: object,
  ctx?: Audit,
  commandId: string = randomUUID(),
) {
  await c.query(
    `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash,command_id)
    VALUES($1,$2,'authenticated',$3,'app_checkout_quotes',$4,$5,$6,$7)`,
    [
      ctx?.requestId ?? randomUUID(),
      userId,
      action,
      quoteId,
      JSON.stringify(details),
      ctx?.ipHash ?? null,
      commandId,
    ],
  );
}
async function response(row: QuoteRow) {
  const stores = z.array(CheckoutStoreSnapshotSchema).parse(row.items_snapshot);
  const ids = stores.flatMap((s) => s.items.map((i) => i.productId));
  const visible = await dbPool!.query<{ id: string }>(
    `SELECT p.id FROM public.app_products p JOIN public.app_categories c ON c.id=p.category_id
    WHERE p.id=ANY($1::uuid[]) AND p.is_published AND c.is_active AND hvm_store_private.store_is_visible(p.store_id)`,
    [ids],
  );
  const allowed = new Set(visible.rows.map((r) => r.id));
  const paths = stores.flatMap((s) =>
    s.items.flatMap((i) =>
      allowed.has(i.productId) && i.mediaPath ? [i.mediaPath] : [],
    ),
  );
  const urls = await signedMediaUrls(PRODUCT_MEDIA_BUCKET, paths);
  return CheckoutQuoteResponseSchema.parse({
    id: row.id,
    cartId: row.cart_id,
    deliveryAddressId: row.delivery_address_id,
    addressSnapshot: row.address_snapshot,
    stores: stores.map((s) => ({
      ...s,
      items: s.items.map(({ mediaPath, ...i }) => ({
        ...i,
        imageUrl:
          mediaPath && allowed.has(i.productId)
            ? (urls.get(mediaPath) ?? null)
            : null,
      })),
    })),
    subtotalCents: row.subtotal_cents,
    deliveryFeeCents: row.delivery_fee_cents,
    discountCents: row.discount_cents,
    totalCents: row.total_cents,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    serverTime: new Date().toISOString(),
    isConsumed: row.is_consumed,
  });
}
async function pending(c: PoolClient, userId: string, cartId: string) {
  const row = (
    await c.query<{ response_body: CheckoutConfirmation }>(
      `SELECT r.response_body FROM public.app_payment_intents p
    JOIN public.app_checkout_quotes q ON q.id=p.quote_id JOIN public.app_command_receipts r ON r.command_id=p.command_id
    WHERE p.user_id=$1 AND q.cart_id=$2 AND p.status='pending' AND p.expires_at>clock_timestamp()
      AND r.endpoint=$3 ORDER BY p.created_at DESC LIMIT 1`,
      [userId, cartId, ENDPOINT],
    )
  ).rows[0];
  return row ? CheckoutConfirmationSchema.parse(row.response_body) : null;
}

export const CheckoutService = {
  async getContext(userId: string, sessionId: string) {
    await CartService.getOrCreateCart(sessionId, userId);
    return transaction(async (c) => {
      await identity(c, userId);
      const cart = (
        await c.query<{ id: string }>(
          "SELECT id FROM public.app_carts WHERE user_id=$1",
          [userId],
        )
      ).rows[0];
      if (!cart) throw new CheckoutError("CHECKOUT_CART_NOT_FOUND", 404);
      return CheckoutContextSchema.parse({
        cartId: cart.id,
        serverTime: new Date().toISOString(),
        pendingConfirmation: await pending(c, userId, cart.id),
      });
    });
  },
  async createQuote(
    userId: string,
    cartId: string,
    deliveryAddressId: string,
    ctx?: Audit,
  ) {
    const input = CreateQuoteSchema.parse({ cartId, deliveryAddressId });
    const row = await transaction(async (c) => {
      const actor = await identity(c, userId);
      await ownedCart(c, userId, input.cartId);
      if (await pending(c, userId, input.cartId))
        throw new CheckoutError("CHECKOUT_ALREADY_PENDING", 409);
      const a = (
        await c.query<Record<string, any>>(
          `SELECT a.* FROM public.app_user_addresses a
        WHERE a.id=$1 AND a.person_id=$2 AND a.is_active FOR SHARE OF a`,
          [input.deliveryAddressId, actor.personId],
        )
      ).rows[0];
      if (!a) throw new CheckoutError("DELIVERY_ADDRESS_NOT_FOUND", 404);
      if (a.latitude === null || a.longitude === null)
        throw new CheckoutError("DELIVERY_ADDRESS_GPS_REQUIRED", 422);
      const locality = await c.query<{ coverage: string }>(
        `SELECT public.fn_locality_coverage($1,$2) AS coverage`,
        [a.state, a.city],
      );
      if (locality.rows[0]?.coverage !== "active")
        throw new CheckoutError("LOCALITY_DISABLED", 403);
      const addressSnapshot = CheckoutAddressSnapshotSchema.parse({
        id: a.id,
        label: a.label,
        cep: a.cep,
        street: a.street,
        number: a.number,
        complement: a.complement,
        neighborhood: a.neighborhood,
        city: a.city,
        state: a.state,
        latitude: Number(a.latitude),
        longitude: Number(a.longitude),
        deliveryNotes: a.delivery_notes,
        revision: a.revision,
      });
      type Row = CartItem & {
        title: string;
        unit_type: any;
        net_weight_grams: number;
        store_name: string;
        store_slug: string;
        price_cents: number | null;
        price_id: string | null;
        media_url: string | null;
        available: boolean;
      };
      const rows = (
        await c.query<Row>(
          `SELECT i.*,p.title,p.unit_type,p.net_weight_grams,s.store_name,s.store_slug,
        v.id AS price_id,v.price_cents,m.media_url,(p.is_published AND cat.is_active AND p.store_id=i.store_id
          AND hvm_store_private.store_is_visible(s.id)) AS available
        FROM public.app_cart_items i JOIN public.app_products p ON p.id=i.product_id
        JOIN public.app_categories cat ON cat.id=p.category_id JOIN public.app_producer_stores s ON s.id=i.store_id
        LEFT JOIN LATERAL (SELECT id,price_cents FROM public.app_price_versions WHERE product_id=p.id
          AND valid_from<=clock_timestamp() ORDER BY valid_from DESC,id DESC LIMIT 1) v ON true
        LEFT JOIN LATERAL (SELECT media_url FROM public.app_product_media WHERE product_id=p.id
          ORDER BY is_primary DESC,display_order,id LIMIT 1) m ON true
        WHERE i.cart_id=$1 ORDER BY i.product_id,i.id FOR UPDATE OF i FOR SHARE OF p,cat,s`,
          [input.cartId],
        )
      ).rows;
      if (!rows.length) throw new CheckoutError("CHECKOUT_CART_EMPTY", 422);
      if (rows.length > 1000)
        throw new CheckoutError("CHECKOUT_CART_TOO_LARGE", 422);
      if (rows.some((r) => !r.available || r.price_cents === null))
        throw new CheckoutError("CHECKOUT_PRODUCT_UNAVAILABLE", 409);
      const started = (
        await c.query<{ stamp: Date }>("SELECT clock_timestamp() AS stamp")
      ).rows[0].stamp;
      const stores: CheckoutStoreSnapshot[] = [];
      for (const storeId of [...new Set(rows.map((r) => r.store_id))].sort()) {
        const items = rows.filter((r) => r.store_id === storeId),
          first = items[0];
        const subtotal = items.reduce(
          (n, i) => n + i.price_cents! * i.quantity,
          0,
        );
        if (subtotal > MAX_MONEY)
          throw new CheckoutError("CHECKOUT_TOTAL_TOO_LARGE", 422);
        const delivery = await DeliveryQuoteService.calculateQuote(
          storeId,
          input.deliveryAddressId,
          { ...actor, subtotalCents: subtotal },
          c,
        );
        if (!delivery.isEligible)
          throw new CheckoutError("CHECKOUT_DELIVERY_OUTSIDE_AREA", 422);
        if (subtotal < delivery.minOrderCents)
          throw new CheckoutError("CHECKOUT_MINIMUM_NOT_MET", 422);
        stores.push(
          CheckoutStoreSnapshotSchema.parse({
            storeId,
            storeName: first.store_name,
            storeSlug: first.store_slug,
            subtotalCents: subtotal,
            minOrderCents: delivery.minOrderCents,
            deliveryQuoteId: delivery.id,
            deliveryFeeCents: delivery.feeCents,
            distanceKm: delivery.distanceKm,
            items: items.map((i) => ({
              cartItemId: i.id,
              productId: i.product_id,
              title: i.title,
              quantity: i.quantity,
              cutType: i.cut_type,
              unitType: i.unit_type,
              netWeightGrams: i.net_weight_grams,
              unitPriceCents: i.price_cents,
              totalPriceCents: i.price_cents! * i.quantity,
              priceVersionId: i.price_id,
              mediaPath: i.media_url?.startsWith(prefix)
                ? i.media_url.slice(prefix.length)
                : null,
            })),
          }),
        );
      }
      const subtotal = stores.reduce((n, s) => n + s.subtotalCents, 0),
        fee = stores.reduce((n, s) => n + s.deliveryFeeCents, 0);
      if (subtotal + fee > MAX_MONEY)
        throw new CheckoutError("CHECKOUT_TOTAL_TOO_LARGE", 422);
      const row = (
        await c.query<QuoteRow>(
          `INSERT INTO public.app_checkout_quotes(user_id,person_id,delivery_address_id,cart_id,cart_fingerprint,
        address_snapshot,items_snapshot,subtotal_cents,delivery_fee_cents,total_cents,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11::timestamptz+make_interval(mins=>$12)) RETURNING *`,
          [
            userId,
            actor.personId,
            input.deliveryAddressId,
            input.cartId,
            cartFingerprint(rows),
            JSON.stringify(addressSnapshot),
            JSON.stringify(stores),
            subtotal,
            fee,
            subtotal + fee,
            started,
            CHECKOUT_QUOTE_TTL_MINUTES,
          ],
        )
      ).rows[0];
      await audit(
        c,
        userId,
        "checkout.quoted",
        row.id,
        {
          storeCount: stores.length,
          itemCount: rows.length,
          totalCents: row.total_cents,
        },
        ctx,
      );
      return row;
    });
    return response(row);
  },
  async getQuote(userId: string, quoteId: string) {
    z.uuid().parse(quoteId);
    const row = await transaction(async (c) => {
      await identity(c, userId);
      const row = (
        await c.query<QuoteRow>(
          "SELECT * FROM public.app_checkout_quotes WHERE id=$1 AND user_id=$2",
          [quoteId, userId],
        )
      ).rows[0];
      if (!row) throw new CheckoutError("CHECKOUT_QUOTE_NOT_FOUND", 404);
      return row;
    });
    return response(row);
  },
  async getConfirmation(userId: string, commandId: string) {
    const id = CheckoutCommandIdSchema.parse(commandId);
    return transaction(async (c) => {
      await identity(c, userId);
      const row = (
        await c.query<{ response_body: CheckoutConfirmation }>(
          "SELECT response_body FROM public.app_command_receipts WHERE command_id=$1 AND user_id=$2 AND endpoint=$3",
          [id, userId, ENDPOINT],
        )
      ).rows[0];
      if (!row) throw new CheckoutError("CHECKOUT_COMMAND_NOT_FOUND", 404);
      return CheckoutConfirmationSchema.parse(row.response_body);
    });
  },
  async confirmCheckout(
    commandId: string,
    raw: unknown,
    userId: string,
    ctx?: Audit,
  ) {
    const id = CheckoutCommandIdSchema.parse(commandId),
      payload = ConfirmCheckoutSchema.parse(raw),
      payloadHash = checkoutPayloadHash(payload);
    return transaction(async (c) => {
      const actor = await identity(c, userId);
      // Lock an absent key as well: SELECT FOR UPDATE alone cannot serialize its first insert.
      await c.query("SELECT pg_advisory_xact_lock(19,hashtext($1))", [id]);
      const receipt = (
        await c.query<{
          user_id: string;
          endpoint: string;
          payload_hash: string;
          status_code: number;
          response_body: CheckoutConfirmation;
        }>(
          "SELECT * FROM public.app_command_receipts WHERE command_id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (receipt) {
        if (receipt.user_id !== userId)
          throw new CheckoutError("CHECKOUT_COMMAND_NOT_FOUND", 404);
        if (
          receipt.endpoint !== ENDPOINT ||
          receipt.payload_hash !== payloadHash
        )
          throw new CheckoutError("COMMAND_ID_REUSED_DIFFERENT_PAYLOAD", 409);
        return {
          statusCode: receipt.status_code,
          body: CheckoutConfirmationSchema.parse(receipt.response_body),
        };
      }
      if (
        (
          await c.query(
            "SELECT 1 FROM public.app_audit_events WHERE command_id=$1",
            [id],
          )
        ).rowCount
      )
        throw new CheckoutError("COMMAND_ID_REUSED_DIFFERENT_PAYLOAD", 409);
      const quote = (
        await c.query<QuoteRow & { live: boolean }>(
          `SELECT *,expires_at>clock_timestamp() AS live FROM public.app_checkout_quotes
        WHERE id=$1 AND user_id=$2 FOR UPDATE`,
          [payload.quoteId, userId],
        )
      ).rows[0];
      if (!quote) throw new CheckoutError("CHECKOUT_QUOTE_NOT_FOUND", 404);
      if (quote.is_consumed || !quote.live)
        throw new CheckoutError("CHECKOUT_QUOTE_EXPIRED", 410);
      if (!quote.cart_id || !quote.delivery_address_id)
        throw new CheckoutError("CHECKOUT_VALUES_CHANGED", 409);
      await ownedCart(c, userId, quote.cart_id);
      const current = (
        await c.query<CartItem>(
          "SELECT id,product_id,store_id,quantity,cut_type FROM public.app_cart_items WHERE cart_id=$1 ORDER BY product_id,id FOR UPDATE",
          [quote.cart_id],
        )
      ).rows;
      if (cartFingerprint(current) !== quote.cart_fingerprint)
        throw new CheckoutError("CHECKOUT_VALUES_CHANGED", 409);
      if (await pending(c, userId, quote.cart_id))
        throw new CheckoutError("CHECKOUT_ALREADY_PENDING", 409);
      const address = await c.query(
        `SELECT a.id FROM public.app_user_addresses a
        WHERE a.id=$1 AND a.person_id=$2 AND a.is_active
          AND public.fn_locality_coverage(a.state,a.city)='active' FOR SHARE OF a`,
        [quote.delivery_address_id, actor.personId],
      );
      if (!address.rowCount)
        throw new CheckoutError("CHECKOUT_VALUES_CHANGED", 409);
      const stores = z
        .array(CheckoutStoreSnapshotSchema)
        .parse(quote.items_snapshot);
      for (const store of stores)
        await DeliveryQuoteService.getActiveQuote(
          store.deliveryQuoteId,
          actor.personId,
          userId,
          c,
        );
      const items = stores
        .flatMap((s) => s.items)
        .sort(
          (a, b) =>
            a.productId.localeCompare(b.productId) ||
            a.cartItemId.localeCompare(b.cartItemId),
        );
      const reservations: CheckoutConfirmation["reservations"] = [];
      for (const item of items) {
        const held = await InventoryService.reserveStock(
          item.productId,
          item.quantity,
          "checkout_" + quote.id,
          c,
        );
        if (held.status !== "reserved")
          throw new CheckoutError("CHECKOUT_INSUFFICIENT_STOCK", 409);
        reservations.push(...held.reservations);
      }
      // Recheck after all freight/lot locks; expiry during processing rolls every hold back.
      const updated = await c.query(
        `UPDATE public.app_checkout_quotes SET is_consumed=true,reservation_ids=$2
        WHERE id=$1 AND NOT is_consumed AND expires_at>clock_timestamp() RETURNING id`,
        [quote.id, reservations.map((r) => r.id)],
      );
      if (!updated.rowCount)
        throw new CheckoutError("CHECKOUT_QUOTE_EXPIRED", 410);
      const expiry = new Date(
        Math.min(...reservations.map((r) => Date.parse(r.expiresAt))),
      );
      const intent = (
        await c.query<{ id: string; created_at: Date; expires_at: Date }>(
          `INSERT INTO public.app_payment_intents(command_id,quote_id,user_id,method,amount_cents,expires_at)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at,expires_at`,
          [
            id,
            quote.id,
            userId,
            payload.paymentMethod,
            quote.total_cents,
            expiry,
          ],
        )
      ).rows[0];
      const body = CheckoutConfirmationSchema.parse({
        commandId: id,
        quoteId: quote.id,
        paymentIntentId: intent.id,
        status: "pending_payment",
        paymentStatus: "pending",
        paymentMethod: payload.paymentMethod,
        totalCents: quote.total_cents,
        confirmedAt: intent.created_at.toISOString(),
        expiresAt: intent.expires_at.toISOString(),
        reservations,
      });
      await c.query(
        `INSERT INTO public.app_command_receipts(command_id,user_id,endpoint,payload_hash,status_code,response_body)
        VALUES($1,$2,$3,$4,201,$5)`,
        [id, userId, ENDPOINT, payloadHash, JSON.stringify(body)],
      );
      await audit(
        c,
        userId,
        "checkout.confirmed",
        quote.id,
        {
          paymentIntentId: intent.id,
          payloadHash,
          reservationCount: reservations.length,
          totalCents: quote.total_cents,
        },
        ctx,
        id,
      );
      return { statusCode: 201, body };
    });
  },
};
