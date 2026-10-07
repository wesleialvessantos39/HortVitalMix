import { publicRole, publicUser } from "../security/publicRole.ts";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { CommerceService } from "../services/CommerceService.ts";
import { AfterSalesService } from "../services/AfterSalesService.ts";
import { PaymentService } from "../services/PaymentService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { CheckoutCommandIdSchema } from "../../shared/contracts/checkout.ts";
import { originProtection } from "../security/originProtection.ts";
import {
  adminSessionMiddleware,
  requireAdminSector,
  requireRecentAuth,
} from "../middleware/adminSession.ts";

export const commerceRouter = Router();
export const adminCommerceRouter = Router();
const context = (req: Request) => ({
  requestId: req.requestId,
  ipHash: req.clientIpHash,
});
async function run(
  req: Request,
  res: Response,
  operation: () => Promise<unknown>,
  status = 200,
) {
  try {
    res.status(status).json(await operation());
  } catch (error) {
    const known =
      error instanceof CommerceError ||
      (error instanceof Error && "status" in error && "code" in error);
    res
      .status(
        known
          ? Number((error as CommerceError).status)
          : error instanceof z.ZodError
            ? 422
            : 503,
      )
      .json({
        error: known
          ? (error as CommerceError).code
          : error instanceof z.ZodError
            ? "VALIDATION_ERROR"
            : "DEPENDENCY_UNAVAILABLE",
        requestId: req.requestId,
      });
  }
}
const user = (req: Request) => publicUser(req);
const consumer = (req: Request) => publicUser(req, "consumer");
const producer = (req: Request) => publicUser(req, "producer");
const id = (value: unknown) => z.uuid().parse(value);
const command = z.object({ commandId: CheckoutCommandIdSchema }).strict();
const pageQuery = (req: Request) =>
  z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .parse(req.query.page ?? 1);
const filterQuery = (req: Request) =>
  z.enum(["all", "open", "closed"]).parse(req.query.filter ?? "all");
commerceRouter.use("/commerce/refunds",(req,res,next)=>{try{consumer(req);next();}catch(e){res.status((e as CommerceError).status??403).json({error:(e as CommerceError).code,requestId:req.requestId});}});
commerceRouter.get("/commerce/policy", (req, res) =>
  run(req, res, () => CommerceService.policy()),
);
commerceRouter.get("/commerce/purchases", (req, res) =>
  run(req, res, () => CommerceService.purchases(consumer(req))),
);
commerceRouter.get("/commerce/report-targets", (req, res) =>
  run(req, res, () =>
    AfterSalesService.targets(
      user(req),
      z
        .enum(["store", "producer", "product", "customer"])
        .parse(req.query.type),
      z
        .string()
        .trim()
        .max(100)
        .parse(req.query.search ?? ""),
    ),
  ),
);
commerceRouter.post(
  "/commerce/orders/:id/received",
  originProtection,
  (req, res) =>
    run(req, res, () =>
      CommerceService.received(
        consumer(req),
        id(req.params.id),
        command.parse(req.body).commandId,
        context(req),
      ),
    ),
);
commerceRouter.get("/payments/:id", (req, res) =>
  run(req, res, () => PaymentService.view(user(req), id(req.params.id), publicRole(req))),
);
commerceRouter.post("/payments/:id/policy", originProtection, (req, res) =>
  run(req, res, () =>
    PaymentService.acceptPolicy(
      user(req),
      id(req.params.id),
      z
        .object({ policyVersion: z.number().int().positive() })
        .strict()
        .parse(req.body).policyVersion,
      context(req),
      publicRole(req),
    ),
  ),
);
commerceRouter.post("/payments/:id/start", originProtection, (req, res) =>
  run(req, res, async () => {
    z.object({}).strict().parse(req.body);
    await PaymentService.view(user(req), id(req.params.id), publicRole(req));
    throw new CommerceError("GATEWAY_NOT_CONFIGURED", 503);
  }),
);
commerceRouter.post("/payments/webhook", (req, res) =>
  run(req, res, () =>
    PaymentService.webhook(
      { body: req.body, headers: req.headers, query: req.query },
      context(req),
    ),
  ),
);
commerceRouter.get("/producer/pos", (req, res) =>
  run(req, res, () => CommerceService.posContext(producer(req))),
);
commerceRouter.post("/producer/pos/sales", originProtection, (req, res) =>
  run(
    req,
    res,
    () => CommerceService.createPosSale(producer(req), req.body, context(req)),
    201,
  ),
);
commerceRouter.post(
  "/producer/pos/sales/:id/cancel",
  originProtection,
  (req, res) =>
    run(req, res, () =>
      CommerceService.cancelPosSale(
        producer(req),
        id(req.params.id),
        command.parse(req.body).commandId,
        context(req),
      ),
    ),
);
commerceRouter.get("/commerce/pos/:code", (req, res) =>
  run(req, res, () =>
    CommerceService.posSale(consumer(req), String(req.params.code)),
  ),
);
commerceRouter.post(
  "/commerce/pos/:code/accept",
  originProtection,
  (req, res) =>
    run(req, res, () =>
      CommerceService.acceptPosSale(
        consumer(req),
        String(req.params.code),
        req.body,
        context(req),
      ),
    ),
);
for (const [kind, path, create] of [
  ["refund", "refunds", AfterSalesService.requestRefund],
  ["complaint", "complaints", AfterSalesService.createComplaint],
] as const) {
  commerceRouter.get("/commerce/" + path, (req, res) =>
    run(req, res, () =>
      AfterSalesService.cases(
        user(req),
        kind,
        undefined,
        pageQuery(req),
        filterQuery(req),
        publicRole(req),
      ),
    ),
  );
  commerceRouter.post("/commerce/" + path, originProtection, (req, res) =>
    run(req, res, () => kind === "refund" ? create(consumer(req), req.body, context(req)) : AfterSalesService.createComplaint(user(req),req.body,context(req),publicRole(req)), 201),
  );
  commerceRouter.get("/commerce/" + path + "/:id", (req, res) =>
    run(req, res, () =>
      AfterSalesService.detail(user(req), kind, id(req.params.id), undefined, publicRole(req)),
    ),
  );
  commerceRouter.post(
    "/commerce/" + path + "/:id/messages",
    originProtection,
    (req, res) =>
      run(req, res, () =>
        AfterSalesService.message(
          user(req),
          kind,
          id(req.params.id),
          req.body,
          context(req),
          undefined,
          publicRole(req),
        ),
      ),
  );
}
commerceRouter.post("/commerce/evidence", originProtection, (req, res) =>
  run(
    req,
    res,
    () => AfterSalesService.uploadEvidence(user(req), req.body, context(req),undefined,publicRole(req)),
    201,
  ),
);
commerceRouter.get("/commerce/evidence/:id", (req, res) =>
  run(req, res, () => AfterSalesService.evidence(user(req), id(req.params.id),undefined,publicRole(req))),
);
adminCommerceRouter.use("/commerce", adminSessionMiddleware);
adminCommerceRouter.post("/commerce/refunds/:id/seller-contacts",originProtection,requireAdminSector("refund_management"),requireRecentAuth,(req,res)=>
  run(req,res,()=>AfterSalesService.contactSeller(req.adminActor!,id(req.params.id),req.body,context(req))));
