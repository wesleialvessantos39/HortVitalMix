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
