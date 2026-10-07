import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { checkoutAudit, checkoutBuyer } from "./checkoutFixtures.ts";
import { CheckoutService } from "../../server/services/CheckoutService.ts";
import { CommerceService } from "../../server/services/CommerceService.ts";
import {
  PaymentService,
  settleVerifiedPayment,
} from "../../server/services/PaymentService.ts";
import { commerceTransaction } from "../../server/services/CommerceSupport.ts";
// Synthetic gateway acknowledgements are restricted to the local disposable DB.
export async function paidOrder(pool: Pool, product: string) {
  if (
    ![
      process.env.HVM_T21_LOCAL_DATABASE_URL,
      process.env.HVM_T22_LOCAL_DATABASE_URL,
    ].some((v) => v && new URL(v).hostname === "127.0.0.1")
  )
    throw Error("LOCAL_PAYMENT_FIXTURE_REQUIRED");
  const buyer = await checkoutBuyer(pool, [product]),
    quote = await CheckoutService.createQuote(
      buyer.userId,
      buyer.cartId,
      buyer.addressId,
      checkoutAudit(),
    );
  const receipt = await CheckoutService.confirmCheckout(
    randomUUID(),
    { quoteId: quote.id, paymentMethod: "pix" },
    buyer.userId,
    checkoutAudit(),
  );
  await PaymentService.acceptPolicy(
    buyer.userId,
    receipt.body.paymentIntentId,
    (await CommerceService.policy()).policy.version,
    checkoutAudit(),
  );
  const payment = {
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
  await pool.query(
    "UPDATE app_payment_intents SET gateway_reference=$2 WHERE id=$1",
    [payment.intentId, payment.paymentReference],
  );
  const result = await commerceTransaction((c) =>
    settleVerifiedPayment(c, payment, checkoutAudit()),
  );
  return { buyer, id: result.orderIds![0] };
}
