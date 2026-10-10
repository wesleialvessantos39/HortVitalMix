import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { SubscriptionService as service } from "../services/SubscriptionService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { CheckoutCommandIdSchema } from "../../shared/contracts/checkout.ts";
import { originProtection } from "../security/originProtection.ts";
import { publicUser } from "../security/publicRole.ts";
import { businessQuery } from "../security/businessQuery.ts";
import { SubscriptionRefundService } from "../services/SubscriptionRefundService.ts";
import { AdminSubscriptionService } from "../services/AdminSubscriptionService.ts";
import {
  adminSessionMiddleware,
  requireAdminSector,
  requireRecentAuth,
} from "../middleware/adminSession.ts";
export const subscriptionRouter = Router(),
  adminSubscriptionRouter = Router();
const context = (req: Request) => ({
  requestId: req.requestId,
  ipHash: req.clientIpHash,
});
const command = (req: Request) =>
  CheckoutCommandIdSchema.parse(req.headers["x-command-id"]);
const user = (req: Request) => {
  return publicUser(req);
};
async function run(
  req: Request,
  res: Response,
  privateRead: boolean,
  work: () => Promise<unknown>,
) {
  res.set("Cache-Control", privateRead ? "private, no-store" : "no-store");
  try {
    res.json(await work());
  } catch (e) {
    res
      .status(
        e instanceof CommerceError
          ? e.status
          : e instanceof z.ZodError
            ? 422
            : 503,
      )
      .json({
        error:
          e instanceof CommerceError
            ? e.code
            : e instanceof z.ZodError
              ? "VALIDATION_ERROR"
              : "DEPENDENCY_UNAVAILABLE",
        requestId: req.requestId,
      });
  }
}
subscriptionRouter.get("/subscription-plans", (req, res) =>
  run(req, res, false, () =>
    service.publicPlans(
      z.enum(["consumer", "producer"]).parse(req.query.audience ?? "consumer"),
    ),
  ),
);
subscriptionRouter.get("/subscription-options/:storeId", (req, res) =>
  run(req, res, false, () => service.options(req.params.storeId)),
);
subscriptionRouter.get("/subscriptions", (req, res) =>
  run(req, res, true, () => service.mine(user(req))),
);
subscriptionRouter.get("/subscription-refund-policy", (req, res) =>
  run(req, res, false, () => SubscriptionRefundService.publicPolicy()),
);
subscriptionRouter.get("/subscriptions/:id/cancellation", (req, res) =>
  run(req, res, true, () =>
    SubscriptionRefundService.cancellationQuote(user(req), req.params.id),
  ),
);
subscriptionRouter.get("/subscription-refunds", (req, res) =>
  run(req, res, true, () =>
    SubscriptionRefundService.list(user(req), businessQuery(req)),
  ),
);
subscriptionRouter.post("/subscription-refunds", originProtection, (req, res) =>
  run(req, res, true, () =>
    SubscriptionRefundService.request(
      user(req),
      req.body,
      command(req),
      context(req),
    ),
  ),
);
subscriptionRouter.post(
  "/subscription-refunds/:id/messages",
  originProtection,
  (req, res) =>
    run(req, res, true, () =>
      SubscriptionRefundService.comment(
        user(req),
        req.params.id,
        z.object({ note: z.string() }).strict().parse(req.body).note,
        command(req),
        context(req),
      ),
    ),
);
adminSubscriptionRouter.use(
  "/subscription-refund-policy",
  adminSessionMiddleware,
  requireAdminSector("refund_policy"),
);
adminSubscriptionRouter.get("/subscription-refund-policy", (req, res) =>
  run(req, res, true, () =>
    SubscriptionRefundService.adminPolicy(req.adminActor!),
  ),
);
adminSubscriptionRouter.post(
  "/subscription-refund-policy",
  originProtection,
  requireRecentAuth,
  (req, res) =>
    run(req, res, true, () =>
      SubscriptionRefundService.savePolicy(
        req.adminActor!,
        req.body,
        command(req),
        context(req),
      ),
    ),
);
adminSubscriptionRouter.use(
  "/subscription-refunds",
  adminSessionMiddleware,
  requireAdminSector("refund_management"),
);
adminSubscriptionRouter.get("/subscription-refunds", (req, res) =>
  run(req, res, true, () =>
    SubscriptionRefundService.list(
      req.adminActor!.userId,
      businessQuery(req),
      req.adminActor!,
    ),
  ),
);
adminSubscriptionRouter.post(
  "/subscription-refunds/:id/decision",
  originProtection,
  requireRecentAuth,
  (req, res) =>
    run(req, res, true, () =>
      SubscriptionRefundService.decide(
        req.adminActor!,
        req.params.id,
        req.body,
        command(req),
        context(req),
      ),
    ),
);
adminSubscriptionRouter.post(
  "/subscription-refunds/:id/process",
  originProtection,
  requireRecentAuth,
  (req, res) =>
    run(req, res, true, () =>
      SubscriptionRefundService.process(
        req.adminActor!,
        req.params.id,
        context(req),
      ),
    ),
);
adminSubscriptionRouter.post(
  "/subscription-refunds/:id/messages",
  originProtection,
  requireRecentAuth,
  (req, res) =>
    run(req, res, true, () =>
      SubscriptionRefundService.comment(
        req.adminActor!.userId,
        req.params.id,
        z.object({ note: z.string() }).strict().parse(req.body).note,
        command(req),
        context(req),
        req.adminActor!,
      ),
    ),
);
subscriptionRouter.get("/producer/trial", (req, res) =>
  run(req, res, true, () => service.producerTrial(user(req))),
);
subscriptionRouter.post("/subscriptions", originProtection, (req, res) =>
  run(req, res, true, () =>
    service.createSubscription(user(req), req.body, command(req), context(req)),
  ),
);
for (const action of ["pause", "resume", "cancel"] as const)
  subscriptionRouter.post(
    "/subscriptions/:id/" + action,
    originProtection,
    (req, res) =>
      run(req, res, true, () =>
        service.changeSubscription(
          user(req),
          req.params.id,
          action,
          req.body,
          command(req),
          context(req),
        ),
      ),
  );
