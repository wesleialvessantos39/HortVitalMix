import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  CreateDraftStoreSchema,
  PauseStoreSchema,
  SaveStoreSettingsSchema,
  StoreCommandSchema,
  StoreSlugSchema,
  UpdateOperatingHoursSchema,
  StoreCoverSettingsSchema,
  StoreMediaRemoveSchema,
  StoreMediaUploadQuerySchema,
} from "../../shared/contracts/producerStore.ts";
import { originProtection } from "../security/originProtection.ts";
import { verifyRecentAuthProof } from "../security/recentAuth.ts";
import {
  ProducerStoreError,
  ProducerStoreService,
} from "../services/ProducerStoreService.ts";
import { StoreMediaService } from "../services/StoreMediaService.ts";
import { PRODUCT_MEDIA_MAX_BYTES } from "../../shared/contracts/product.ts";

export const producerStoreRouter = Router();
function storeResponse(value: unknown, req: Request) {
  if (!value || typeof value !== "object" || req.query.media === "1")
    return value;
  const {
    coverMode: _mode,
    publicProducerName: _name,
    coverImages: _images,
    ...legacy
  } = value as Record<string, unknown>;
  return legacy;
}
function cookie(req: Request, name: string) {
  const part = req.headers.cookie
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(name + "="));
  try {
    return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
  } catch {
    return "";
  }
}
function requireProducer(req: Request, res: Response, recent = false) {
  const actor = req.actor;
  if (!actor) {
    res.status(401).json({ error: "AUTH_REQUIRED" });
    return null;
  }
  const portal = cookie(req, "hvm_portal_role");
  if (!actor.roles.includes("producer") || (portal && portal !== "producer")) {
    res.status(403).json({ error: "PRODUCER_PROFILE_REQUIRED" });
    return null;
  }
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7).trim()
    : cookie(req, "hvm_access");
  if (
    recent &&
    (!token ||
      !verifyRecentAuthProof(cookie(req, "hvm_reauth"), actor.userId, token))
  ) {
    res.status(401).json({ error: "RECENT_AUTH_REQUIRED" });
    return null;
  }
  return actor.userId;
}
function sendError(res: Response, error: unknown) {
  const known = error instanceof ProducerStoreError;
  res.status(known ? error.status : 503).json({
    error: known ? error.code : "DEPENDENCY_UNAVAILABLE",
    ...(known && error.currentRevision
      ? { currentRevision: error.currentRevision }
      : {}),
    requestId: res.locals.requestId,
  });
}
producerStoreRouter.get("/producer/store", async (req, res) => {
  const userId = requireProducer(req, res);
  if (!userId) return;
  try {
    const result = await ProducerStoreService.getStoreSettings(userId);
    res.json({ ...result, store: storeResponse(result.store, req) });
  } catch (error) {
    sendError(res, error);
  }
});
producerStoreRouter.post(
  "/producer/store",
  originProtection,
  async (req, res) => {
    const userId = requireProducer(req, res, true);
    if (!userId) return;
    const parsed = CreateDraftStoreSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "VALIDATION_ERROR" });
      return;
    }
    try {
      res.json({
        store: storeResponse(
          await ProducerStoreService.getOrCreateDraftStore(
            userId,
            parsed.data.commandId,
            { requestId: req.requestId, ipHash: req.clientIpHash },
          ),
          req,
        ),
      });
    } catch (error) {
      sendError(res, error);
    }
  },
);

function registerMutation<T>(
  method: "post" | "patch",
  suffix: string,
  schema: z.ZodType<T>,
  recent: boolean,
  run: (
    id: string,
    userId: string,
    input: T,
    context: { requestId: string; ipHash: string },
  ) => Promise<unknown>,
) {
  producerStoreRouter[method](
    "/producer/store/:id" + suffix,
    originProtection,
    async (req, res) => {
      const userId = requireProducer(req, res, recent);
      if (!userId) return;
      const id = z.uuid().safeParse(req.params.id);
      const input = schema.safeParse(req.body);
      if (!id.success || !input.success) {
        res.status(400).json({ error: "VALIDATION_ERROR" });
        return;
      }
      try {
        res.json({
          store: storeResponse(
            await run(id.data, userId, input.data, {
              requestId: req.requestId,
              ipHash: req.clientIpHash,
            }),
            req,
          ),
        });
      } catch (error) {
        sendError(res, error);
      }
    },
  );
}
registerMutation("patch", "", SaveStoreSettingsSchema, true, (...args) =>
  ProducerStoreService.saveStoreSettings(...args),
);
registerMutation(
  "post",
  "/operating-hours",
  UpdateOperatingHoursSchema,
  true,
  (...args) => ProducerStoreService.updateOperatingHours(...args),
);
registerMutation("post", "/publish", StoreCommandSchema, true, (...args) =>
  ProducerStoreService.publishStore(...args),
);
// Emergency pause requires ownership and CSRF protection, without delaying it
// for recent-password confirmation. Reopening uses the full publication gate.
registerMutation("post", "/pause", PauseStoreSchema, false, (...args) =>
  ProducerStoreService.pauseStore(...args),
);
registerMutation("post", "/cover", StoreCoverSettingsSchema, true, (...args) =>
  StoreMediaService.configure(...args),
);
registerMutation(
  "post",
  "/media/remove",
  StoreMediaRemoveSchema,
  false,
  (...args) => StoreMediaService.remove(...args),
);
producerStoreRouter.post(
  "/producer/store/:id/media/upload",
  originProtection,
  (req, res, next) => {
    if (requireProducer(req, res, true)) next();
  },
  express.raw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: PRODUCT_MEDIA_MAX_BYTES,
  }),
  async (req, res) => {
    const userId = requireProducer(req, res, true);
    if (!userId) return;
    const id = z.uuid().safeParse(req.params.id);
    const params = new URL(req.originalUrl, "http://localhost").searchParams;
    const query: Record<string, unknown> = Object.create(null);
    for (const key of new Set(params.keys())) {
      const values = params.getAll(key);
      query[key] = values.length === 1 ? values[0] : values;
    }
    delete query.media;
    delete query.path;
    delete query.__hvm_path;
    const input = StoreMediaUploadQuerySchema.safeParse(query);
    if (!id.success || !input.success || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "VALIDATION_ERROR" });
      return;
    }
    try {
      res.json({
        store: await StoreMediaService.upload(
          id.data,
          userId,
          input.data,
          req.body,
          req.get("content-type")!.split(";")[0],
          { requestId: req.requestId, ipHash: req.clientIpHash },
        ),
      });
    } catch (error) {
      sendError(res, error);
    }
  },
);
producerStoreRouter.get("/stores/:slug", async (req, res) => {
  const slug = StoreSlugSchema.safeParse(req.params.slug);
  if (!slug.success) {
    res.status(404).json({ error: "STORE_NOT_FOUND" });
    return;
  }
  try {
    res.json(
      storeResponse(await ProducerStoreService.getPublicStore(slug.data), req),
    );
  } catch (error) {
    sendError(res, error);
  }
});
