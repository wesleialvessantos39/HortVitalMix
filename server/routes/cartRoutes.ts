import { publicRole } from "../security/publicRole.ts";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  AddCartItemSchema,
  AddHortiMixSchema,
  UpdateCartItemSchema,
  RemoveCartItemSchema,
} from "../../shared/contracts/cart.ts";
import { CartService, CartError } from "../services/CartService.ts";
import { cartSession } from "../security/cartSession.ts";
import { originProtection } from "../security/originProtection.ts";

export const cartRouter = Router();
function validQuery(req: Request) {
  const params = new URL(req.url, "http://localhost").searchParams;
  params.delete("path");
  params.delete("__hvm_path");
  return params.size === 0;
}
async function run(
  req: Request,
  res: Response,
  operation: (scope: {
    sessionId: string;
    userId?: string;
  }) => Promise<unknown>,
) {
  if (!validQuery(req)) {
    res.status(400).json({ error: "VALIDATION_ERROR" });
    return;
  }
  // Failed/expired authentication must not silently turn a signed-in mutation
  // into a new guest basket. api.ts can refresh a 401 through the existing flow.
  if (
    !req.actor &&
    (req.headers.authorization ||
      /(?:^|;\s*)hvm_access=/.test(req.headers.cookie ?? ""))
  ) {
    res.status(401).json({ error: "AUTH_REQUIRED", requestId: req.requestId });
    return;
  }
  if (
    req.actor &&
    !req.actor.roles.includes("consumer")
  ) {
    res
      .status(403)
      .json({ error: "CART_OWNER_REQUIRED", requestId: req.requestId });
    return;
  }
  if (req.actor) {
    try { if (publicRole(req) !== "consumer") throw new Error(); }
    catch { res.status(403).json({ error: "CONSUMER_REQUIRED", requestId: req.requestId }); return; }
  }
  let sessionId = cartSession(req, res);
  try {
    let result;
    try {
      result = await operation({ sessionId, userId: req.actor?.userId });
    } catch (error) {
      if (!(error instanceof CartError) || error.code !== "CART_SESSION_OWNED")
        throw error;
      sessionId = cartSession(req, res, true);
      result = await operation({ sessionId, userId: req.actor?.userId });
    }
    res.json(result);
  } catch (error) {
    res
      .status(
        error instanceof CartError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : 503,
      )
      .json({
        error:
          error instanceof CartError
            ? error.code
            : error instanceof z.ZodError
              ? "VALIDATION_ERROR"
              : "DEPENDENCY_UNAVAILABLE",
        requestId: req.requestId,
      });
  }
}
const context = (req: Request) => ({
  requestId: req.requestId,
  ipHash: req.clientIpHash,
});
cartRouter.get("/cart", (req, res) =>
  run(req, res, (scope) => CartService.getCartGroupedByStore(scope)),
);
cartRouter.post("/cart/items", originProtection, (req, res) =>
  run(req, res, (scope) =>
    CartService.addItem(scope, AddCartItemSchema.parse(req.body), context(req)),
  ),
);
cartRouter.post("/cart/mix", originProtection, (req, res) =>
  run(req, res, (scope) =>
    CartService.addHortiMix(
      scope,
      AddHortiMixSchema.parse(req.body),
      context(req),
    ),
  ),
);
cartRouter.patch("/cart/items/:id", originProtection, (req, res) =>
  run(req, res, (scope) =>
    CartService.updateItem(
      scope,
      z.uuid().parse(req.params.id),
      UpdateCartItemSchema.parse(req.body),
      context(req),
    ),
  ),
);
cartRouter.post("/cart/items/:id/remove", originProtection, (req, res) =>
  run(req, res, (scope) =>
    CartService.removeItem(
      scope,
      z.uuid().parse(req.params.id),
      RemoveCartItemSchema.parse(req.body),
      context(req),
    ),
  ),
);
