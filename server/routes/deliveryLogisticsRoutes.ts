import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { DeliveryLogisticsService as service } from "../services/DeliveryLogisticsService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { CheckoutCommandIdSchema } from "../../shared/contracts/checkout.ts";
import { DeliveryWindowsQuerySchema } from "../../shared/contracts/deliveryLogistics.ts";
import { originProtection } from "../security/originProtection.ts";
export const deliveryLogisticsRouter = Router();
async function run(
  req: Request,
  res: Response,
  producer: boolean,
  work: (user: string) => Promise<unknown>,
) {
  res.set("Cache-Control", "private, no-store");
  if (!req.actor) {
    res.status(401).json({ error: "AUTH_REQUIRED", requestId: req.requestId });
    return;
  }
  if (producer && !req.actor.roles.includes("producer")) {
    res
      .status(403)
      .json({ error: "PRODUCER_REQUIRED", requestId: req.requestId });
    return;
  }
  try {
    res.json(await work(req.actor.userId));
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
const command = (req: Request) =>
  CheckoutCommandIdSchema.parse(req.headers["x-command-id"]);
const context = (req: Request) => ({
  requestId: req.requestId,
  ipHash: req.clientIpHash,
});
deliveryLogisticsRouter.get("/producer/delivery-windows", (req, res) =>
  run(req, res, true, (user) => {
    const q = { ...req.query };
    delete q.path;
    delete q.__hvm_path;
    return service.listWindows(user, DeliveryWindowsQuerySchema.parse(q).date);
  }),
);
deliveryLogisticsRouter.post(
  "/producer/delivery-windows",
  originProtection,
  (req, res) =>
    run(req, res, true, (user) =>
      service.saveWindow(user, null, req.body, command(req), context(req)),
    ),
);
deliveryLogisticsRouter.patch(
  "/producer/delivery-windows/:id",
  originProtection,
  (req, res) =>
    run(req, res, true, (user) =>
      service.saveWindow(
        user,
        req.params.id,
        req.body,
        command(req),
        context(req),
      ),
    ),
);
deliveryLogisticsRouter.post(
  "/producer/orders/:id/delivery-allocation",
  originProtection,
  (req, res) =>
    run(req, res, true, (user) =>
      service.allocateOrderToWindow(
        req.params.id,
        user,
        req.body,
        command(req),
        context(req),
      ),
    ),
);
deliveryLogisticsRouter.post(
  "/producer/orders/:id/delivery-proof",
  originProtection,
  (req, res) =>
    run(req, res, true, (user) =>
      service.registerDeliveryProof(
        req.params.id,
        user,
        req.body,
        command(req),
        context(req),
      ),
    ),
);
deliveryLogisticsRouter.get("/orders/:id/delivery", (req, res) =>
  run(req, res, false, (user) => service.tracking(req.params.id, user)),
);
