import { hasAdminPermission } from "../../shared/adminPermissions.ts";
import { Router, type NextFunction, type Request, type Response } from "express";
import { adminSessionMiddleware } from "../middleware/adminSession.ts";
import { originProtection } from "../security/originProtection.ts";
import { ConfigurationService } from "../services/ConfigurationService.ts";
import {
  ConfigErrorCode,
  UpdateGlobalConfigSchema,
} from "../../shared/contracts/adminConfig.ts";
import { ReauthRequiredError } from "../services/reauthService.ts";
import { classifyDbError, reportFailure } from "../config/reportFailure.ts";

export const adminConfigRouter = Router();

function requirePlatformConfiguration(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (
    hasAdminPermission(req.adminActor, "platform_configuration")
  ) {
    next();
    return;
  }
  res.status(403).json({
    error: ConfigErrorCode.FORBIDDEN,
    message: "Acesso restrito à configuração global.",
    requestId: req.requestId,
  });
}

adminConfigRouter.get(
  "/configuration",
  adminSessionMiddleware,
  requirePlatformConfiguration,
  async (req: Request, res: Response) => {
    try {
      const config = await ConfigurationService.getAdminConfig();
      if (!config) {
        res.status(204).end();
        return;
      }
      res.status(200).json(config);
    } catch (error) {
      if ((error as { code?: string }).code === "DB_NOT_CONFIGURED") {
        res.status(503).json({
          error: ConfigErrorCode.DB_NOT_CONFIGURED,
          requestId: req.requestId,
        });
        return;
      }
      reportFailure({
        category: classifyDbError(error),
        requestId: req.requestId,
        route: req.path,
        method: req.method,
      });
      res.status(503).json({
        error: ConfigErrorCode.INTERNAL,
        requestId: req.requestId,
      });
    }
  },
);

adminConfigRouter.get(
  "/configuration/overview",
  adminSessionMiddleware,
  requirePlatformConfiguration,
  (_req: Request, res: Response) => {
    // The old global aggregate mixed departments under one configuration
    // permission. Only the new dashboard evaluates each sector separately.
    res.setHeader("Cache-Control", "private, no-store");
    res.status(410).json({
      error: "DASHBOARD_OVERVIEW_MOVED",
      dashboardPath: "/v1/admin/dashboard",
    });
  },
);

adminConfigRouter.patch(
  "/configuration",
  originProtection,
  adminSessionMiddleware,
  requirePlatformConfiguration,
  async (req: Request, res: Response) => {
    const parsed = UpdateGlobalConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: ConfigErrorCode.VALIDATION_FAILED,
        message: "Payload inválido.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
        requestId: req.requestId,
      });
      return;
    }

    if (!req.adminActor) {
      res.status(401).json({
        error: ConfigErrorCode.UNAUTHORIZED,
        requestId: req.requestId,
      });
      return;
    }

    try {
      const result = await ConfigurationService.updateConfig(
        parsed.data,
        {
          userId: req.adminActor.userId,
          role: req.adminActor.role,
          sessionIssuedAt: req.adminActor.sessionIssuedAt,
        },
        req.requestId,
        req.clientIpHash,
      );

      if (result.status === "success" || result.status === "idempotent_replay") {
        res.status(200).json(result);
        return;
      }
      if (result.status === "idempotent_mismatch") {
        res.status(409).json({
          error: ConfigErrorCode.COMMAND_ID_MISMATCH,
          message: result.message,
          requestId: req.requestId,
        });
        return;
      }
      if (result.status === "no_change") {
        res.status(200).json(result);
        return;
      }

      res.status(409).json({
        error: ConfigErrorCode.CONFLICT,
        currentRevision: result.currentRevision,
        message:
          "Os dados foram alterados por outro operador. Recarregue a versão atual antes de reenviar.",
        requestId: req.requestId,
      });
    } catch (error) {
      if (error instanceof ReauthRequiredError) {
        res.status(401).json({
          error: ConfigErrorCode.REAUTH_REQUIRED,
          message: "Reautenticação recente requerida. Faça login novamente.",
          requestId: req.requestId,
        });
        return;
      }
      if ((error as { code?: string }).code === "DB_NOT_CONFIGURED") {
        res.status(503).json({
          error: ConfigErrorCode.DB_NOT_CONFIGURED,
          requestId: req.requestId,
        });
        return;
      }

      reportFailure({
        category: classifyDbError(error),
        requestId: req.requestId,
        route: req.path,
        method: req.method,
      });
      res.status(500).json({
        error: ConfigErrorCode.INTERNAL,
        requestId: req.requestId,
      });
    }
  },
);
