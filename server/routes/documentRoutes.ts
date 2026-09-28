import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  CommandSchema,
  RequestUploadUrlSchema,
  ReviewExtractionSchema,
} from "../../shared/contracts/documents.ts";
import {
  DocumentStorageService,
  DocumentError,
  type DocumentActor,
} from "../services/DocumentStorageService.ts";
import { GeminiDocumentProcessor } from "../services/GeminiDocumentProcessor.ts";
import { originProtection } from "../security/originProtection.ts";
import { adminSessionMiddleware } from "../middleware/adminSession.ts";
function actor(req: Request, auditor: boolean): DocumentActor {
  if (auditor) {
    if (
      !req.adminActor ||
      (!req.adminActor.isSuperAdmin &&
        !req.adminActor.sectors.includes("document_verification"))
    )
      throw new DocumentError("FORBIDDEN", 403);
    return {
      userId: req.adminActor.userId,
      role: req.adminActor.role,
      auditor: true,
      requestId: req.requestId,
      ipHash: req.clientIpHash,
    };
  }
  if (!req.actor) throw new DocumentError("AUTH_REQUIRED", 401);
  const portal = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("hvm_portal_role="))
    ?.split("=")[1];
  if (
    !req.actor.roles.includes("producer") ||
    (portal && portal !== "producer")
  )
    throw new DocumentError("FORBIDDEN", 403);
  return {
    userId: req.actor.userId,
    role: "producer",
    auditor: false,
    requestId: req.requestId,
    ipHash: req.clientIpHash,
  };
}
function router(auditor = false) {
  const r = Router();
  if (auditor) r.use(adminSessionMiddleware);
  r.use(originProtection);
  const handle =
    (fn: (req: Request, a: DocumentActor) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      try {
        const a = actor(req, auditor);
        res.json(await fn(req, a));
      } catch (e) {
        const error =
          e instanceof DocumentError
            ? e
            : e instanceof z.ZodError
              ? new DocumentError("VALIDATION_ERROR", 422)
              : new DocumentError("UNAVAILABLE", 503);
        res
          .status(error.status)
          .json({ error: error.code, requestId: req.requestId });
      }
    };
  r.get(
    "/",
    handle(async (req, a) => ({
      documents: await DocumentStorageService.list(
        a,
        z.uuid().parse(req.query.propertyId),
      ),
    })),
  );
  r.get(
    "/:id/download",
    handle((req, a) =>
      DocumentStorageService.download(a, z.uuid().parse(req.params.id)),
    ),
  );
  r.get(
    "/:id/extraction",
    handle((req, a) =>
      GeminiDocumentProcessor.read(a, z.uuid().parse(req.params.id)),
    ),
  );
  if (!auditor) {
    r.post(
      "/upload-url",
      handle((req, a) =>
        DocumentStorageService.requestUpload(
          a,
          RequestUploadUrlSchema.parse(req.body),
        ),
      ),
    );
    r.post(
      "/:id/confirm",
      handle((req, a) =>
        DocumentStorageService.confirm(
          a,
          z.uuid().parse(req.params.id),
          CommandSchema.parse(req.body).commandId,
        ),
      ),
    );
    r.post(
      "/:id/archive",
      handle((req, a) =>
        DocumentStorageService.archive(
          a,
          z.uuid().parse(req.params.id),
          CommandSchema.parse(req.body).commandId,
        ),
      ),
    );
    r.post(
      "/:id/extraction",
      handle((req, a) =>
        GeminiDocumentProcessor.process(
          a,
          z.uuid().parse(req.params.id),
          CommandSchema.parse(req.body).commandId,
        ),
      ),
    );
    r.post(
      "/:id/review",
      handle((req, a) =>
        GeminiDocumentProcessor.review(
          a,
          z.uuid().parse(req.params.id),
          ReviewExtractionSchema.parse(req.body),
        ),
      ),
    );
  }
  return r;
}
export const documentRouter = router();
export const adminDocumentRouter = router(true);
