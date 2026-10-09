import { Router, type Request, type Response } from "express";
import {
  adminSessionMiddleware,
  requireAdminSector,
} from "../middleware/adminSession.ts";
import { classifyDbError, reportFailure } from "../config/reportFailure.ts";
import {
  AdminOperationsError,
  AdminOperationsService,
} from "../services/AdminOperationsService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";

export const adminOperationsRouter = Router();
// Even denied responses are private: never cache one actor's departmental data
// or denial and deliver it after an administrative identity change.
adminOperationsRouter.use(
  ["/finance/overview", "/catalog/overview"],
  (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  },
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
        .json(await AdminOperationsService[kind](req.adminActor, req.query));
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
      res
        .status(503)
        .json({
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
