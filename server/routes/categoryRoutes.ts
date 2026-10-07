import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  adminSessionMiddleware,
  requireSuperAdmin,
  requireAdminSector,
  requireRecentAuth,
} from "../middleware/adminSession.ts";
import { originProtection } from "../security/originProtection.ts";
import { CategoryService, CategoryError } from "../services/CategoryService.ts";
import {
  CreateCategorySchema,
  UpdateCategorySchema,
  DeactivateCategorySchema,
  CategoryStateCommandSchema,
} from "../../shared/contracts/category.ts";

export const categoryRouter = Router();
function fail(res: Response, error: unknown) {
  const known = error instanceof CategoryError;
  res.status(known ? error.status : 503).json({
    error: known ? error.code : "DEPENDENCY_UNAVAILABLE",
    requestId: res.locals.requestId,
    ...(known && error.currentRevision
      ? { currentRevision: error.currentRevision }
      : {}),
    ...(known && error.impact ? { impact: error.impact } : {}),
  });
}
categoryRouter.get("/categories", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    res.json({ categories: await CategoryService.listActiveCategories() });
  } catch (error) {
    fail(res, error);
  }
});
// There is intentionally no public mutation route, including slug edits.
categoryRouter.use(
  "/admin/categories",
  adminSessionMiddleware,
  requireSuperAdmin,
  requireAdminSector("catalog_moderation"),
);
categoryRouter.get("/admin/categories", async (req, res) => {
  try {
    res.json({
      categories: await CategoryService.listAdminCategories(req.adminActor!),
    });
  } catch (error) {
    fail(res, error);
  }
});
categoryRouter.get("/admin/categories/:id/impact", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "VALIDATION_ERROR" });
    return;
  }
  try {
    res.json(
      await CategoryService.getDeactivationImpact(id.data, req.adminActor!),
    );
  } catch (error) {
    fail(res, error);
  }
});
function mutation<T>(
  method: "post" | "patch",
  path: string,
  schema: z.ZodType<T>,
  run: (id: string | null, input: T, req: Request) => Promise<unknown>,
) {
  categoryRouter[method](
    path,
    originProtection,
    requireRecentAuth,
    async (req, res) => {
      const input = schema.safeParse(req.body),
        id = req.params.id ? z.uuid().safeParse(req.params.id) : null;
      if (!input.success || (id && !id.success)) {
        res.status(400).json({ error: "VALIDATION_ERROR" });
        return;
      }
      try {
        res.json({ category: await run(id?.data ?? null, input.data, req) });
      } catch (error) {
        fail(res, error);
      }
    },
  );
}
const context = (req: Request) => ({
  requestId: req.requestId,
  ipHash: req.clientIpHash,
});
mutation("post", "/admin/categories", CreateCategorySchema, (_id, input, req) =>
  CategoryService.createCategory(input, req.adminActor!, context(req)),
);
mutation(
  "patch",
  "/admin/categories/:id",
  UpdateCategorySchema,
  (id, input, req) =>
    CategoryService.updateCategory(id!, input, req.adminActor!, context(req)),
);
mutation(
  "post",
  "/admin/categories/:id/deactivate",
  DeactivateCategorySchema,
  (id, input, req) =>
    CategoryService.deactivateCategory(
      id!,
      input,
      req.adminActor!,
      context(req),
    ),
);
mutation(
  "post",
  "/admin/categories/:id/reactivate",
  CategoryStateCommandSchema,
  (id, input, req) =>
    CategoryService.reactivateCategory(
      id!,
      input,
      req.adminActor!,
      context(req),
    ),
);
