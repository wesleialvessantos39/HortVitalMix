import { Router } from "express";
import { z } from "zod";
import {
  PublicMediaService,
  PublicMediaQuerySchema,
} from "../services/PublicMediaService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
export const publicMediaRouter = Router();
publicMediaRouter.get("/public-media/:kind/:id", async (req, res) => {
  try {
    const query = { ...req.query };
    delete query.path;
    delete query.__hvm_path;
    const { width } = PublicMediaQuerySchema.parse(query);
    const image = await PublicMediaService.image(
      req.params.kind,
      req.params.id,
      width,
    );
    res.set({
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=300",
      "CDN-Cache-Control": "public, max-age=300",
      "Vercel-CDN-Cache-Control": "public, max-age=300",
      ETag: image.etag,
      "Content-Disposition": "inline",
    });
    if (req.headers["if-none-match"] === image.etag) {
      res.status(304).end();
      return;
    }
    res.send(image.bytes);
  } catch (e) {
    res
      .set("Cache-Control", "no-store")
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
              : "MEDIA_UNAVAILABLE",
        requestId: req.requestId,
      });
  }
});