subscriptionRouter.post(
  "/subscriptions/:id/billing",
  originProtection,
  (req, res) =>
    run(req, res, true, () =>
      service.runBillingCycle(
        req.params.id,
        user(req),
        req.body,
        command(req),
        context(req),
      ),
    ),
);
adminSubscriptionRouter.use(
  "/subscription-plans",
  adminSessionMiddleware,
  requireAdminSector("subscription_management"),
);
adminSubscriptionRouter.use(
  "/subscriptions",
  adminSessionMiddleware,
  requireAdminSector("subscription_management"),
);
adminSubscriptionRouter.get("/subscriptions", (req, res) =>
  run(req, res, true, () =>
    AdminSubscriptionService.list(req.adminActor!, businessQuery(req)),
  ),
);
adminSubscriptionRouter.get("/subscriptions/:id", (req, res) =>
  run(req, res, true, () =>
    AdminSubscriptionService.detail(req.adminActor!, req.params.id),
  ),
);
adminSubscriptionRouter.post(
  "/subscriptions/:id/cancel",
  originProtection,
  requireRecentAuth,
  (req, res) =>
    run(req, res, true, () =>
      AdminSubscriptionService.cancel(
        req.adminActor!,
        req.params.id,
        req.body,
        command(req),
        context(req),
      ),
    ),
);
adminSubscriptionRouter.get("/subscription-plans", (req, res) =>
  run(req, res, true, () => service.adminPlans(req.adminActor!)),
);
adminSubscriptionRouter.post(
  "/subscription-plans",
  originProtection,
  requireRecentAuth,
  (req, res) =>
    run(req, res, true, () =>
      service.savePlan(
        req.adminActor!,
        null,
        req.body,
        command(req),
        context(req),
      ),
    ),
);
adminSubscriptionRouter.patch(
  "/subscription-plans/:id",
  originProtection,
  requireRecentAuth,
  (req, res) =>
    run(req, res, true, () =>
      service.savePlan(
        req.adminActor!,
        req.params.id,
        req.body,
        command(req),
        context(req),
      ),
    ),
);
