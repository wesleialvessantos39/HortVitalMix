import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { SaveDeliverySettingsSchema } from "../../shared/contracts/delivery.ts";
import { originProtection } from "../security/originProtection.ts";
import { verifyRecentAuthProof } from "../security/recentAuth.ts";
import {
  DeliveryQuoteService,
  DeliveryError,
} from "../services/DeliveryQuoteService.ts";

export const deliveryRouter = Router();
function cookie(req: Request, name: string) {
  const raw = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="));
  try {
    return raw ? decodeURIComponent(raw.slice(name.length + 1)) : "";
  } catch {
    return "";
  }
}
function producer(req: Request, res: Response, recent = false) {
  const actor = req.actor;
  const fail = (status: number, error: string) => {
    res.status(status).json({ error, requestId: req.requestId });
    return null;
  };
  if (!actor) return fail(401, "AUTH_REQUIRED");
  const portal = cookie(req, "hvm_portal_role");
  if (
    !actor.roles.includes("producer") ||
    !actor.personId ||
    (portal && portal !== "producer")
  )
    return fail(403, "PRODUCER_PROFILE_REQUIRED");
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7).trim()
    : cookie(req, "hvm_access");
  if (
    recent &&
    (!token ||
      !verifyRecentAuthProof(cookie(req, "hvm_reauth"), actor.userId, token))
  )
    return fail(401, "RECENT_AUTH_REQUIRED");
  return { ...actor, personId: actor.personId };
}
function emptyQuery(req: Request) {
  const params = new URL(req.url, "http://localhost").searchParams;
  params.delete("path");
  params.delete("__hvm_path");
  return params.size === 0;
}
function fail(req: Request, res: Response, error: unknown) {
  res
    .status(
      error instanceof DeliveryError
        ? error.status
        : error instanceof z.ZodError
          ? 422
          : 503,
    )
    .json({
      error:
        error instanceof DeliveryError
          ? error.code
          : error instanceof z.ZodError
            ? "DELIVERY_VALIDATION_FAILED"
            : "DEPENDENCY_UNAVAILABLE",
      requestId: req.requestId,
    });
}
deliveryRouter.get("/producer/store/delivery", async (req, res) => {
  const actor = producer(req, res);
  if (!actor) return;
  if (!emptyQuery(req)) {
    res
      .status(400)
      .json({ error: "VALIDATION_ERROR", requestId: req.requestId });
    return;
  }
  try {
    res.json(
      await DeliveryQuoteService.getOwnerSettings(actor.personId, actor.userId),
    );
  } catch (e) {
    fail(req, res, e);
  }
});
deliveryRouter.put(
  "/producer/store/delivery",
  originProtection,
  async (req, res) => {
    const actor = producer(req, res, true);
    if (!actor) return;
    const input = SaveDeliverySettingsSchema.safeParse(req.body);
    if (!input.success || !emptyQuery(req)) {
      res
        .status(400)
        .json({ error: "VALIDATION_ERROR", requestId: req.requestId });
      return;
    }
    try {
      res.json(
        await DeliveryQuoteService.saveOwnerSettings(
          actor.personId,
          actor.userId,
          input.data,
          { requestId: req.requestId, ipHash: req.clientIpHash },
        ),
      );
    } catch (e) {
      fail(req, res, e);
    }
  },
);
// Quotes stay internal until their authoritative checkout caller is implemented.
