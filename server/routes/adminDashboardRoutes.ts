import { Router, type Request, type Response } from "express";
import { adminSessionMiddleware } from "../middleware/adminSession.ts";
import { AdminDashboardService } from "../services/AdminDashboardService.ts";
import { classifyDbError, reportFailure } from "../config/reportFailure.ts";

export const adminDashboardRouter = Router();

adminDashboardRouter.get("/dashboard", adminSessionMiddleware, async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!req.adminActor) {
    res.status(401).json({ error: "UNAUTHORIZED", requestId: req.requestId });
    return;
  }
  try {
    res.status(200).json(await AdminDashboardService.overview(req.adminActor));
  } catch (error) {
    reportFailure({ category: classifyDbError(error), requestId: req.requestId, route: req.path, method: req.method });
    res.status(503).json({ error: "DASHBOARD_UNAVAILABLE", message: "Não foi possível atualizar os indicadores.", requestId: req.requestId });
  }
});
