import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  SaveRuralDraftSchema,
  SaveWizardStepSchema,
  SubmitPropertySchema,
} from "../../shared/contracts/ruralProperty.ts";
import { originProtection } from "../security/originProtection.ts";
import { verifyRecentAuthProof } from "../security/recentAuth.ts";
import {
  RuralPropertyError,
  RuralPropertyService,
} from "../services/RuralPropertyService.ts";

export const ruralPropertyRouter = Router();

function readCookie(req: Request, name: string) {
  const part = req.headers.cookie
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(name + "="));
  if (!part) return "";
  try {
    return decodeURIComponent(part.slice(name.length + 1));
  } catch {
    return "";
  }
}

function readAccessToken(req: Request) {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer "))
    return authorization.slice(7).trim();
  return readCookie(req, "hvm_access");
}

function requireProducer(req: Request, res: Response) {
  if (!req.actor) {
    res.status(401).json({
      error: "AUTH_REQUIRED",
      requestId: req.requestId,
    });
    return null;
  }

  const selectedRole = readCookie(req, "hvm_portal_role");
  if (
    !req.actor.roles.includes("producer") ||
    (selectedRole && selectedRole !== "producer")
  ) {
    res.status(403).json({
      error: "PRODUCER_PROFILE_REQUIRED",
      requestId: req.requestId,
    });
    return null;
  }

  return {
    userId: req.actor.userId,
    role: "producer",
  };
}

function requireRecentAuth(req: Request, res: Response, userId: string) {
  const accessToken = readAccessToken(req);
  const proof = readCookie(req, "hvm_reauth");
  if (
    !accessToken ||
    !verifyRecentAuthProof(proof, userId, accessToken)
  ) {
    res.status(401).json({
      error: "RECENT_AUTH_REQUIRED",
      requestId: req.requestId,
    });
    return false;
  }
  return true;
}

function parsePropertyId(req: Request, res: Response) {
  const parsed = z.uuid().safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      fields: parsed.error.issues,
      requestId: req.requestId,
    });
    return null;
  }
  return parsed.data;
}

function sendError(res: Response, error: unknown) {
  if (error instanceof RuralPropertyError) {
    res.status(error.status).json({
      error: error.code,
      message: error.message,
      requestId: res.locals.requestId,
    });
    return;
  }
  res.status(503).json({
    error: "DEPENDENCY_UNAVAILABLE",
    requestId: res.locals.requestId,
  });
}

ruralPropertyRouter.get(
  "/producer/properties",
  originProtection,
  async (req: Request, res: Response) => {
    const actor = requireProducer(req, res);
    if (!actor) return;
    try {
      const properties = await RuralPropertyService.listProperties(
        actor.userId,
      );
      res.status(200).json({ properties });
    } catch (error) {
      sendError(res, error);
    }
  },
);

ruralPropertyRouter.get(
  "/producer/properties/activity-default",
  originProtection,
  async (req: Request, res: Response) => {
    const actor = requireProducer(req, res);
    if (!actor) return;
    try {
      res.status(200).json(
        await RuralPropertyService.getDefaultActivity(actor.userId),
      );
    } catch (error) {
      sendError(res, error);
    }
  },
);

ruralPropertyRouter.get(
  "/producer/properties/:id",
  originProtection,
  async (req: Request, res: Response) => {
    const actor = requireProducer(req, res);
    if (!actor) return;
    const propertyId = parsePropertyId(req, res);
    if (!propertyId) return;

    try {
      const property = await RuralPropertyService.getProperty(
        actor.userId,
        propertyId,
      );
      res.status(200).json({ property });
    } catch (error) {
      sendError(res, error);
    }
  },
);

ruralPropertyRouter.post(
  "/producer/properties/wizard/save-step",
  originProtection,
  async (req: Request, res: Response) => {
    const actor = requireProducer(req, res);
    if (!actor) return;
    if (!requireRecentAuth(req, res, actor.userId)) return;

    const parsed = SaveWizardStepSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: parsed.error.issues,
        requestId: req.requestId,
      });
      return;
    }

    try {
      const result = await RuralPropertyService.saveWizardStep(
        actor.userId,
        actor.role,
        parsed.data,
        req.requestId,
        req.clientIpHash,
      );
      const created = parsed.data.step === 2 && !parsed.data.propertyId;
      res.status(created ? 201 : 200).json(result);
    } catch (error) {
      sendError(res, error);
    }
  },
);

ruralPropertyRouter.post(
  "/producer/properties/:id/submit",
  originProtection,
  async (req: Request, res: Response) => {
    const actor = requireProducer(req, res);
    if (!actor) return;
    const propertyId = parsePropertyId(req, res);
    if (!propertyId) return;
    if (!requireRecentAuth(req, res, actor.userId)) return;

    const parsed = SubmitPropertySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: parsed.error.issues,
        requestId: req.requestId,
      });
      return;
    }

    try {
      const result = await RuralPropertyService.submitProperty(
        actor.userId,
        actor.role,
        propertyId,
        parsed.data,
        req.requestId,
        req.clientIpHash,
      );
      res.status(200).json(result);
    } catch (error) {
      sendError(res, error);
    }
  },
);

ruralPropertyRouter.post("/producer/properties/wizard/draft",originProtection,async(req,res)=>{
 const actor=requireProducer(req,res);if(!actor)return;
 if(!requireRecentAuth(req,res,actor.userId))return;
 const input=SaveRuralDraftSchema.safeParse(req.body);if(!input.success){res.status(400).json({error:"VALIDATION_ERROR"});return;}
 try{res.json(await RuralPropertyService.saveDraft(actor.userId,actor.role,input.data,req.requestId,req.clientIpHash));}catch(e){sendError(res,e);}
});
ruralPropertyRouter.delete("/producer/properties/:id",originProtection,async(req,res)=>{
 const actor=requireProducer(req,res);if(!actor)return;const id=parsePropertyId(req,res);if(!id)return;
 if(!requireRecentAuth(req,res,actor.userId))return;
 const input=z.object({expectedRevision:z.number().int().positive(),commandId:z.uuid()}).strict().safeParse(req.body);
 if(!input.success){res.status(400).json({error:"VALIDATION_ERROR"});return;}
 try{await RuralPropertyService.deleteDraft(actor.userId,id,input.data.expectedRevision,input.data.commandId,req.requestId,req.clientIpHash);res.status(204).end();}catch(e){sendError(res,e);}
});
ruralPropertyRouter.get("/producer/properties/:id/delete-impact",originProtection,async(req,res)=>{
 const actor=requireProducer(req,res);if(!actor)return;const id=parsePropertyId(req,res);if(!id)return;
 try{res.status(200).json(await RuralPropertyService.approvedDeletionImpact(actor.userId,id));}catch(e){sendError(res,e);}
});
ruralPropertyRouter.post("/producer/properties/:id/withdraw",originProtection,async(req,res)=>{
 const actor=requireProducer(req,res);if(!actor)return;const id=parsePropertyId(req,res);if(!id)return;
 if(!requireRecentAuth(req,res,actor.userId))return;
 const input=z.object({expectedRevision:z.number().int().positive(),commandId:z.uuid()}).strict().safeParse(req.body);
 if(!input.success){res.status(400).json({error:"VALIDATION_ERROR"});return;}
 try{await RuralPropertyService.withdrawApproved(actor.userId,id,input.data.expectedRevision,input.data.commandId,req.requestId,req.clientIpHash);res.status(204).end();}catch(e){sendError(res,e);}
});
