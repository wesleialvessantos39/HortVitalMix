import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  CreateProductSchema,
  UpdateProductSchema,
  UpdateProductPriceSchema,
  ToggleProductPublishSchema,
  ProductMediaCommandSchema,
  ProductUploadQuerySchema,
  ProductQuerySchema,
  PRODUCT_MEDIA_MAX_BYTES,
} from "../../shared/contracts/product.ts";
import { originProtection } from "../security/originProtection.ts";
import { verifyRecentAuthProof } from "../security/recentAuth.ts";
import {
  ProductError,
  ProductService,
  type ProductAuditContext,
} from "../services/ProductService.ts";

export const productRouter = Router();
function queryFromUrl(req: Request) {
  // Vercel can retain its own parsed query (including routing metadata) after
  // the existing dispatcher normalizes req.url. Validate only that URL, and
  // preserve duplicate values so the strict contracts still reject them.
  const params = new URL(req.url, "http://localhost").searchParams;
  // The catch-all function can also append its route parameters to the URL.
  // These keys are consumed by the transport and never select business data.
  params.delete("path");
  params.delete("__hvm_path");
  const query: Record<string, string | string[]> = Object.create(null);
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    query[key] = values.length === 1 ? values[0] : values;
  }
  return query;
}
function cookie(req: Request, name: string) {
  const part = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="));
  try {
    return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
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
function fail(res: Response, error: unknown) {
  const known = error instanceof ProductError;
  res
    .status(known ? error.status : error instanceof z.ZodError ? 422 : 503)
    .json({
      error: known
        ? error.code
        : error instanceof z.ZodError
          ? "PRODUCT_VALIDATION_FAILED"
          : "DEPENDENCY_UNAVAILABLE",
      ...(known && error.currentRevision
        ? { currentRevision: error.currentRevision }
        : {}),
      requestId: res.locals.requestId,
    });
}
const context = (req: Request): ProductAuditContext => ({
  requestId: req.requestId,
  ipHash: req.clientIpHash,
});
productRouter.get("/producer/products", async (req, res) => {
  const actor = producer(req, res);
  if (!actor) return;
  try {
    res.json(
      await ProductService.listOwnerProducts(actor.personId, actor.userId),
    );
  } catch (error) {
    fail(res, error);
  }
});
productRouter.get("/producer/products/:id", async (req, res) => {
  const actor = producer(req, res);
  if (!actor) return;
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "VALIDATION_ERROR" });
    return;
  }
  try {
    res.json({
      product: await ProductService.getOwnerProduct(
        id.data,
        actor.personId,
        actor.userId,
      ),
    });
  } catch (error) {
    fail(res, error);
  }
});
productRouter.post("/producer/products", originProtection, async (req, res) => {
  const actor = producer(req, res, true);
  if (!actor) return;
  const input = CreateProductSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "VALIDATION_ERROR" });
    return;
  }
  try {
    res.json({
      product: await ProductService.createProduct(
        actor.personId,
        input.data,
        actor.userId,
        context(req),
      ),
    });
  } catch (error) {
    fail(res, error);
  }
});
function mutation<T>(
  method: "patch" | "post",
  suffix: string,
  schema: z.ZodType<T>,
  recent: boolean | ((req: Request) => boolean),
  run: (
    id: string,
    personId: string,
    value: T,
    userId: string,
    context: ProductAuditContext,
  ) => Promise<unknown>,
) {
  productRouter[method](
    "/producer/products/:id" + suffix,
    originProtection,
    async (req, res) => {
      const actor = producer(
        req,
        res,
        typeof recent === "function" ? recent(req) : recent,
      );
      if (!actor) return;
      const id = z.uuid().safeParse(req.params.id),
        input = schema.safeParse(req.body);
      if (!id.success || !input.success) {
        res.status(400).json({ error: "VALIDATION_ERROR" });
        return;
      }
      try {
        res.json({
          product: await run(
            id.data,
            actor.personId,
            input.data,
            actor.userId,
            context(req),
          ),
        });
      } catch (error) {
        fail(res, error);
      }
    },
  );
}
mutation("patch", "", UpdateProductSchema, true, (...args) =>
  ProductService.updateProduct(...args),
);
mutation("post", "/price", UpdateProductPriceSchema, true, (...args) =>
  ProductService.updatePrice(...args),
);
// Emergency unpublication remains immediate, including after a shop is paused.
mutation(
  "post",
  "/publish",
  ToggleProductPublishSchema,
  (req) => req.body?.isPublished === true,
  (...args) => ProductService.togglePublish(...args),
);
mutation("post", "/media/primary", ProductMediaCommandSchema, true, (...args) =>
  ProductService.setPrimaryMedia(...args),
);
mutation("post", "/media/remove", ProductMediaCommandSchema, false, (...args) =>
  ProductService.removeMedia(...args),
);
productRouter.post(
  "/producer/products/:id/media/upload",
  originProtection,
  (req, res, next) => {
    if (!producer(req, res, true)) return;
    next();
  },
  express.raw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: PRODUCT_MEDIA_MAX_BYTES,
  }),
  async (req, res) => {
    const actor = producer(req, res, true);
    if (!actor) return;
    const id = z.uuid().safeParse(req.params.id),
      input = ProductUploadQuerySchema.safeParse(queryFromUrl(req));
    if (!id.success || !input.success || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "VALIDATION_ERROR" });
      return;
    }
    try {
      res.json({
        product: await ProductService.uploadMedia(
          id.data,
          actor.personId,
          input.data,
          actor.userId,
          req.body,
          req.get("content-type")!.split(";")[0],
          context(req),
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
productRouter.get("/products", async (req, res) => {
  const query = ProductQuerySchema.safeParse(queryFromUrl(req));
  if (!query.success) {
    res.status(400).json({ error: "VALIDATION_ERROR" });
    return;
  }
  try {
    res.json({ products: await ProductService.listPublicProducts(query.data) });
  } catch (error) {
    fail(res, error);
  }
});
