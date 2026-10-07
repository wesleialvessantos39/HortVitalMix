import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ProducerSalesService } from "../services/ProducerSalesService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { publicUser } from "../security/publicRole.ts";
import { notificationQuery } from "./notificationRoutes.ts";
export const producerSalesRouter = Router();
async function run(
  req: Request,
  res: Response,
  work: (uid: string) => Promise<unknown>,
) {
  res.set("Cache-Control", "private, no-store");
  try {
    res.json(await work(publicUser(req, "producer")));
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
producerSalesRouter.get("/producer/sales", (req, res) =>
  run(req, res, (u) => ProducerSalesService.sales(u, notificationQuery(req))),
);
producerSalesRouter.get("/producer/refunds", (req, res) =>
  run(req, res, (u) => ProducerSalesService.refunds(u, notificationQuery(req))),
);
producerSalesRouter.get("/producer/refunds/:id", (req, res) =>
  run(req, res, (u) =>
    ProducerSalesService.refunds(u, notificationQuery(req), req.params.id),
  ),
);
