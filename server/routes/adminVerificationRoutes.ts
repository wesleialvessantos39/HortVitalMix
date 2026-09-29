import { Router, type Request } from "express";
import { z } from "zod";
import {
  adminSessionMiddleware,
  requireRecentAuth,
} from "../middleware/adminSession.ts";
import { originProtection } from "../security/originProtection.ts";
import {
  ClaimVerificationRequestSchema,
  DecideVerificationRequestSchema,
  VerificationFilterSchema,
} from "../../shared/contracts/verificationQueue.ts";
import {
  VerificationQueueService,
  VerificationQueueError,
} from "../services/VerificationQueueService.ts";

export const adminVerificationRouter = Router();
adminVerificationRouter.use(adminSessionMiddleware);
adminVerificationRouter.use((req, res, next) => {
  if (
    !req.adminActor?.isSuperAdmin &&
    !req.adminActor?.sectors.includes("document_verification")
  ) {
    res.status(403).json({ error: "FORBIDDEN", requestId: req.requestId });
    return;
  }
  next();
});

function actor(req: Request) {
  return req.adminActor!;
}

adminVerificationRouter.get("/verification-queue", async (req, res) => {
  const filter = VerificationFilterSchema.safeParse({
    tab: req.query.tab ?? "pending",
  });
  if (!filter.success) {
    res.status(422).json({ error: "VALIDATION_ERROR", requestId: req.requestId });
    return;
  }
  try {
    res.json(await VerificationQueueService.list(actor(req), filter.data.tab));
  } catch (error) {
    const err =
      error instanceof VerificationQueueError
        ? error
        : new VerificationQueueError("UNAVAILABLE", 503);
    res.status(err.status).json({ error: err.code, requestId: req.requestId });
  }
});

adminVerificationRouter.get("/verification-queue/:id", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(422).json({ error: "VALIDATION_ERROR", requestId: req.requestId });
    return;
  }
  try {
    res.json(await VerificationQueueService.getOne(actor(req), id.data));
  } catch (error) {
    const err =
      error instanceof VerificationQueueError
        ? error
        : new VerificationQueueError("UNAVAILABLE", 503);
    res.status(err.status).json({ error: err.code, requestId: req.requestId });
  }
});

adminVerificationRouter.post(
  "/verification-queue/:id/claim",
  originProtection,
  requireRecentAuth,
  async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    const input = ClaimVerificationRequestSchema.safeParse(req.body);
    if (!id.success || !input.success) {
      res.status(422).json({ error: "VALIDATION_ERROR", requestId: req.requestId });
      return;
    }
    try {
      res.json(
        await VerificationQueueService.claimRequest(
          actor(req),
          id.data,
          input.data.commandId,
          req.requestId,
          req.clientIpHash,
        ),
      );
    } catch (error) {
      const err =
        error instanceof VerificationQueueError
          ? error
          : new VerificationQueueError("UNAVAILABLE", 503);
      res.status(err.status).json({ error: err.code, requestId: req.requestId });
    }
  },
);

adminVerificationRouter.post(
  "/verification-queue/:id/decide",
  originProtection,
  requireRecentAuth,
  async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    const input = DecideVerificationRequestSchema.safeParse(req.body);
    if (!id.success || !input.success) {
      res.status(422).json({ error: "VALIDATION_ERROR", requestId: req.requestId });
      return;
    }
    try {
      res.json(
        await VerificationQueueService.decideRequest(
          actor(req),
          id.data,
          input.data,
          req.requestId,
          req.clientIpHash,
        ),
      );
    } catch (error) {
      const err =
        error instanceof VerificationQueueError
          ? error
          : new VerificationQueueError("UNAVAILABLE", 503);
      res.status(err.status).json({ error: err.code, requestId: req.requestId });
    }
  },
);
