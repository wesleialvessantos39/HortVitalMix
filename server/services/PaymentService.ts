import { z } from "zod";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { InventoryService } from "./InventoryService.ts";
import { OrderService } from "./OrderService.ts";
import {
  CommercePolicySchema,
  type PaymentView,
  type PosItem,
} from "../../shared/contracts/commerce.ts";
import {
  getPaymentGateway,
  type VerifiedPayment,
} from "../payments/gateway.ts";
import {
  CommerceError,
  commerceIdentity,
  commerceTransaction,
  commerceAudit,
  type CommerceAudit,
} from "./CommerceSupport.ts";
import type { CheckoutStoreSnapshot } from "../../shared/contracts/checkout.ts";

async function paymentRole(client: PoolClient, billingCycleId: string | null): Promise<"consumer" | "producer"> {
  if (!billingCycleId) return "consumer";
  const role = (await client.query("SELECT s.plan_snapshot->>'targetAudience' AS role FROM public.app_billing_cycles c JOIN public.app_subscriptions s ON s.id=c.subscription_id WHERE c.id=$1", [billingCycleId])).rows[0]?.role;
  if (role !== "consumer" && role !== "producer") throw new CommerceError("PAYMENT_NOT_FOUND", 404);
  return role;
}

const verifiedSchema = z
  .object({
    provider: z.string().min(1).max(32),
    eventId: z.string().min(1).max(128),
    paymentReference: z.string().min(1).max(128),
    intentId: z.uuid(),
    status: z.literal("approved"),
    amountCents: z.number().int().positive().max(2147483647),
    currency: z.literal("BRL"),
    method: z.enum(["pix", "credit_card", "debit_card"]),
    paidAt: z.iso.datetime(),
  })
  .strict();
