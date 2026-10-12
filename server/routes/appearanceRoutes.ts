import { Router, type Request, type Response } from "express";
import { UpdateAppearanceSchema } from "../../shared/contracts/appearance.ts";
import { adminSessionMiddleware } from "../middleware/adminSession.ts";
import { originProtection } from "../security/originProtection.ts";
import { AppearancePreferenceService, AppearancePreferenceError } from "../services/AppearancePreferenceService.ts";

export const appearanceRouter = Router();
export const adminAppearanceRouter = Router();

function actorId(req: Request, administrative: boolean) {
  return administrative ? req.adminActor?.userId : req.actor?.userId;
}
function sendError(res: Response, error: unknown) {
  res.status(error instanceof AppearancePreferenceError ? error.status : 503)
    .json({ error: error instanceof AppearancePreferenceError ? error.code : "APPEARANCE_UNAVAILABLE" });
}
function mount(router: Router, path: string, administrative: boolean) {
  router.get(path, async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const userId = actorId(req, administrative);
    if (!userId) { res.status(401).json({ error: "AUTH_REQUIRED" }); return; }
    try { res.json(await AppearancePreferenceService.get(userId)); }
    catch (error) { sendError(res, error); }
  });
  router.patch(path, originProtection, async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const userId = actorId(req, administrative);
    if (!userId) { res.status(401).json({ error: "AUTH_REQUIRED" }); return; }
    const input = UpdateAppearanceSchema.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "VALIDATION_ERROR" }); return; }
    if (input.data.expectedUserId !== userId) {
      res.status(409).json({ error: "SESSION_CHANGED" }); return;
    }
    try { res.json(await AppearancePreferenceService.set(userId, input.data.theme)); }
    catch (error) { sendError(res, error); }
  });
}

mount(appearanceRouter, "/account/appearance", false);
adminAppearanceRouter.use("/admin/account/appearance", adminSessionMiddleware);
mount(adminAppearanceRouter, "/admin/account/appearance", true);
