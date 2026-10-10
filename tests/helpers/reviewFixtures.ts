import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  checkoutAudit,
  checkoutBuyer,
  checkoutCatalog,
} from "./checkoutFixtures.ts";
import { CheckoutService } from "../../server/services/CheckoutService.ts";
import {
  PaymentService,
  settleVerifiedPayment,
} from "../../server/services/PaymentService.ts";
import { CommerceService } from "../../server/services/CommerceService.ts";
import { commerceTransaction } from "../../server/services/CommerceSupport.ts";
import { OrderService } from "../../server/services/OrderService.ts";
import { DeliveryLogisticsService } from "../../server/services/DeliveryLogisticsService.ts";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
import type { OrderStatus } from "../../shared/contracts/order.ts";
export async function reviewFixtures(pool: Pool) {
  const catalog = await checkoutCatalog(pool);
  const buyers: Awaited<ReturnType<typeof checkoutBuyer>>[] = [],
    admins: string[] = [];
  async function buyer(products: string[] = [catalog.pa]) {
    const b = await checkoutBuyer(pool, products, 2);
    buyers.push(b);
    return b;
  }
  async function paid(products?: string[]) {
    const b = await buyer(products),
      quote = await CheckoutService.createQuote(
        b.userId,
        b.cartId,
        b.addressId,
        checkoutAudit(),
      );
    const receipt = await CheckoutService.confirmCheckout(
      randomUUID(),
      { quoteId: quote.id, paymentMethod: "pix" },
      b.userId,
      checkoutAudit(),
    );
    await PaymentService.acceptPolicy(
      b.userId,
      receipt.body.paymentIntentId,
      (await CommerceService.policy()).policy.version,
      checkoutAudit(),
    );
    const verified = {
      provider: "t24_isolated_test",
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
      [verified.intentId, verified.paymentReference],
    );
    const result = await commerceTransaction((c) =>
      settleVerifiedPayment(c, verified, checkoutAudit()),
    );
    return {
      b,
      id: result.orderIds![0],
      ids: result.orderIds!,
      paymentId: verified.intentId,
    };
  }
  async function advance(
    p: Awaited<ReturnType<typeof paid>>,
    to: OrderStatus = "delivered",
    producer: string = catalog.a.userId,
  ) {
    await OrderService.transitionStatus(
      p.id,
      producer,
      "producer",
      { toStatus: "in_preparation", expectedRevision: 1 },
      randomUUID(),
      checkoutAudit(),
    );
    if (to === "in_preparation") return;
    await OrderService.transitionStatus(
      p.id,
      producer,
      "producer",
      { toStatus: "ready_for_dispatch", expectedRevision: 2 },
      randomUUID(),
      checkoutAudit(),
    );
    if (to === "ready_for_dispatch") return;
    const date = (
      await pool.query(
        "SELECT ((clock_timestamp() AT TIME ZONE timezone)::date+1)::text date FROM app_global_config WHERE singleton_guard",
      )
    ).rows[0].date;
    const day = new Date(date + "T12:00:00Z").getUTCDay();
    const existing = (
      await DeliveryLogisticsService.listWindows(producer, date)
    ).windows.find((w) => w.dayOfWeek === day);
    const window =
      existing ??
      (await DeliveryLogisticsService.saveWindow(
        producer,
        null,
        {
          dayOfWeek: day,
          startTime: "08:00",
          endTime: "12:00",
          maxOrdersCapacity: 100,
          isActive: true,
        },
        randomUUID(),
        checkoutAudit(),
      ));
    await DeliveryLogisticsService.allocateOrderToWindow(
      p.id,
      producer,
      { windowId: window.id, scheduledDate: date, expectedRevision: 3 },
      randomUUID(),
      checkoutAudit(),
    );
    await OrderService.transitionStatus(
      p.id,
      producer,
      "producer",
      { toStatus: "out_for_delivery", expectedRevision: 3 },
      randomUUID(),
      checkoutAudit(),
    );
    if (to === "out_for_delivery") return;
    await DeliveryLogisticsService.registerDeliveryProof(
      p.id,
      producer,
      { expectedRevision: 4, receivedByName: "Recebedor sintético T24" },
      randomUUID(),
      checkoutAudit(),
    );
  }
  async function delivered(products?: string[], producer?: string) {
    const p = await paid(products);
    await advance(p, "delivered", producer);
    return p;
  }
  async function admin(
    role: "platform_super_admin" | "platform_admin" = "platform_super_admin",
    sector = false,
  ) {
    const person = await buyer([]),
      id = randomUUID();
    admins.push(id);
    await pool.query(
      "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
      [id, id + "@example.test"],
    );
    await pool.query("UPDATE app_users SET status='active' WHERE id=$1", [id]);
    await pool.query(
      "INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role,email_verified_at) VALUES($1,$2,$3,$4,now())",
      [id, person.personId, id + "@example.test", role],
    );
    await pool.query(
      "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
      [id, role],
    );
    if (sector)
      await pool.query(
        "INSERT INTO app_admin_sector_members(user_id,sector_code) VALUES($1,'review_management')",
        [id],
      );
    return {
      userId: id,
      role,
      isSuperAdmin: role === "platform_super_admin",
      sectors: sector ? ["review_management"] : [],
      sessionIssuedAt: new Date().toISOString(),
    } as AdminActorContext;
  }
  return {
    catalog,
    buyer,
    paid,
    advance,
    delivered,
    admin,
    async cleanup() {
      for (const id of admins)
        await pool.query("DELETE FROM auth.users WHERE id=$1", [id]);
      for (const b of buyers.reverse()) await b.cleanup();
      await catalog.cleanup();
    },
  };
}
