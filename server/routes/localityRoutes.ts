import {dbPool} from "../db/pool.ts";
import {z} from "zod";
import {localityBlockedMessage} from "../../shared/contracts/locality.ts";
import { Router, type Request, type Response } from "express";
import { originProtection } from "../security/originProtection.ts";
import { verifyRecentAuthProof } from "../security/recentAuth.ts";
import {
  LocalityCoverageQuerySchema,
  UpdateProducerDeliveryScopeSchema,
} from "../../shared/contracts/locality.ts";
import {
  AccessScopeService,
  accessScopeFailure,
} from "../services/AccessScopeService.ts";
import {
  LocalityService,
  localityFailure,
} from "../services/LocalityService.ts";

export const localityRouter = Router();

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
    res.status(401).json({ error: "AUTH_REQUIRED", requestId: req.requestId });
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
  return { userId: req.actor.userId, role: "producer" as const };
}

// ---------------------------------------------------------------------------
// Catálogo público de localidades — a tela global precisa disto SEM sessão.
// ---------------------------------------------------------------------------

localityRouter.get("/localities", async (req: Request, res: Response) => {
  try {
    const result = await LocalityService.listMunicipalities(false);
    res.status(200).json(result);
  } catch (error) {
    const failure = localityFailure(error, req.requestId);
    res
      .status(failure.status)
      .json({ error: failure.error, message: failure.message });
  }
});

localityRouter.get(
  "/localities/coverage",
  async (req: Request, res: Response) => {
    const parsed = LocalityCoverageQuerySchema.safeParse({
      state: req.query.state ?? "RO",
      municipality: req.query.municipality,
    });
    if (!parsed.success) {
      res.status(422).json({
        error: "VALIDATION_FAILED",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        requestId: req.requestId,
      });
      return;
    }
    try {
      const result = await LocalityService.resolveCoverage(
        parsed.data.state,
        parsed.data.municipality,
      );
      res.status(200).json(result);
    } catch (error) {
      const failure = localityFailure(error, req.requestId);
      res
        .status(failure.status)
        .json({ error: failure.error, message: failure.message });
    }
  },
);

// ---------------------------------------------------------------------------
// Escopo de entrega do produtor (item 3 do proprietário).
// ---------------------------------------------------------------------------

localityRouter.get(
  "/producer/delivery-scope",
  async (req: Request, res: Response) => {
    const producer = requireProducer(req, res);
    if (!producer) return;
    try {
      const scope = await AccessScopeService.getDeliveryScope(producer.userId);
      res.status(200).json(scope);
    } catch (error) {
      const failure = accessScopeFailure(error, req.requestId);
      res
        .status(failure.status)
        .json({ error: failure.error, message: failure.message });
    }
  },
);

localityRouter.put(
  "/producer/delivery-scope",
  originProtection,
  async (req: Request, res: Response) => {
    const producer = requireProducer(req, res);
    if (!producer) return;

    const parsed = UpdateProducerDeliveryScopeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: "VALIDATION_FAILED",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        requestId: req.requestId,
      });
      return;
    }

    // Mudar o escopo de entrega altera a vitrine do produtor: exige prova de
    // reautenticação recente, como as demais operações sensíveis da conta.
    const proof = readCookie(req, "hvm_reauth");
    const token = readAccessToken(req);
    if (!verifyRecentAuthProof(proof, producer.userId, token)) {
      res.status(401).json({
        error: "REAUTH_REQUIRED",
        message: "Confirme sua senha para alterar o escopo de entrega.",
        requestId: req.requestId,
      });
      return;
    }

    try {
      const scope = await AccessScopeService.updateDeliveryScope(
        producer.userId,
        producer.role,
        {
          mode: parsed.data.mode,
          municipalityIds: parsed.data.municipalityIds,
          expectedRevision: parsed.data.expectedRevision,
          commandId: parsed.data.commandId,
        },
        req.requestId,
        req.clientIpHash,
      );
      res.status(200).json(scope);
    } catch (error) {
      const failure = accessScopeFailure(error, req.requestId);
      res
        .status(failure.status)
        .json({ error: failure.error, message: failure.message });
    }
  },
);

localityRouter.get("/localities/account-coverage",async(req,res)=>{
 if(!req.actor){res.status(401).json({error:"AUTH_REQUIRED"});return;}
 if(!dbPool){res.status(503).json({error:"UNAVAILABLE"});return;}
 try {
 const result=await dbPool.query(`WITH regions AS (
 SELECT m.name,m.state FROM public.app_people p JOIN public.app_municipalities m ON m.id=p.municipality_id WHERE p.user_id=$1
 UNION SELECT i.locality_name,i.state FROM public.app_locality_user_impacts i WHERE i.user_id=$1 AND i.resolved_at IS NULL
 UNION SELECT pr.municipality,pr.state FROM public.app_properties pr JOIN public.app_producer_profiles pp ON pp.id=pr.producer_id JOIN public.app_people p ON p.id=pp.person_id WHERE p.user_id=$1 AND pr.status='verified'
 UNION SELECT a.city,a.state FROM public.app_user_addresses a JOIN public.app_people p ON p.id=a.person_id WHERE p.user_id=$1 AND a.is_active
 ) SELECT r.name,r.state,public.fn_locality_coverage(r.state,r.name) AS coverage FROM regions r WHERE r.name IS NOT NULL`,[req.actor.userId]);
 res.json({regions:result.rows.map(row=>({...row,message:row.coverage==='active'?null:localityBlockedMessage(row.coverage)}))});
 }catch{res.status(503).json({error:"UNAVAILABLE"});}
});
localityRouter.get("/localities/access",async(req,res)=>{
 if(!req.actor){res.status(401).json({error:"AUTH_REQUIRED"});return;}
 const id=z.uuid().safeParse(req.query.municipalityId);if(!id.success){res.status(422).json({error:"VALIDATION_FAILED"});return;}
 try {const [publishing,purchasing]=await Promise.all([AccessScopeService.canPublishIn(req.actor.userId,id.data),AccessScopeService.canPurchaseIn(req.actor.userId,id.data)]);res.json({publishing,purchasing});}catch(e){const f=accessScopeFailure(e,req.requestId);res.status(f.status).json({error:f.error});}
});
