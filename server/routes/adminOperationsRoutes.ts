import { Router, type Request, type Response } from "express";
import {
  adminSessionMiddleware,
  requireAdminSector,
  requireRecentAuth,
} from "../middleware/adminSession.ts";
import { classifyDbError, reportFailure } from "../config/reportFailure.ts";
import {
  AdminOperationsError,
  AdminOperationsService,
} from "../services/AdminOperationsService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { businessQuery } from "../security/businessQuery.ts";
import { z } from "zod";
import { DepartmentOperationsService } from "../services/DepartmentOperationsService.ts";
import { originProtection } from "../security/originProtection.ts";
import { CheckoutCommandIdSchema } from "../../shared/contracts/checkout.ts";

export const adminOperationsRouter = Router();
// Even denied responses are private: never cache one actor's departmental data
// or denial and deliver it after an administrative identity change.
adminOperationsRouter.use(["/finance", "/catalog"], (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
async function operation(
  req: Request,
  res: Response,
  work: () => Promise<unknown>,
) {
  try {
    res.json(await work());
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
              : "DEPARTMENT_UNAVAILABLE",
        requestId: req.requestId,
      });
  }
}
const auditContext = (req: Request) => ({
  requestId: req.requestId,
  ipHash: req.clientIpHash,
});
adminOperationsRouter.get(
  "/finance/registers",
  adminSessionMiddleware,
  requireAdminSector("finance_ops"),
  (req, res) =>
    operation(req, res, () =>
      DepartmentOperationsService.financeRegisters(
        req.adminActor!,
        businessQuery(req),
      ),
    ),
);
adminOperationsRouter.post(
  "/finance/cases",
  originProtection,
  adminSessionMiddleware,
  requireAdminSector("finance_ops"),
  requireRecentAuth,
  (req, res) =>
    operation(req, res, () =>
      DepartmentOperationsService.financeCase(
        req.adminActor!,
        req.body,
        CheckoutCommandIdSchema.parse(req.headers["x-command-id"]),
        auditContext(req),
      ),
    ),
);
adminOperationsRouter.post(
  "/catalog/moderation",
  originProtection,
  adminSessionMiddleware,
  requireAdminSector("catalog_moderation"),
  requireRecentAuth,
  (req, res) =>
    operation(req, res, () =>
      DepartmentOperationsService.moderateCatalog(
        req.adminActor!,
        req.body,
        CheckoutCommandIdSchema.parse(req.headers["x-command-id"]),
        auditContext(req),
      ),
    ),
);
adminOperationsRouter.get(
  "/catalog/history/:id",
  adminSessionMiddleware,
  requireAdminSector("catalog_moderation"),
  (req, res) =>
    operation(req, res, () =>
      DepartmentOperationsService.catalogHistory(
        req.adminActor!,
        z.uuid().parse(req.params.id),
        z.enum(["product", "store"]).parse(req.query.type),
      ),
    ),
);
function handle(kind: "finance" | "catalog") {
  return async (req: Request, res: Response) => {
    if (!req.adminActor) {
      res.status(401).json({ error: "UNAUTHORIZED", requestId: req.requestId });
      return;
    }
    try {
      res
        .status(200)
        .json(
          await AdminOperationsService[kind](
            req.adminActor,
            businessQuery(req),
          ),
        );
    } catch (error) {
      if (
        error instanceof AdminOperationsError ||
        error instanceof CommerceError
      ) {
        res
          .status(error.status)
          .json({ error: error.code, requestId: req.requestId });
        return;
      }
      reportFailure({
        category: classifyDbError(error),
        requestId: req.requestId,
        route: req.path,
        method: req.method,
      });
      res.status(503).json({
        error: "DEPARTMENT_UNAVAILABLE",
        message: "Não foi possível consultar este departamento.",
        requestId: req.requestId,
      });
    }
  };
}
adminOperationsRouter.get(
  "/finance/overview",
  adminSessionMiddleware,
  requireAdminSector("finance_ops"),
  handle("finance"),
);
adminOperationsRouter.get(
  "/catalog/overview",
  adminSessionMiddleware,
  requireAdminSector("catalog_moderation"),
  handle("catalog"),
);
