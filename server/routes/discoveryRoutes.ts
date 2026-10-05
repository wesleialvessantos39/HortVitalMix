import { Router, type Request, type Response } from "express";
import {
  FavoritesQuerySchema,
  SearchStoresQuerySchema,
  ToggleFavoriteSchema,
} from "../../shared/contracts/discovery.ts";
import {
  DiscoveryError,
  DiscoveryService,
} from "../services/DiscoveryService.ts";
import { originProtection } from "../security/originProtection.ts";

export const discoveryRouter = Router();
function queryFromUrl(req: Request) {
  const params = new URL(req.url, "http://localhost").searchParams;
  params.delete("path");
  params.delete("__hvm_path");
  const query: Record<string, unknown> = Object.create(null);
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    let value: unknown = values.length === 1 ? values[0] : values;
    if (
      typeof value === "string" &&
      ["page", "latitude", "longitude"].includes(key)
    )
      value = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? Number(value) : value;
    if (typeof value === "string" && key === "targetIds")
      value = value.split(",");
    query[key] = value;
  }
  return query;
}
function actor(req: Request, res: Response) {
  if (!req.actor) {
    res.status(401).json({ error: "AUTH_REQUIRED", requestId: req.requestId });
    return null;
  }
  if (!req.actor.personId) {
    res
      .status(403)
      .json({ error: "FAVORITE_OWNER_REQUIRED", requestId: req.requestId });
    return null;
  }
  return { ...req.actor, personId: req.actor.personId };
}
function fail(req: Request, res: Response, error: unknown) {
  res.status(error instanceof DiscoveryError ? error.status : 503).json({
    error:
      error instanceof DiscoveryError ? error.code : "DEPENDENCY_UNAVAILABLE",
    requestId: req.requestId,
  });
}
function invalid(req: Request, res: Response) {
  res.status(400).json({ error: "VALIDATION_ERROR", requestId: req.requestId });
}
discoveryRouter.get("/discovery/stores", async (req, res) => {
  const input = SearchStoresQuerySchema.safeParse(queryFromUrl(req));
  if (!input.success) return invalid(req, res);
  try {
    res.json(await DiscoveryService.searchStores(input.data));
  } catch (error) {
    fail(req, res, error);
  }
});
discoveryRouter.get("/favorites", async (req, res) => {
  const current = actor(req, res);
  if (!current) return;
  const input = FavoritesQuerySchema.safeParse(queryFromUrl(req));
  if (!input.success) return invalid(req, res);
  try {
    res.json(
      await DiscoveryService.listFavorites(
        current.personId,
        current.userId,
        input.data,
      ),
    );
  } catch (error) {
    fail(req, res, error);
  }
});
discoveryRouter.post(
  "/favorites/toggle",
  originProtection,
  async (req, res) => {
    const current = actor(req, res);
    if (!current) return;
    const input = ToggleFavoriteSchema.safeParse(req.body);
    if (!input.success || Object.keys(queryFromUrl(req)).length)
      return invalid(req, res);
    try {
      res.json(
        await DiscoveryService.toggleFavorite(
          current.personId,
          current.userId,
          input.data,
          { requestId: req.requestId, ipHash: req.clientIpHash },
        ),
      );
    } catch (error) {
      fail(req, res, error);
    }
  },
);
