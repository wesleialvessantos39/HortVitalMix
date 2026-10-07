import { hasAdminPermission } from "../../shared/adminPermissions.ts";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { dbPool } from "../db/pool.ts";
import { originProtection } from "../security/originProtection.ts";
import {
  adminSessionMiddleware,
  requireRecentAuth,
} from "../middleware/adminSession.ts";
import {
  CreateMunicipalitySchema,
  CreatePartialBlockSchema,
  DeleteMunicipalitySchema,
  PartialBlockSubjectSchema,
  RevokePartialBlockSchema,
  UpdateMunicipalitySchema,
} from "../../shared/contracts/locality.ts";
import {
  LocalityService,
  localityFailure,
} from "../services/LocalityService.ts";
import {
  AccessScopeService,
  accessScopeFailure,
} from "../services/AccessScopeService.ts";

export const adminLocalityRouter = Router();

/**
 * Setor responsável pela gestão de localidades. O Super administrador sempre
 * pode; o Administrador Setorial somente com o setor `location_management`
 * concedido pelo Super administrador (Setores/Convites).
 *
 * A guarda é aplicada por rota — nunca com `use` sem caminho, porque este
 * router compartilha o prefixo `/v1/admin` com os demais portais.
 */
function requireLocationManagement(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    !hasAdminPermission(req.adminActor, "location_management")
  ) {
    res.status(403).json({
      error: "FORBIDDEN",
      message: "Acesso restrito à gestão de localidades.",
      requestId: req.requestId,
    });
    return;
  }
  next();
}

const guard = [adminSessionMiddleware, requireLocationManagement];

function fail(
  res: Response,
  failure: { status: number; error: string; message: string },
) {
  res
    .status(failure.status)
    .json({ error: failure.error, message: failure.message });
}

function actor(req: Request) {
  return { userId: req.adminActor!.userId, role: req.adminActor!.role };
}

adminLocalityRouter.get("/localities", ...guard, async (req, res) => {
  try {
    res.status(200).json(await LocalityService.listAdminMunicipalities());
  } catch (error) {
    fail(res, localityFailure(error, req.requestId));
  }
});

adminLocalityRouter.post(
  "/localities",
  originProtection,
  ...guard,
  requireRecentAuth,
  async (req: Request, res: Response) => {
    const parsed = CreateMunicipalitySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: "VALIDATION_FAILED",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        requestId: req.requestId,
      });
      return;
    }
    try {
      const result = await LocalityService.createMunicipality(
        parsed.data,
        { userId: req.adminActor!.userId, role: req.adminActor!.role },
        req.requestId,
        req.clientIpHash,
      );
      const status =
        result.status === "created"
          ? 201
          : result.status === "duplicate"
            ? 409
            : 422;
      res.status(status).json(result);
    } catch (error) {
      fail(res, localityFailure(error, req.requestId));
    }
  },
);

adminLocalityRouter.get(
  "/localities/:municipalityId/impact",
  ...guard,
  async (req: Request, res: Response) => {
  try {
    const municipality = await LocalityService.findMunicipality(
      req.params.municipalityId,
    );
    if (!municipality) {
      res.status(404).json({ error: "NOT_FOUND", requestId: req.requestId });
      return;
    }
    const impact = await LocalityService.deactivationImpact(
      req.params.municipalityId,
    );
      res.status(200).json({
        municipalityId: req.params.municipalityId,
        isActive: municipality.is_active,
        ...impact,
      });
    } catch (error) {
      fail(res, localityFailure(error, req.requestId));
    }
  },
);

adminLocalityRouter.patch(
  "/localities/:municipalityId",
  ...guard,
  originProtection,
  requireRecentAuth,
  async (req: Request, res: Response) => {
    const parsed = UpdateMunicipalitySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: "VALIDATION_FAILED",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        requestId: req.requestId,
      });
      return;
    }
    try {
      const result = await LocalityService.updateMunicipality(
        req.params.municipalityId,
        parsed.data,
        actor(req),
        req.requestId,
        req.clientIpHash,
      );
      const status =
        result.status === "updated"
          ? 200
          : result.status === "conflict"
            ? 409
            : 404;
      res.status(status).json(result);
    } catch (error) {
      fail(res, localityFailure(error, req.requestId));
    }
  },
);

