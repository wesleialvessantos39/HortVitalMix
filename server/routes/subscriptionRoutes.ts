import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { SubscriptionService as service } from "../services/SubscriptionService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { CheckoutCommandIdSchema } from "../../shared/contracts/checkout.ts";
import { originProtection } from "../security/originProtection.ts";
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
  if (!req.actor) throw new CommerceError("AUTH_REQUIRED", 401);
  return req.actor.userId;
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
  requireAdminSector("payment_configuration"),
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