adminCommerceRouter.get("/commerce/settings", (req, res) =>
  run(req, res, () => CommerceService.settings(req.adminActor!)),
);
adminCommerceRouter.post(
  "/commerce/settings",
  originProtection,
  requireRecentAuth,
  (req, res) =>
    run(req, res, () =>
      CommerceService.updateSettings(req.adminActor!, req.body, context(req)),
    ),
);
for (const [kind, path, capability, decide] of [
  ["refund", "refunds", "refund_management", AfterSalesService.decideRefund],
  [
    "complaint",
    "complaints",
    "complaint_management",
    AfterSalesService.decideComplaint,
  ],
] as const) {
  const guard = requireAdminSector(capability);
  adminCommerceRouter.get("/commerce/" + path, guard, (req, res) =>
    run(req, res, () =>
      AfterSalesService.cases(
        req.adminActor!.userId,
        kind,
        req.adminActor,
        pageQuery(req),
        filterQuery(req),
      ),
    ),
  );
  adminCommerceRouter.get("/commerce/" + path + "/:id", guard, (req, res) =>
    run(req, res, () =>
      AfterSalesService.detail(
        req.adminActor!.userId,
        kind,
        id(req.params.id),
        req.adminActor,
      ),
    ),
  );
  adminCommerceRouter.post(
    "/commerce/" + path + "/:id/decision",
    originProtection,
    guard,
    requireRecentAuth,
    (req, res) =>
      run(req, res, () =>
        decide(req.adminActor!, id(req.params.id), req.body, context(req)),
      ),
  );
  adminCommerceRouter.post(
    "/commerce/" + path + "/:id/messages",
    originProtection,
    guard,
    requireRecentAuth,
    (req, res) =>
      run(req, res, () =>
        AfterSalesService.message(
          req.adminActor!.userId,
          kind,
          id(req.params.id),
          req.body,
          context(req),
          req.adminActor,
        ),
      ),
  );
}
adminCommerceRouter.post(
  "/commerce/refunds/:id/process",
  originProtection,
  requireAdminSector("refund_management"),
  requireRecentAuth,
  (req, res) =>
    run(req, res, () =>
      AfterSalesService.processRefund(
        req.adminActor!,
        id(req.params.id),
        context(req),
      ),
    ),
);
adminCommerceRouter.post(
  "/commerce/evidence",
  originProtection,
  requireRecentAuth,
  (req, res) =>
    run(
      req,
      res,
      () =>
        AfterSalesService.uploadEvidence(
          req.adminActor!.userId,
          req.body,
          context(req),
          req.adminActor,
        ),
      201,
    ),
);
adminCommerceRouter.get("/commerce/evidence/:id", (req, res) =>
  run(req, res, () =>
    AfterSalesService.evidence(
      req.adminActor!.userId,
      id(req.params.id),
      req.adminActor,
    ),
  ),
);
