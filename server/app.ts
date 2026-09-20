import express from "express";
import { randomUUID } from "node:crypto";
import { foundationRouter } from "./routes/foundationRoutes.ts";
import { authRouter } from "./routes/authRoutes.ts";
import { reportFailure } from "./config/reportFailure.ts";
import { sessionMiddleware } from "./middleware/session.ts";
import { isAllowedRequestOrigin } from "./security/origin.ts";
export const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.locals.requestId = randomUUID();
  res.set({
    "x-request-id": res.locals.requestId,
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  });
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !isAllowedRequestOrigin(req)
  ) {
    res
      .status(403)
      .json({ error: "ORIGIN_NOT_ALLOWED", requestId: res.locals.requestId });
    return;
  }
  next();
});
app.use((req, _res, next) => {
  if (req.body && typeof req.body === "object") {
    // Prevent express.json from trying to re-read an already consumed stream in serverless environments (Vercel)
    (req as unknown as { _body?: boolean })._body = true;
  }
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(sessionMiddleware);
app.use(foundationRouter);
app.use("/api", foundationRouter);
app.use("/v1/auth", authRouter);
app.use("/api/v1/auth", authRouter);
app.use((_req, res) => {
  res.status(404).json({ error: "NOT_FOUND", requestId: res.locals.requestId });
});
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const malformed =
      (error as { type?: string })?.type === "entity.parse.failed";
    reportFailure(
      malformed ? "invalid_json" : "request_failed",
      res.locals.requestId,
    );
    res
      .status(malformed ? 400 : 503)
      .json({
        error: malformed ? "INVALID_JSON" : "DEPENDENCY_UNAVAILABLE",
        requestId: res.locals.requestId,
      });
  },
);
