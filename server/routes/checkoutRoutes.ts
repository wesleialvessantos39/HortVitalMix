import { publicRole } from "../security/publicRole.ts";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { CheckoutService, CheckoutError } from "../services/CheckoutService.ts";
import { CartError } from "../services/CartService.ts";
import { cartSession } from "../security/cartSession.ts";
import { originProtection } from "../security/originProtection.ts";
import {
  CheckoutCommandIdSchema,
  ConfirmCheckoutSchema,
  CreateQuoteSchema,
} from "../../shared/contracts/checkout.ts";

export const checkoutRouter = Router();
async function run(
  req: Request,
  res: Response,
  operation: (userId: string) => Promise<{ statusCode: number; body: unknown }>,
) {
  if (!req.actor) {
    res.status(401).json({ error: "AUTH_REQUIRED", requestId: req.requestId });
    return;
  }
  if (!req.actor.roles.includes("consumer")) {
    res
      .status(403)
      .json({ error: "CHECKOUT_OWNER_REQUIRED", requestId: req.requestId });
    return;
  }
  try { if (publicRole(req) !== "consumer") throw new Error(); }
  catch { res.status(403).json({ error: "CONSUMER_REQUIRED", requestId: req.requestId }); return; }
  const query = new URL(req.url, "http://localhost").searchParams;
  query.delete("path");
  query.delete("__hvm_path");
  if (query.size) {
    res
      .status(400)
      .json({ error: "VALIDATION_ERROR", requestId: req.requestId });
    return;
  }
  try {
    const r = await operation(req.actor.userId);
    res.status(r.statusCode).json(r.body);
  } catch (e) {
    res
      .status(
        e instanceof CheckoutError || e instanceof CartError
          ? e.status
          : e instanceof z.ZodError
            ? 400
            : 503,
      )
      .json({
        error:
          e instanceof CheckoutError || e instanceof CartError
            ? e.code
            : e instanceof z.ZodError
              ? "VALIDATION_ERROR"
              : "DEPENDENCY_UNAVAILABLE",
        requestId: req.requestId,
      });
  }
}
const audit = (req: Request) => ({
  requestId: req.requestId,
  ipHash: req.clientIpHash,
});
checkoutRouter.get("/checkout/context", (req, res) =>
  run(req, res, async (userId) => {
    let sessionId = cartSession(req, res);
    try {
      return {
        statusCode: 200,
        body: await CheckoutService.getContext(userId, sessionId),
      };
    } catch (e) {
      if (!(e instanceof CartError) || e.code !== "CART_SESSION_OWNED") throw e;
      sessionId = cartSession(req, res, true);
      return {
        statusCode: 200,
        body: await CheckoutService.getContext(userId, sessionId),
      };
    }
  }),
);
checkoutRouter.post("/checkout/quotes", originProtection, (req, res) =>
  run(req, res, async (userId) => {
    const p = CreateQuoteSchema.parse(req.body);
    return {
      statusCode: 201,
      body: await CheckoutService.createQuote(
        userId,
        p.cartId,
        p.deliveryAddressId,
        audit(req),
      ),
    };
  }),
);
checkoutRouter.get("/checkout/quotes/:id", (req, res) =>
  run(req, res, async (userId) => ({
    statusCode: 200,
    body: await CheckoutService.getQuote(userId, z.uuid().parse(req.params.id)),
  })),
);
checkoutRouter.get("/checkout/confirmations/:id", (req, res) =>
  run(req, res, async (userId) => ({
    statusCode: 200,
    body: await CheckoutService.getConfirmation(
      userId,
      CheckoutCommandIdSchema.parse(req.params.id),
    ),
  })),
);
checkoutRouter.post("/checkout/confirm", originProtection, (req, res) =>
  run(req, res, async (userId) => {
    const id = CheckoutCommandIdSchema.parse(req.headers["x-command-id"]);
    return CheckoutService.confirmCheckout(
      id,
      ConfirmCheckoutSchema.parse(req.body),
      userId,
      audit(req),
    );
  }),
);
