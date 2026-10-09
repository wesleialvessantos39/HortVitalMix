import { Router, type Request, type Response } from "express";
import {
  AppPlatformSchema,
  UpdateAppDistributionRequestSchema,
} from "../../shared/contracts/appDistribution.ts";
import {
  adminSessionMiddleware,
  requireAdminSector,
  requireRecentAuth,
} from "../middleware/adminSession.ts";
import { originProtection } from "../security/originProtection.ts";
import {
  AppDistributionError,
  AppDistributionService,
} from "../services/AppDistributionService.ts";
import { ReauthRequiredError } from "../services/reauthService.ts";
import { reportFailure } from "../config/reportFailure.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { MobileReleaseError } from "../services/MobileReleaseService.ts";

export const appDistributionRouter = Router();
export const appDownloadRouter = Router();

function failure(error: unknown, req: Request, res: Response) {
  if (error instanceof ReauthRequiredError) {
    res
      .status(401)
      .json({
        error: error.code,
        actorId: req.adminActor?.userId,
        requestId: req.requestId,
      });
    return;
  }
  if (error instanceof AppDistributionError || error instanceof CommerceError || error instanceof MobileReleaseError) {
    const known = error as AppDistributionError;
    res
      .status(known.status)
      .json({
        error: known.code,
        ...(known.currentRevision
          ? { currentRevision: known.currentRevision }
          : {}),
        requestId: req.requestId,
      });
    return;
  }
  reportFailure({
    category: "app_distribution_unavailable",
    requestId: req.requestId,
  });
  res
    .status(503)
    .json({ error: "DEPENDENCY_UNAVAILABLE", requestId: req.requestId });
}

appDistributionRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  next();
});
appDistributionRouter.get("/app-distribution", async (req, res) => {
  try {
    res.json(await AppDistributionService.getPublic());
  } catch (error) {
    failure(error, req, res);
  }
});
appDistributionRouter.get(
  "/admin/app-distribution",
  adminSessionMiddleware,
  requireAdminSector("platform_configuration"),
  async (req, res) => {
    try {
      res.json(await AppDistributionService.getAdmin(req.adminActor!));
    } catch (error) {
      failure(error, req, res);
    }
  },
);
appDistributionRouter.patch(
  "/admin/app-distribution",
  originProtection,
  adminSessionMiddleware,
  requireAdminSector("platform_configuration"),
  requireRecentAuth,
  async (req, res) => {
    const input = UpdateAppDistributionRequestSchema.safeParse(req.body);
    if (!input.success) {
      res
        .status(422)
        .json({
          error: "VALIDATION_FAILED",
          requestId: req.requestId,
          issues: input.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      return;
    }
    try {
      res.json(
        await AppDistributionService.update(input.data, req.adminActor!, {
          requestId: req.requestId,
          ipHash: req.clientIpHash,
        }),
      );
    } catch (error) {
      failure(error, req, res);
    }
  },
);

async function download(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const platform = AppPlatformSchema.safeParse(req.params.platform);
  if (!platform.success) {
    res.status(404).json({ error: "APP_PLATFORM_NOT_FOUND" });
    return;
  }
  try {
    const destination = await AppDistributionService.getDownload(platform.data);
    if (!destination) {
      res
        .status(404)
        .json({
          error: "APP_DOWNLOAD_NOT_AVAILABLE",
          applicationsPath: "/aplicativos",
        });
      return;
    }
    res.redirect(302, destination);
  } catch (error) {
    failure(error, req, res);
  }
}
appDistributionRouter.get("/app-distribution/download/:platform", download);
appDownloadRouter.get("/:platform", download);