adminLocalityRouter.delete(
  "/localities/:municipalityId",
  ...guard,
  originProtection,
  requireRecentAuth,
  async (req: Request, res: Response) => {
    const parsed = DeleteMunicipalitySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: "VALIDATION_FAILED",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        requestId: req.requestId,
      });
      return;
    }
    try {
      const result = await LocalityService.deleteMunicipality(
        req.params.municipalityId,
        parsed.data,
        actor(req),
        req.requestId,
        req.clientIpHash,
      );
      const status =
        result.status === "deleted"
          ? 200
          : result.status === "conflict"
            ? 409
            : 404;
      res.status(status).json(result);
    } catch (error) {
      fail(res, localityFailure(error, req.requestId));
    }
  },
);

// ---------------------------------------------------------------------------
// Bloqueios parciais por localidade (item 5 do proprietário).
// ---------------------------------------------------------------------------

adminLocalityRouter.get("/access-blocks", ...guard, async (req, res) => {
  const userId = req.query.userId;
  const subject = req.query.subject;
  const parsedSubject = subject
    ? PartialBlockSubjectSchema.safeParse(subject)
    : null;
  if (parsedSubject && !parsedSubject.success) {
    res.status(422).json({ error: "VALIDATION_FAILED", requestId: req.requestId });
    return;
  }
  if (userId && !z.uuid().safeParse(userId).success) {
    res.status(422).json({ error: "VALIDATION_FAILED", requestId: req.requestId });
    return;
  }
  try {
    const blocks = await AccessScopeService.listPartialBlocks({
      userId: typeof userId === "string" ? userId : undefined,
      subject: parsedSubject?.data,
      onlyActive: req.query.includeRevoked === "true" ? false : true,
    });
    res.status(200).json({ blocks });
  } catch (error) {
    fail(res, accessScopeFailure(error, req.requestId));
  }
});

adminLocalityRouter.get("/access-blocks/subject", ...guard, async (req, res) => {
  if (!dbPool) {
    res.status(503).json({ error: "UNAVAILABLE", requestId: req.requestId });
    return;
  }
  const rawCpf = String(req.query.cpf ?? "").replace(/\D/g, "");
  const rawEmail = String(req.query.email ?? "").trim().toLowerCase();
  if (!/^\d{11}$/.test(rawCpf) && !z.email().safeParse(rawEmail).success) {
    res.status(422).json({ error: "VALIDATION_FAILED", requestId: req.requestId });
    return;
  }
  try {
    const result = await dbPool.query<Record<string, any>>(
      [
        "SELECT p.id,p.user_id,p.full_name,p.cpf_normalized,p.email_normalized,u.status,",
        "       p.municipality_id,m.name AS municipality_name,m.state AS municipality_state,",
        "       COALESCE(array_agg(DISTINCT r.role_code) FILTER (",
        "         WHERE r.role_code IN ('consumer','producer')",
        "           AND r.revoked_at IS NULL",
        "           AND (r.expires_at IS NULL OR r.expires_at>now())",
        "       ),'{}') AS public_roles",
        "  FROM public.app_people p",
        "  JOIN public.app_users u ON u.id=p.user_id",
        "  LEFT JOIN public.app_municipalities m ON m.id=p.municipality_id",
        "  LEFT JOIN public.app_user_role_assignments r ON r.user_id=p.user_id",
        " WHERE p.archived_at IS NULL",
        "   AND (($1::text <> '' AND p.cpf_normalized=$1)",
        "     OR ($2::text <> '' AND p.email_normalized=$2))",
        " GROUP BY p.id,p.user_id,p.full_name,p.cpf_normalized,p.email_normalized,",
        "          u.status,p.municipality_id,m.name,m.state",
        " LIMIT 1",
      ].join(" "),
      [rawCpf, rawEmail],
    );
    const row = result.rows[0];
    if (!row) {
      res.status(200).json({ found: false, user: null });
      return;
    }
    res.status(200).json({
      found: true,
      user: {
        userId: row.user_id,
        personId: row.id,
        fullName: row.full_name,
        cpf: row.cpf_normalized,
        email: row.email_normalized,
        status: row.status,
        publicRoles: row.public_roles,
        municipalityId: row.municipality_id,
        municipalityName: row.municipality_name,
        municipalityState: row.municipality_state,
      },
    });
  } catch {
    res.status(503).json({ error: "UNAVAILABLE", requestId: req.requestId });
  }
});

