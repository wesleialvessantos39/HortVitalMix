import express from "express";
import { runtime } from "./config/runtime.ts";
import { decodedJsonBody } from "./middleware/decodedJsonBody.ts";
import { foundationRouter } from "./routes/foundationRoutes.ts";
import { authRouter } from "./routes/authRoutes.ts";
import { reportFailure } from "./config/reportFailure.ts";
import { sessionMiddleware } from "./middleware/session.ts";
import { isAllowedRequestOrigin } from "./security/origin.ts";
import { adminConfigRouter } from "./routes/adminConfigRoutes.ts";
import { adminGovernanceRouter } from "./routes/adminGovernanceRoutes.ts";
import { profilePrivacyRouter } from "./routes/profilePrivacyRoutes.ts";
import { ruralPropertyRouter } from "./routes/ruralPropertyRoutes.ts";
import { clientIpHashMiddleware, requestIdMiddleware } from "./middleware/contextEnrichers.ts";
import { documentRouter, adminDocumentRouter } from "./routes/documentRoutes.ts";
import { adminVerificationRouter } from "./routes/adminVerificationRoutes.ts";
import { localityRouter } from "./routes/localityRoutes.ts";
import { adminLocalityRouter } from "./routes/adminLocalityRoutes.ts";
import { drainStorageDeletionQueue } from "./services/StorageDeletionQueueService.ts";
import { producerStoreRouter } from "./routes/producerStoreRoutes.ts";
import { categoryRouter } from "./routes/categoryRoutes.ts";
import { inventoryRouter } from "./routes/inventoryRoutes.ts";
import { deliveryRouter } from "./routes/deliveryRoutes.ts";
import { productRouter } from "./routes/productRoutes.ts";
import { discoveryRouter } from "./routes/discoveryRoutes.ts";
import { cartRouter } from "./routes/cartRoutes.ts";
export const app = express();
app.disable("x-powered-by");

// Manutenção idempotente: a primeira instância de produção conclui objetos
// pendentes pela API oficial do Storage, sem tocar em storage.objects via SQL.
if (runtime.appEnv === "production")
  void drainStorageDeletionQueue();

app.use(requestIdMiddleware);
app.use(clientIpHashMiddleware);

app.use((req, res, next) => {
  res.set({
    "x-request-id": res.locals.requestId,
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  });
  const origin = req.headers.origin;
  if (typeof origin === "string" && isAllowedRequestOrigin(req)) {
    res.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET,HEAD,POST,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, Authorization, X-HVM-Request",
      Vary: "Origin",
    });
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
  }
  if (
    !["GET", "HEAD"].includes(req.method) &&
    !/^\/(?:api\/|_hvm_api\/)?v1\/admin(?:\/|$)/.test(req.path) &&
    !(runtime.appEnv !== "production" && req.headers["x-hvm-request"] === "1") &&
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
  try {
    if (req.is("application/json")) req.body = decodedJsonBody(req.body);
  } catch (error) {
    next(error);
    return;
  }
  if (req.body && typeof req.body === "object") {
    (req as unknown as { _body?: boolean })._body = true;
  }
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(sessionMiddleware);
app.use(foundationRouter);
app.use("/api", foundationRouter);
app.use("/_hvm_api", foundationRouter);
app.use("/v1/auth", authRouter);
app.use("/api/v1/auth", authRouter);
app.use("/_hvm_api/v1/auth", authRouter);
app.use("/v1", profilePrivacyRouter);
app.use("/api/v1", profilePrivacyRouter);
app.use("/_hvm_api/v1", profilePrivacyRouter);
app.use("/v1", ruralPropertyRouter);
app.use("/api/v1", ruralPropertyRouter);
app.use("/_hvm_api/v1", ruralPropertyRouter);
app.use("/v1", localityRouter);
app.use("/api/v1", localityRouter);
app.use("/_hvm_api/v1", localityRouter);
for (const prefix of ["/v1", "/api/v1", "/_hvm_api/v1"]) {
  app.use(prefix, producerStoreRouter);
  app.use(prefix, categoryRouter);
  app.use(prefix, productRouter);
  app.use(prefix, inventoryRouter);
  app.use(prefix, deliveryRouter);
  app.use(prefix, discoveryRouter);
  app.use(prefix, cartRouter);
}
for (const prefix of ["/v1", "/api/v1", "/_hvm_api/v1"]) {
  app.use(prefix + "/producer/documents", documentRouter);
  app.use(prefix + "/admin/documents", adminDocumentRouter);
}
app.use("/v1/admin", adminVerificationRouter);
app.use("/api/v1/admin", adminVerificationRouter);
app.use("/_hvm_api/v1/admin", adminVerificationRouter);
app.use("/v1/admin", adminGovernanceRouter);
app.use("/api/v1/admin", adminGovernanceRouter);
app.use("/_hvm_api/v1/admin", adminGovernanceRouter);
app.use("/v1/admin", adminConfigRouter);
app.use("/api/v1/admin", adminConfigRouter);
app.use("/_hvm_api/v1/admin", adminConfigRouter);
app.use("/v1/admin", adminLocalityRouter);
app.use("/api/v1/admin", adminLocalityRouter);
app.use("/_hvm_api/v1/admin", adminLocalityRouter);
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
    const tooLarge = (error as { type?: string })?.type === "entity.too.large";
    reportFailure(
      malformed ? "invalid_json" : "request_failed",
      res.locals.requestId,
    );
    res
      .status(tooLarge ? 413 : malformed ? 400 : 503)
      .json({
        error: tooLarge ? "PAYLOAD_TOO_LARGE" : malformed ? "INVALID_JSON" : "DEPENDENCY_UNAVAILABLE",
        requestId: res.locals.requestId,
      });
  },
);
