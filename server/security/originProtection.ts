import type { NextFunction, Request, Response } from "express";
import { runtime } from "../config/runtime.ts";
import { isAllowedRequestOrigin } from "./origin.ts";
import { ConfigErrorCode } from "../../shared/contracts/adminConfig.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function originProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite === "cross-site") {
    res.status(403).json({
      error: ConfigErrorCode.ORIGIN_REJECTED,
      message: "Requisição cross-site bloqueada.",
      requestId: req.requestId,
    });
    return;
  }

  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    if (!isAllowedRequestOrigin(req)) {
      res.status(403).json({
        error: ConfigErrorCode.ORIGIN_REJECTED,
        message: "Origem não autorizada.",
        requestId: req.requestId,
      });
      return;
    }
    next();
    return;
  }

  if (runtime.appEnv === "production") {
    const referer = req.headers.referer;
    if (typeof referer !== "string" || !isAllowedRequestOrigin(req)) {
      res.status(403).json({
        error: ConfigErrorCode.ORIGIN_REJECTED,
        message: "Origin/Referer ausente ou inválido.",
        requestId: req.requestId,
      });
      return;
    }
  } else if (!isAllowedRequestOrigin(req)) {
    res.status(403).json({
      error: ConfigErrorCode.ORIGIN_REJECTED,
      message: "Origem não autorizada.",
      requestId: req.requestId,
    });
    return;
  }

  next();
}
