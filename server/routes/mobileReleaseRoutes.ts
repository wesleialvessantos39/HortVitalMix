import { Router, type Request, type Response } from "express";
import {
  MobileReleaseCommandSchema,
  PrepareMobileUploadRequestSchema,
  PublishMobileCiRequestSchema,
} from "../../shared/contracts/mobileReleases.ts";
import {
  adminSessionMiddleware,
  requireAdminSector,
  requireRecentAuth,
} from "../middleware/adminSession.ts";
import { originProtection } from "../security/originProtection.ts";
import {
  verifyMobileCiToken,
  MobileCiIdentityError,
} from "../security/mobileCiIdentity.ts";
import {
  MobileReleaseService,
  MobileReleaseError,
} from "../services/MobileReleaseService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { ReauthRequiredError } from "../services/reauthService.ts";
import { reportFailure } from "../config/reportFailure.ts";
import {
  WebReleaseSyncService,
  WebReleaseSyncError,
  WebReleaseSyncRequestSchema,
  WEB_RELEASE_CI_ORIGIN,
} from "../services/WebReleaseSyncService.ts";
import { runtime } from "../config/runtime.ts";
import manifest from "../../supabase/manifest.json" with { type: "json" };
import { FOUNDATION_SCHEMA_VERSION } from "../../shared/contracts/foundation.ts";

export const mobileReleaseRouter = Router();
/** Mount CI before public session middleware: GitHub tokens are not Supabase tokens. */
export const mobileCiRouter = Router();
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
  if (
    error instanceof MobileReleaseError ||
    error instanceof WebReleaseSyncError ||
    error instanceof CommerceError ||
    error instanceof MobileCiIdentityError
  ) {
    res
      .status(error.status)
      .json({
        error: error.code,
        ...(error instanceof MobileReleaseError && error.currentRevision
          ? { currentRevision: error.currentRevision }
          : {}),
        requestId: req.requestId,
      });
    return;
  }
  reportFailure({
    category: "mobile_release_unavailable",
    requestId: req.requestId,
  });
  res
    .status(503)
    .json({ error: "MOBILE_RELEASES_UNAVAILABLE", requestId: req.requestId });
}
for (const router of [mobileReleaseRouter, mobileCiRouter])
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    next();
  });
mobileReleaseRouter.get("/mobile-releases", async (req, res) => {
  try {
    res.json(await MobileReleaseService.getPublic());
  } catch (error) {
    failure(error, req, res);
  }
});
mobileReleaseRouter.get(
  "/admin/mobile-releases",
  adminSessionMiddleware,
  requireAdminSector("platform_configuration"),
  async (req, res) => {
    try {
      res.json(await MobileReleaseService.getAdmin(req.adminActor!));
    } catch (error) {
      failure(error, req, res);
    }
  },
);
mobileReleaseRouter.post(
  "/admin/mobile-releases/commands",
  originProtection,
  adminSessionMiddleware,
  requireAdminSector("platform_configuration"),
  requireRecentAuth,
  async (req, res) => {
    const input = MobileReleaseCommandSchema.safeParse(req.body);
    if (!input.success) {
      res
        .status(422)
        .json({ error: "VALIDATION_FAILED", requestId: req.requestId });
      return;
    }
    try {
      res.json(
        await MobileReleaseService.command(input.data, req.adminActor!, {
          requestId: req.requestId,
          ipHash: req.clientIpHash,
        }),
      );
    } catch (error) {
      failure(error, req, res);
    }
  },
);
mobileCiRouter.post("/mobile-ci/uploads", async (req, res) => {
  try {
    const identity = await verifyMobileCiToken(
      req.headers.authorization?.match(/^Bearer ([^ ]+)$/)?.[1] ?? "",
    );
    const input = PrepareMobileUploadRequestSchema.safeParse(req.body);
    if (!input.success) {
      res
        .status(422)
        .json({ error: "VALIDATION_FAILED", requestId: req.requestId });
      return;
    }
    res.json(await MobileReleaseService.prepareUpload(input.data, identity));
  } catch (error) {
    failure(error, req, res);
  }
});
mobileCiRouter.post("/mobile-ci/releases", async (req, res) => {
  try {
    const identity = await verifyMobileCiToken(
      req.headers.authorization?.match(/^Bearer ([^ ]+)$/)?.[1] ?? "",
    );
    const input = PublishMobileCiRequestSchema.safeParse(req.body);
    if (!input.success) {
      res
        .status(422)
        .json({ error: "VALIDATION_FAILED", requestId: req.requestId });
      return;
    }
    res.json(await MobileReleaseService.acceptCi(input.data, identity));
  } catch (error) {
    failure(error, req, res);
  }
});
mobileCiRouter.get("/mobile-ci/web-release/status", (_req, res) => {
  res.json({ appEnv: runtime.appEnv, sourceCommit: runtime.commitSha,
    schemaVersion: FOUNDATION_SCHEMA_VERSION, migrationHistoryHash: manifest.migrationHistoryHash });
});
mobileCiRouter.post("/mobile-ci/web-release", async (req, res) => {
  try {
    if (req.headers.host !== new URL(WEB_RELEASE_CI_ORIGIN).host || req.headers.origin !== WEB_RELEASE_CI_ORIGIN) {
      res.status(403).json({ error: "ORIGIN_NOT_ALLOWED", requestId: req.requestId });
      return;
    }
    const identity = await verifyMobileCiToken(
      req.headers.authorization?.match(/^Bearer ([^ ]+)$/)?.[1] ?? "",
    );
    const input = WebReleaseSyncRequestSchema.safeParse(req.body);
    if (!input.success) {
      res.status(422).json({ error: "VALIDATION_FAILED", requestId: req.requestId });
      return;
    }
    res.json(await WebReleaseSyncService.sync(input.data, identity));
  } catch (error) { failure(error, req, res); }
});