export async function settleVerifiedPayment(
  client: PoolClient,
  input: VerifiedPayment,
  context: CommerceAudit,
) {
  const payment = verifiedSchema.parse(input);
  await client.query("SELECT pg_advisory_xact_lock(20,hashtext($1))", [
    "payment:" + payment.intentId,
  ]);
  const intent = (
    await client.query(
      `SELECT *,expires_at<=clock_timestamp() AS expired FROM public.app_payment_intents WHERE id=$1 FOR UPDATE`,
      [payment.intentId],
    )
  ).rows[0];
  if (!intent) throw new CommerceError("PAYMENT_NOT_FOUND", 404);
  const prior = (
    await client.query(
      "SELECT * FROM public.app_payment_transactions WHERE provider=$1 AND gateway_event_id=$2",
      [payment.provider, payment.eventId],
    )
  ).rows[0];
  if (prior) {
    if (
      prior.payment_intent_id !== intent.id ||
      prior.amount_received_cents !== payment.amountCents ||
      prior.event_type !== "approved"
    )
      throw new CommerceError("PAYMENT_EVENT_CONFLICT");
    return { status: "approved", replayed: true };
  }
  if (
    intent.amount_cents !== payment.amountCents ||
    intent.method !== payment.method
  )
    throw new CommerceError("PAYMENT_VALUES_MISMATCH");
  if (!intent.gateway_reference) throw new CommerceError("PAYMENT_REFERENCE_MISSING");
  if (intent.gateway_reference !== payment.paymentReference)
    throw new CommerceError("PAYMENT_REFERENCE_MISMATCH");
  if (intent.status !== "pending") {
    if (
      intent.status === "approved" &&
      intent.gateway_reference === payment.paymentReference
    )
      return { status: "approved", replayed: true };
    throw new CommerceError("PAYMENT_STATE_CONFLICT");
  }
  if (
    intent.expired ||
    Date.parse(payment.paidAt) > Date.now() + 30000 ||
    Date.parse(payment.paidAt) > new Date(intent.expires_at).getTime()
  )
    throw new CommerceError("PAYMENT_EXPIRED");
  await commerceIdentity(client, intent.user_id, intent.billing_cycle_id ? undefined : "consumer");
  // The same lock used by T18/T19 serializes a settlement with cart mutations.
  await client.query("SELECT pg_advisory_xact_lock(18,hashtext($1))", [
    "user:" + intent.user_id,
  ]);
  const acceptance = (
    await client.query(
      "SELECT policy_snapshot FROM public.app_payment_policy_acceptances WHERE payment_intent_id=$1 AND user_id=$2",
      [intent.id, intent.user_id],
    )
  ).rows[0];
  if (!acceptance) throw new CommerceError("POLICY_ACCEPTANCE_REQUIRED");
  const policy = CommercePolicySchema.parse(acceptance.policy_snapshot);
  // T23 explicit billing source: membership billing never consumes T18 stock,
  // creates delivery facts, or releases T20 order holds.
  if (intent.billing_cycle_id) {
    const cycle = (await client.query(`SELECT b.*,s.user_id,s.status AS subscription_status,s.producer_profile_id
      FROM public.app_billing_cycles b JOIN public.app_subscriptions s ON s.id=b.subscription_id
      WHERE b.id=$1 FOR UPDATE OF s,b`, [intent.billing_cycle_id])).rows[0];
    if (!cycle || cycle.user_id !== intent.user_id || cycle.payment_intent_id !== intent.id || cycle.amount_cents !== intent.amount_cents || cycle.status !== "pending")
      throw new CommerceError("BILLING_CYCLE_INVALID", 409);
    await client.query("UPDATE public.app_billing_cycles SET status='paid' WHERE id=$1", [cycle.id]);
    await client.query(`UPDATE public.app_subscriptions SET status=CASE WHEN status='cancelled' THEN 'cancelled' WHEN status='paused' AND pause_until>clock_timestamp() THEN 'paused' ELSE 'active' END,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`, [cycle.subscription_id]);
    if (cycle.producer_profile_id) await client.query("UPDATE public.app_trial_grants SET is_converted=true WHERE producer_profile_id=$1", [cycle.producer_profile_id]);
    await client.query("UPDATE public.app_payment_intents SET status='approved',updated_at=clock_timestamp() WHERE id=$1", [intent.id]);
    await client.query("INSERT INTO public.app_payment_transactions(provider,gateway_event_id,payment_intent_id,event_type,amount_received_cents,raw_payload) VALUES($1,$2,$3,'approved',$4,$5)", [payment.provider,payment.eventId,intent.id,payment.amountCents,JSON.stringify(payment)]);
    await commerceAudit(client,intent.user_id,cycle.producer_profile_id?"producer":"consumer","subscription.cycle_paid","app_billing_cycles",cycle.id,{subscriptionId:cycle.subscription_id,cycleIndex:cycle.cycle_index,amountCents:payment.amountCents},context);
    return {status:"approved",replayed:false,orderIds:[] as string[],subscriptionId:cycle.subscription_id};
  }
  let stores: Array<{
      storeId: string;
      storeName: string;
      storeSlug: string;
      subtotalCents: number;
      deliveryFeeCents: number;
      items: PosItem[];
    }>,
    reservationIds: string[],
    address: unknown = null;
  let cartId: string | null = null;
  if (intent.quote_id) {
    const quote = (
      await client.query(
        "SELECT * FROM public.app_checkout_quotes WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [intent.quote_id, intent.user_id],
      )
    ).rows[0];
    if (
      !quote?.is_consumed ||
      quote.total_cents !== intent.amount_cents ||
      quote.discount_cents !== 0
    )
      throw new CommerceError("PAYMENT_QUOTE_INVALID");
    stores = (quote.items_snapshot as CheckoutStoreSnapshot[]).map((store) => ({
      ...store,
      items: store.items.map((item) => ({
        productId: item.productId,
        title: item.title,
        quantity: item.quantity,
        unitType: item.unitType,
        unitPriceCents: item.unitPriceCents,
        totalPriceCents: item.totalPriceCents,
        priceVersionId: item.priceVersionId,
      })),
    }));
    reservationIds = quote.reservation_ids;
    address = quote.address_snapshot;
    cartId = quote.cart_id;
  } else {
    const sale = (
      await client.query(
        "SELECT * FROM public.app_pos_sales WHERE id=$1 AND customer_user_id=$2 FOR UPDATE",
        [intent.pos_sale_id, intent.user_id],
      )
    ).rows[0];
    if (
      !sale ||
      sale.status !== "accepted" ||
      sale.total_cents !== intent.amount_cents
    )
      throw new CommerceError("POS_SALE_INVALID");
    stores = [
      {
        storeId: sale.store_id,
        storeName: sale.store_snapshot.name,
        storeSlug: sale.store_snapshot.slug,
        subtotalCents: sale.total_cents,
        deliveryFeeCents: 0,
        items: sale.items_snapshot,
      },
    ];
    reservationIds = sale.reservation_ids;
  }
  if (
    !reservationIds.length ||
    new Set(reservationIds).size !== reservationIds.length
  )
    throw new CommerceError("PAYMENT_RESERVATIONS_INVALID");
  // Global lots-first locking follows T15 and prevents deadlocks with expiry.
  const held = (
    await client.query(
      `SELECT r.*,l.product_id FROM public.app_inventory_reservations r JOIN public.app_inventory_lots l ON l.id=r.lot_id WHERE r.id=ANY($1::uuid[]) ORDER BY l.id,r.id`,
      [reservationIds],
    )
  ).rows;
  await client.query(
    "SELECT id FROM public.app_inventory_lots WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [[...new Set(held.map((row) => row.lot_id))]],
  );
  if (held.length !== reservationIds.length)
    throw new CommerceError("PAYMENT_RESERVATIONS_INVALID");
  const expected = new Map<string, number>();
  for (const item of stores.flatMap((store) => store.items))
    expected.set(
      item.productId,
      (expected.get(item.productId) ?? 0) + item.quantity,
    );
  for (const reservation of held) {
    const left = expected.get(reservation.product_id);
    if (left === undefined || left < reservation.quantity)
      throw new CommerceError("PAYMENT_RESERVATIONS_INVALID");
    expected.set(reservation.product_id, left - reservation.quantity);
  }
  if ([...expected.values()].some((q) => q !== 0))
    throw new CommerceError("PAYMENT_RESERVATIONS_INVALID");
  const orderIds: string[] = [];
  for (const store of stores) {
    const owner = (
      await client.query(
        `SELECT pe.user_id FROM public.app_producer_stores s JOIN public.app_producer_profiles pp ON pp.id=s.producer_profile_id JOIN public.app_people pe ON pe.id=pp.person_id WHERE s.id=$1`,
        [store.storeId],
      )
    ).rows[0];
    if (!owner) throw new CommerceError("PAYMENT_STORE_UNAVAILABLE");
    const order = (
      await client.query(
        `INSERT INTO public.app_orders(payment_intent_id,customer_user_id,producer_user_id,store_id,store_snapshot,source,items_snapshot,address_snapshot,subtotal_cents,delivery_fee_cents,total_cents,policy_snapshot,status,received_at)
      VALUES($1,$2,$3,$4,$5,$6::varchar,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $6::varchar='pos' THEN clock_timestamp() ELSE NULL END) RETURNING id,received_at`,
        [
          intent.id,
          intent.user_id,
          owner.user_id,
          store.storeId,
          JSON.stringify({ name: store.storeName, slug: store.storeSlug }),
          intent.pos_sale_id ? "pos" : "online",
          JSON.stringify(store.items),
          address ? JSON.stringify(address) : null,
          store.subtotalCents,
          store.deliveryFeeCents,
          store.subtotalCents + store.deliveryFeeCents,
          JSON.stringify(policy),
          intent.pos_sale_id ? "received" : "confirmed",
        ],
      )
    ).rows[0];
    orderIds.push(order.id);
    const products = new Set(store.items.map((item) => item.productId));
    for (const reservation of held.filter((row) =>
      products.has(row.product_id),
    ))
      await InventoryService.consumeReservation(
        reservation.id,
        order.id,
        intent.user_id,
        client,
      );
    const days = Math.max(
      policy.holdingDays,
      intent.pos_sale_id
        ? policy.inPersonReturnDays
        : policy.onlineWithdrawalDays,
    );
    await client.query(
      `INSERT INTO public.app_financial_holds(order_id,amount_cents,release_after) VALUES($1,$2,CASE WHEN $3::timestamptz IS NULL THEN NULL ELSE $3::timestamptz+make_interval(days=>$4) END)`,
      [
        order.id,
        store.subtotalCents + store.deliveryFeeCents,
        order.received_at,
        days,
      ],
    );
  }
  await client.query(
    `UPDATE public.app_payment_intents SET status='approved',gateway_reference=$2,updated_at=clock_timestamp() WHERE id=$1`,
    [intent.id, payment.paymentReference],
  );
  await OrderService.createFromApprovedIntent(intent.id, client);
  await client.query(
    "INSERT INTO public.app_payment_transactions(provider,gateway_event_id,payment_intent_id,event_type,amount_received_cents,raw_payload) VALUES($1,$2,$3,'approved',$4,$5)",
    [payment.provider, payment.eventId, intent.id, payment.amountCents,JSON.stringify(payment)],
  );
  if (intent.pos_sale_id)
    await client.query(
      "UPDATE public.app_pos_sales SET status='paid' WHERE id=$1",
      [intent.pos_sale_id],
    );
  if (cartId) {
    const quote = (
      await client.query(
        "SELECT items_snapshot FROM public.app_checkout_quotes WHERE id=$1",
        [intent.quote_id],
      )
    ).rows[0];
    // Remove only the purchased snapshot quantities; preserve additions T18.
    for (const item of (
      quote.items_snapshot as CheckoutStoreSnapshot[]
    ).flatMap((store) => store.items)) {
      await client.query(
        "DELETE FROM public.app_cart_items WHERE id=$1 AND cart_id=$2 AND quantity<=$3",
        [item.cartItemId, cartId, item.quantity],
      );
      await client.query(
        "UPDATE public.app_cart_items SET quantity=quantity-$3 WHERE id=$1 AND cart_id=$2 AND quantity>$3",
        [item.cartItemId, cartId, item.quantity],
      );
    }
  }
  await commerceAudit(
    client,
    intent.user_id,
    "consumer",
    "payment.approved",
    "app_payment_intents",
    intent.id,
    { orderIds, amountCents: payment.amountCents, provider: payment.provider },
    context,
  );
  return { status: "approved", replayed: false, orderIds };
}
export const PaymentService = {
  // Added T23 adapter around the SAME T20 gateway. Each durable cycle has one
  // intent and one provider attempt; uncertain attempts require reconciliation.
  async createPixIntent(userId:string,cycleId:string,context:CommerceAudit):Promise<PaymentView> {
    z.uuid().parse(cycleId);
    const gateway=getPaymentGateway();
    if(!gateway)throw new CommerceError("GATEWAY_NOT_CONFIGURED",503);
    const uuid=(label:string)=>{const hex=createHash("sha256").update(label+":"+cycleId).digest("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;};
    const intentId=uuid("t23-pix-intent"),commandId=uuid("t23-pix-receipt");
    const claim=await commerceTransaction(async client=>{
      await commerceIdentity(client,userId);
      await client.query("SELECT pg_advisory_xact_lock(20,hashtext($1))",["payment:"+intentId]);
      const cycle=(await client.query(`SELECT b.*,s.user_id,s.plan_snapshot->>'targetAudience' AS actor_role FROM public.app_billing_cycles b JOIN public.app_subscriptions s ON s.id=b.subscription_id WHERE b.id=$1 AND s.user_id=$2 FOR UPDATE OF b`,[cycleId,userId])).rows[0];
      if(!cycle)throw new CommerceError("BILLING_CYCLE_NOT_FOUND",404);
      if(cycle.payment_creation_state==="uncertain")throw new CommerceError("PIX_RECONCILIATION_REQUIRED",409);
      if(cycle.payment_creation_state!=="waiting"||cycle.status!=="pending")return {attempt:false,amountCents:cycle.amount_cents,expiresAt:""};
      if(cycle.amount_cents<=0)throw new CommerceError("BILLING_CYCLE_INVALID",422);
      const expiresAt=new Date(Date.now()+15*60000).toISOString();
      const payload={cycleId,amountCents:cycle.amount_cents,method:"pix"};
      await client.query(`INSERT INTO public.app_command_receipts(command_id,user_id,endpoint,payload_hash,status_code,response_body) VALUES($1,$2,'/v1/subscriptions/billing/pix',$3,201,$4)`,[commandId,userId,createHash("sha256").update(JSON.stringify(payload)).digest("hex"),JSON.stringify({paymentIntentId:intentId,...payload})]);
      await client.query("INSERT INTO public.app_payment_intents(id,command_id,user_id,method,amount_cents,expires_at,billing_cycle_id) VALUES($1,$2,$3,'pix',$4,$5,$6)",[intentId,commandId,userId,cycle.amount_cents,expiresAt,cycleId]);
      await client.query("UPDATE public.app_billing_cycles SET payment_intent_id=$2,payment_creation_state='requested' WHERE id=$1",[cycleId,intentId]);
      await commerceAudit(client,userId,cycle.actor_role,"subscription.pix_requested","app_payment_intents",intentId,{cycleId,amountCents:cycle.amount_cents},context);
      return {attempt:true,amountCents:cycle.amount_cents,expiresAt};
    });
    if(claim.attempt) {
      try {
        const result=await gateway.createPayment({intentId,amountCents:claim.amountCents,method:"pix",expiresAt:claim.expiresAt,channel:"online"});
        const reference=z.string().min(1).max(128).parse(result.reference);
        await commerceTransaction(async client=>{
          await client.query("SELECT pg_advisory_xact_lock(20,hashtext($1))",["payment:"+intentId]);
          await client.query("UPDATE public.app_payment_intents SET gateway_reference=$2,pix_copy_paste=$3,pix_qr_code_base64=$4,updated_at=clock_timestamp() WHERE id=$1 AND gateway_reference IS NULL",[intentId,reference,result.pixCopyPaste,result.pixQrCodeBase64]);
          await client.query("UPDATE public.app_billing_cycles SET payment_creation_state='ready' WHERE id=$1",[cycleId]);
        });
      } catch {
        await commerceTransaction(async client=>{await client.query("UPDATE public.app_billing_cycles SET payment_creation_state='uncertain' WHERE id=$1 AND payment_creation_state='requested'",[cycleId]);}).catch(()=>{});
        throw new CommerceError("PIX_CREATION_UNCERTAIN",503);
      }
    }
    return this.view(userId,intentId);
  },
  async view(userId: string, id: string, selectedRole?: "consumer"|"producer"): Promise<PaymentView> {
    return commerceTransaction(async (client) => {
      await commerceIdentity(client, userId);
      z.uuid().parse(id);
      const intent = (
        await client.query(
          "SELECT * FROM public.app_payment_intents WHERE id=$1 AND user_id=$2",
          [id, userId],
        )
      ).rows[0];
      if (!intent) throw new CommerceError("PAYMENT_NOT_FOUND", 404);
      const requiredRole = await paymentRole(client, intent.billing_cycle_id);
      await commerceIdentity(client,userId,requiredRole);
      if(selectedRole && selectedRole!==requiredRole)throw new CommerceError(requiredRole==="consumer"?"CONSUMER_REQUIRED":"PRODUCER_REQUIRED",403);
      const acceptance = (
        await client.query(
          "SELECT policy_snapshot FROM public.app_payment_policy_acceptances WHERE payment_intent_id=$1",
          [id],
        )
      ).rows[0];
      const settings = (
        await client.query(
          "SELECT policy FROM public.app_commerce_settings WHERE id=true",
        )
      ).rows[0];
      return {
        id: intent.id,
        method: intent.method,
        status: intent.status,
        amountCents: intent.amount_cents,
        expiresAt: intent.expires_at.toISOString(),
        gatewayAvailable: !!getPaymentGateway(),
        pixCopyPaste: intent.pix_copy_paste,
        pixQrCodeBase64: intent.pix_qr_code_base64,
        ...(intent.billing_cycle_id ? {subscriptionId:(await client.query("SELECT subscription_id FROM public.app_billing_cycles WHERE id=$1",[intent.billing_cycle_id])).rows[0]?.subscription_id} : {}),
        orderIds: (
          await client.query(
            "SELECT id FROM public.app_orders WHERE payment_intent_id=$1 AND customer_user_id=$2",
            [id, userId],
          )
        ).rows.map((row) => row.id),
        policy: CommercePolicySchema.parse(
          acceptance?.policy_snapshot ?? settings.policy,
        ),
      };
    });
  },
  async acceptPolicy(
    userId: string,
    id: string,
    version: number,
    context: CommerceAudit,
    selectedRole?: "consumer"|"producer",
  ) {
    return commerceTransaction(async (client) => {
      await commerceIdentity(client, userId);
      z.uuid().parse(id);
      await client.query("SELECT pg_advisory_xact_lock(20,hashtext($1))", [
        "payment:" + id,
      ]);
      const intent = (
        await client.query(
          "SELECT * FROM public.app_payment_intents WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [id, userId],
        )
      ).rows[0];
      if (!intent) throw new CommerceError("PAYMENT_NOT_FOUND", 404);
      const requiredRole = await paymentRole(client, intent.billing_cycle_id);
      await commerceIdentity(client,userId,requiredRole);
      if(selectedRole&&selectedRole!==requiredRole)throw new CommerceError(requiredRole==="consumer"?"CONSUMER_REQUIRED":"PRODUCER_REQUIRED",403);
      const accepted = (
        await client.query(
          "SELECT policy_snapshot FROM public.app_payment_policy_acceptances WHERE payment_intent_id=$1",
          [id],
        )
      ).rows[0];
      if (accepted)
        return { accepted: true, version: accepted.policy_snapshot.version };
      if (
        intent.status !== "pending" ||
        new Date(intent.expires_at).getTime() <= Date.now()
      )
        throw new CommerceError("PAYMENT_EXPIRED");
      const policy = CommercePolicySchema.parse(
        (
          await client.query(
            "SELECT policy FROM public.app_commerce_settings WHERE id=true FOR SHARE",
          )
        ).rows[0].policy,
      );
      if (policy.version !== version) throw new CommerceError("POLICY_CHANGED");
      await client.query(
        "INSERT INTO public.app_payment_policy_acceptances(payment_intent_id,user_id,policy_snapshot) VALUES($1,$2,$3)",
        [id, userId, JSON.stringify(policy)],
      );
      await commerceAudit(
        client,
        userId,
        "consumer",
        "payment.policy_accepted",
        "app_payment_intents",
        id,
        { version },
        context,
      );
      return { accepted: true, version };
    });
  },
  async webhook(
    input: {
      body: unknown;
      headers: Record<string, unknown>;
      query: Record<string, unknown>;
    },
    context: CommerceAudit,
  ) {
    const gateway = getPaymentGateway();
    if (!gateway) throw new CommerceError("GATEWAY_NOT_CONFIGURED", 503);
    let verified: VerifiedPayment;
    try {
      verified = await gateway.verifyAndRetrievePayment(input);
    } catch {
      throw new CommerceError("WEBHOOK_UNVERIFIED", 401);
    }
    if (verified.provider !== gateway.provider)
      throw new CommerceError("WEBHOOK_UNVERIFIED", 401);
    return commerceTransaction((client) =>
      settleVerifiedPayment(client, verified, context),
    );
  },
};
