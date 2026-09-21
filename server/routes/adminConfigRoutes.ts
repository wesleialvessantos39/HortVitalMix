import { Router, type Request, type Response } from "express";
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

adminConfigRouter.get(
  "/configuration",
  adminSessionMiddleware,
  async (req: Request, res: Response) => {
    try {
      const config = await ConfigurationService.getAdminConfig();
      if (!config) {
        res.status(503).json({
          error: ConfigErrorCode.DB_NOT_CONFIGURED,
          requestId: req.requestId,
        });
        return;
      }
      res.status(200).json(config);
    } catch (error) {
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

adminConfigRouter.patch(
  "/configuration",
  originProtection,
  adminSessionMiddleware,
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
        req.adminActor,
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
