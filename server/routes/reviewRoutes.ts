import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ReviewService as service } from "../services/ReviewService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { CheckoutCommandIdSchema } from "../../shared/contracts/checkout.ts";
import { originProtection } from "../security/originProtection.ts";
import {
  adminSessionMiddleware,
  requireAdminSector,
  requireRecentAuth,
} from "../middleware/adminSession.ts";
export const reviewRouter = Router(),
  adminReviewRouter = Router();
const user = (req: Request) => {
  if (!req.actor) throw new CommerceError("AUTH_REQUIRED", 401);
  return req.actor.userId;
};
const command = (req: Request) =>
  CheckoutCommandIdSchema.parse(req.headers["x-command-id"]);
const context = (req: Request) => ({
  requestId: req.requestId,
  ipHash: req.clientIpHash,
});
async function run(
  req: Request,
  res: Response,
  privateRead: boolean,
  work: () => Promise<unknown>,
) {
  res.set("Cache-Control", privateRead ? "private, no-store" : "no-store");
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
reviewRouter.get("/stores/:storeSlug/reviews", (req, res) =>
  run(req, res, false, () =>
    service.publicStoreReviews(req.params.storeSlug, req.query),
  ),
);
reviewRouter.get("/orders/:id/review", (req, res) =>
  run(req, res, true, () => service.eligibility(user(req), req.params.id)),
);
reviewRouter.post("/reviews", originProtection, (req, res) =>
  run(req, res, true, () =>
    service.createReview(user(req), req.body, command(req), context(req)),
  ),
);
// Path-scoped middleware preserves authorization/404 behavior of older admin routes.
adminReviewRouter.use(
  "/reviews",
  adminSessionMiddleware,
  requireAdminSector("complaint_management"),
);
adminReviewRouter.get("/reviews", (req, res) =>
  run(req, res, true, () => service.adminList(req.adminActor!, req.query)),
);
adminReviewRouter.post(
  "/reviews/:id/moderate",
  originProtection,
  requireRecentAuth,
  (req, res) =>
    run(req, res, true, () =>
      service.moderateReview(
        req.params.id,
        req.adminActor!,
        req.body,
        command(req),
        context(req),
      ),
    ),
);
