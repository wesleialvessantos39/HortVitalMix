import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { hmacSha256Hex } from "../security/hash.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const fromHeader = req.headers["x-request-id"];
  req.requestId =
    typeof fromHeader === "string" && UUID_RE.test(fromHeader)
      ? fromHeader
      : randomUUID();
  res.locals.requestId = req.requestId;
  res.setHeader("x-request-id", req.requestId);
  next();
}

export function clientIpHashMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const forwarded = req.headers["x-forwarded-for"];
  const rawIp =
    (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) ??
    req.socket.remoteAddress ??
    "unknown";
  req.clientIpHash = hmacSha256Hex(rawIp);
  next();
}
