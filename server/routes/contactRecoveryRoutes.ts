import { Router, type Request, type Response } from "express";
import { ContactVerificationService } from "../services/ContactVerificationService.ts";
import { PasswordRecoveryService } from "../services/PasswordRecoveryService.ts";
import {
  RequestChallengeSchema,
  ConfirmOtpSchema,
  ConfirmTokenSchema,
  RoleScopedPasswordRecoveryRequestSchema,
  RoleScopedPasswordResetSchema,
} from "../../shared/contracts/contactRecovery.ts";

export const contactRecoveryRouter = Router();

function requireActor(req: Request, res: Response) {
  if (req.actor) return req.actor;
  res.status(401).json({ error: "SESSION_REQUIRED", requestId: req.requestId });
  return null;
}

contactRecoveryRouter.get("/contact/status", async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  try {
    res.status(200).json(await ContactVerificationService.getStatus(actor.userId));
  } catch {
    res.status(503).json({ error: "UNAVAILABLE", requestId: req.requestId });
  }
});

contactRecoveryRouter.post("/contact/challenge", async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  const parsed = RequestChallengeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: "VALIDATION_FAILED",
      issues: parsed.error.issues.map((issue) => issue.path.join(".")),
      requestId: req.requestId,
    });
    return;
  }
  const result = await ContactVerificationService.requestChallenge({
    userId: actor.userId,
    channel: parsed.data.channel,
    commandId: parsed.data.commandId,
    requestId: req.requestId,
    clientIpHash: req.clientIpHash,
  });
  if (result.status === "cooldown") {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    res.status(429).json(result);
    return;
  }
  res
    .status(result.status === "unavailable" || result.status === "channel_unavailable" ? 503 : 200)
    .json(result);
});

contactRecoveryRouter.post("/contact/confirm-otp", async (req, res) => {
  const actor = requireActor(req, res);
  if (!actor) return;
  const parsed = ConfirmOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "VALIDATION_FAILED", requestId: req.requestId });
    return;
  }
  const result = await ContactVerificationService.confirmOtp({
    userId: actor.userId,
    channel: parsed.data.channel,
    otp: parsed.data.otp,
    commandId: parsed.data.commandId,
    requestId: req.requestId,
    clientIpHash: req.clientIpHash,
  });
  const status =
    result.status === "confirmed" ? 200 :
    result.status === "invalid_code" ? 422 :
    result.status === "expired" ? 410 :
    result.status === "unavailable" ? 503 : 409;
  res.status(status).json(result);
});

contactRecoveryRouter.post("/contact/confirm-token", async (req, res) => {
  const parsed = ConfirmTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "VALIDATION_FAILED", requestId: req.requestId });
    return;
  }
  const result = await ContactVerificationService.confirmToken({
    token: parsed.data.token,
    requestId: req.requestId,
    clientIpHash: req.clientIpHash,
  });
  const status =
    result.status === "confirmed" ? 200 :
    result.status === "expired" ? 410 :
    result.status === "unavailable" ? 503 :
    result.status === "invalid_code" ? 422 : 409;
  res.status(status).json(result);
});

contactRecoveryRouter.post("/password/recovery", async (req, res) => {
  const parsed = RoleScopedPasswordRecoveryRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "VALIDATION_FAILED", requestId: req.requestId });
    return;
  }
  const result = await PasswordRecoveryService.requestRecovery(
    parsed.data,
    req.requestId,
    req.clientIpHash,
  );
  if (result.status === "rate_limited") {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    res.status(429).json(result);
    return;
  }
  res.status(result.status === "unavailable" ? 503 : 200).json(result);
});

contactRecoveryRouter.post("/password/reset", async (req, res) => {
  const parsed = RoleScopedPasswordResetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: "VALIDATION_FAILED",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
      requestId: req.requestId,
    });
    return;
  }
  const result = await PasswordRecoveryService.resetPassword(
    parsed.data,
    req.requestId,
    req.clientIpHash,
  );
  const status =
    result.status === "success" ? 200 :
    result.status === "password_reused" ? 422 :
    result.status === "unavailable" ? 503 : 410;
  res.status(status).json(result);
});
