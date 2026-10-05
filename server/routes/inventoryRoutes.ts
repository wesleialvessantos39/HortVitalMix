import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  InventoryQuerySchema,
  RegisterHarvestCommandSchema,
} from "../../shared/contracts/inventory.ts";
import { originProtection } from "../security/originProtection.ts";
import { verifyRecentAuthProof } from "../security/recentAuth.ts";
import {
  InventoryService,
  InventoryError,
} from "../services/InventoryService.ts";
export const inventoryRouter = Router();
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
  if (!actor) {
    res.status(401).json({ error: "AUTH_REQUIRED", requestId: req.requestId });
    return null;
  }
  const portal = cookie(req, "hvm_portal_role");
  if (
    !actor.roles.includes("producer") ||
    !actor.personId ||
    (portal && portal !== "producer")
  ) {
    res
      .status(403)
      .json({ error: "PRODUCER_PROFILE_REQUIRED", requestId: req.requestId });
    return null;
  }
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7).trim()
    : cookie(req, "hvm_access");
  if (
    recent &&
    (!token ||
      !verifyRecentAuthProof(cookie(req, "hvm_reauth"), actor.userId, token))
  ) {
    res
      .status(401)
      .json({ error: "RECENT_AUTH_REQUIRED", requestId: req.requestId });
    return null;
  }
  return { ...actor, personId: actor.personId };
}
function query(req: Request) {
  const params = new URL(req.url, "http://localhost").searchParams;
  params.delete("path");
  params.delete("__hvm_path");
  const values: Record<string, string | string[]> = Object.create(null);
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    values[key] = all.length === 1 ? all[0] : all;
  }
  return values;
}
function fail(req: Request, res: Response, error: unknown) {
  res
    .status(
      error instanceof InventoryError
        ? error.status
        : error instanceof z.ZodError
          ? 422
          : 503,
    )
    .json({
      error:
        error instanceof InventoryError
          ? error.code
          : error instanceof z.ZodError
            ? "INVENTORY_VALIDATION_FAILED"
            : "DEPENDENCY_UNAVAILABLE",
      requestId: req.requestId,
    });
}
inventoryRouter.get("/producer/products/:id/lots", async (req, res) => {
  const actor = producer(req, res);
  if (!actor) return;
  const id = z.uuid().safeParse(req.params.id),
    parsed = InventoryQuerySchema.safeParse(query(req));
  if (!id.success || !parsed.success) {
    res
      .status(400)
      .json({ error: "VALIDATION_ERROR", requestId: req.requestId });
    return;
  }
  try {
    res.json(
      await InventoryService.getOwnerInventory(
        id.data,
        actor.personId,
        actor.userId,
        parsed.data,
      ),
    );
  } catch (error) {
    fail(req, res, error);
  }
});
inventoryRouter.post(
  "/producer/products/:id/lots",
  originProtection,
  async (req, res) => {
    const actor = producer(req, res, true);
    if (!actor) return;
    const id = z.uuid().safeParse(req.params.id),
      input = RegisterHarvestCommandSchema.safeParse(req.body);
    if (!id.success || !input.success) {
      res
        .status(400)
        .json({ error: "VALIDATION_ERROR", requestId: req.requestId });
      return;
    }
    try {
      res.json(
        await InventoryService.registerHarvest(
          id.data,
          actor.personId,
          input.data,
          actor.userId,
          { requestId: req.requestId, ipHash: req.clientIpHash },
        ),
      );
    } catch (error) {
      fail(req, res, error);
    }
  },
);
// Reservations and consumption are internal services; T15 exposes no cart/checkout API.
