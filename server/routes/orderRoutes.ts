import { publicUser, publicRole } from "../security/publicRole.ts";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { OrderService } from "../services/OrderService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import {
  OrderIdSchema,
  OrderListQuerySchema,
  TransitionOrderSchema,
} from "../../shared/contracts/order.ts";
import { CheckoutCommandIdSchema } from "../../shared/contracts/checkout.ts";
import { originProtection } from "../security/originProtection.ts";

export const orderRouter = Router();
async function run(
  req: Request,
  res: Response,
  operation: (userId: string) => Promise<unknown>,
  producer = false,
) {
  res.set("Cache-Control", "private, no-store");
  if (
    !req.actor ||
    !req.actor.roles.some((role) => role === "consumer" || role === "producer")
  ) {
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
    const userId = publicUser(req, producer ? "producer" : undefined);
    if (!producer && req.path === "/orders") publicUser(req,"consumer");
    res.json(await operation(userId));
  } catch (error) {
    res
      .status(
        error instanceof CommerceError
          ? error.status
          : error instanceof z.ZodError
            ? 422
            : 503,
      )
      .json({
        error:
          error instanceof CommerceError
            ? error.code
            : error instanceof z.ZodError
              ? "VALIDATION_ERROR"
              : "DEPENDENCY_UNAVAILABLE",
        requestId: req.requestId,
      });
  }
}
function listQuery(req: Request) {
  const query = { ...req.query };
  delete query.path;
  delete query.__hvm_path;
  return OrderListQuerySchema.parse(query);
}
orderRouter.get("/orders", (req, res) =>
  run(req, res, (userId) =>
    OrderService.list(userId, "customer", listQuery(req)),
  ),
);
orderRouter.get("/producer/orders", (req, res) =>
  run(
    req,
    res,
    (userId) => OrderService.list(userId, "producer", listQuery(req)),
    true,
  ),
);
orderRouter.get("/orders/:id", (req, res) =>
  run(req, res, (userId) =>
    OrderService.get(OrderIdSchema.parse(req.params.id), userId, publicRole(req) === "producer" ? "producer" : "customer"),
  ),
);
orderRouter.post(
  "/producer/orders/:id/transitions",
  originProtection,
  (req, res) =>
    run(
      req,
      res,
      (userId) =>
        OrderService.transitionStatus(
          OrderIdSchema.parse(req.params.id),
          userId,
          "producer",
          TransitionOrderSchema.parse(req.body),
          CheckoutCommandIdSchema.parse(req.headers["x-command-id"]),
          { requestId: req.requestId, ipHash: req.clientIpHash },
        ),
      true,
    ),
);