/**
 * Imóveis do titular: alimenta o bloqueio personalizado de publicação do
 * produtor (item 5). O bloqueio só aceita imóveis do próprio titular.
 */
adminLocalityRouter.get(
  "/access-blocks/subject-properties",
  ...guard,
  async (req, res) => {
    if (!dbPool) {
      res.status(503).json({ error: "UNAVAILABLE", requestId: req.requestId });
      return;
    }
    const userId = z.uuid().safeParse(req.query.userId);
    if (!userId.success) {
      res.status(422).json({ error: "VALIDATION_FAILED", requestId: req.requestId });
      return;
    }
    try {
      const result = await dbPool.query<{
        id: string;
        property_name: string;
        status: string;
        municipality: string;
        state: string;
      }>(
        [
          "SELECT p.id,p.property_name,p.status,p.municipality,p.state",
          "  FROM public.app_properties p",
          "  JOIN public.app_producer_profiles pp ON pp.id=p.producer_id",
          "  JOIN public.app_people pe ON pe.id=pp.person_id",
          " WHERE pe.user_id=$1",
          "   AND p.status='verified'",
          "   AND EXISTS (",
          "     SELECT 1 FROM public.app_verification_requests vr",
          "      WHERE vr.property_id=p.id",
          "        AND vr.status='approved'",
          "        AND vr.superseded_at IS NULL",
          "   )",
          " ORDER BY p.updated_at DESC",
          " LIMIT 200",
        ].join(" "),
        [userId.data],
      );
      res.status(200).json({
        properties: result.rows.map((row) => ({
          id: row.id,
          name: row.property_name,
          status: row.status,
          municipality: row.municipality,
          state: row.state,
        })),
      });
    } catch {
      res.status(503).json({ error: "UNAVAILABLE", requestId: req.requestId });
    }
  },
);

adminLocalityRouter.post(
  "/access-blocks",
  originProtection,
  ...guard,
  requireRecentAuth,
  async (req: Request, res: Response) => {
    const parsed = CreatePartialBlockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: "VALIDATION_FAILED",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        requestId: req.requestId,
      });
      return;
    }
    try {
      const result = await AccessScopeService.createPartialBlock(
        parsed.data,
        { userId: req.adminActor!.userId, role: req.adminActor!.role },
        req.requestId,
        req.clientIpHash,
      );
      res.status(result.status === "created" ? 201 : 200).json(result);
    } catch (error) {
      fail(res, accessScopeFailure(error, req.requestId));
    }
  },
);

adminLocalityRouter.post(
  "/access-blocks/:blockId/revoke",
  ...guard,
  originProtection,
  requireRecentAuth,
  async (req: Request, res: Response) => {
    const parsed = RevokePartialBlockSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(422).json({
        error: "VALIDATION_FAILED",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        requestId: req.requestId,
      });
      return;
    }
    if (!z.uuid().safeParse(req.params.blockId).success) {
      res.status(422).json({ error: "VALIDATION_FAILED", requestId: req.requestId });
      return;
    }
    try {
      const result = await AccessScopeService.revokePartialBlock(
        req.params.blockId,
        parsed.data.reason ?? null,
        actor(req),
        req.requestId,
        req.clientIpHash,
        parsed.data.commandId,
      );
      res.status(result.status === "revoked" ? 200 : 404).json(result);
    } catch (error) {
      fail(res, accessScopeFailure(error, req.requestId));
    }
  },
);
;
