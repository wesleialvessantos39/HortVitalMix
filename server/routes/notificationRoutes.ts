import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  NotificationService,
  type NotificationActor,
} from "../services/NotificationService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { publicRole, publicUser } from "../security/publicRole.ts";
import { adminSessionMiddleware } from "../middleware/adminSession.ts";
import { originProtection } from "../security/originProtection.ts";
export const notificationRouter = Router(),
  adminNotificationRouter = Router();
export function notificationQuery(req: Request) {
  const q = { ...req.query };
  delete q.path;
  delete q.__hvm_path;
  return q;
}
async function run(
  req: Request,
  res: Response,
  work: (actor: NotificationActor) => Promise<unknown>,
  admin = false,
) {
  res.set("Cache-Control", "private, no-store");
  try {
    const actor: NotificationActor = admin
      ? {
          userId: req.adminActor!.userId,
          role: req.adminActor!.role,
          admin: req.adminActor!,
        }
      : { userId: publicUser(req), role: publicRole(req) };
    res.json(await work(actor));
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
adminNotificationRouter.use("/notifications", adminSessionMiddleware);
for (const [router, admin] of [
  [notificationRouter, false],
  [adminNotificationRouter, true],
] as const) {
  router.get("/notifications", (req, res) =>
    run(
      req,
      res,
      (a) => NotificationService.list(a, notificationQuery(req)),
      admin,
    ),
  );
  router.post("/notifications/read-all", originProtection, (req, res) =>
    run(req, res, (a) => NotificationService.readAll(a, req.body), admin),
  );
  router.post("/notifications/:id/read", originProtection, (req, res) =>
    run(
      req,
      res,
      (a) => {
        z.object({}).strict().parse(req.body);
        return NotificationService.read(a, req.params.id);
      },
      admin,
    ),
  );
}
