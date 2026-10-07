import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ReconcileBatchSchema } from "../../shared/contracts/offlineSync.ts";
import { KpiCalculationSchema } from "../../shared/contracts/kpi.ts";
import { publicUser } from "../security/publicRole.ts";
import { originProtection } from "../security/originProtection.ts";
import { verifyRecentAuthProof } from "../security/recentAuth.ts";
import {
  adminSessionMiddleware,
  requireSuperAdmin,
  requireAdminSector,
  requireRecentAuth,
} from "../middleware/adminSession.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { OfflineSyncService } from "../services/OfflineSyncService.ts";
import { KpiAggregationService } from "../services/KpiAggregationService.ts";
export const offlineRouter = Router(),
  adminBiRouter = Router();
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
const context = (req: Request) => ({
  requestId: req.requestId,
  ipHash: req.clientIpHash,
});
async function run(req: Request, res: Response, work: () => Promise<unknown>) {
  res.set("Cache-Control", "private, no-store");
  try {
    res.json(await work());
  } catch (e) {
    res
      .status(
        e instanceof CommerceError
          ? e.status
          : e instanceof z.ZodError
            ? 422
            : 503,
      )
      .json({
        error:
          e instanceof CommerceError
            ? e.code
            : e instanceof z.ZodError
              ? "VALIDATION_ERROR"
              : "DEPENDENCY_UNAVAILABLE",
        requestId: req.requestId,
      });
  }
}
offlineRouter.post("/producer/sync", originProtection, (req, res) =>
  run(req, res, async () => {
    const uid = publicUser(req, "producer"),
      batch = ReconcileBatchSchema.parse(req.body);
    if (batch.commands.some((c) => c.commandType === "inventory.harvest")) {
      const token = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : cookie(req, "hvm_access");
      if (!verifyRecentAuthProof(cookie(req, "hvm_reauth"), uid, token))
        throw new CommerceError("RECENT_AUTH_REQUIRED", 401);
    }
    return OfflineSyncService.reconcileBatch(
      batch.deviceFingerprint,
      uid,
      batch.commands,
      context(req),
    );
  }),
);
adminBiRouter.use("/bi", adminSessionMiddleware, requireSuperAdmin, requireAdminSector("platform_configuration"));
adminBiRouter.get("/bi", (req, res) =>
  run(req, res, () => {
    const input = { ...req.query };
    delete input.path;
    delete input.__hvm_path;
    return KpiAggregationService.dashboard(req.adminActor!, input);
  }),
);
adminBiRouter.post(
  "/bi/calculate",
  originProtection,
  requireRecentAuth,
  (req, res) =>
    run(req, res, () =>
      KpiAggregationService.calculateDailyKpis(
        KpiCalculationSchema.parse(req.body).referenceDate,
        req.adminActor!,
        context(req),
      ),
    ),
);
