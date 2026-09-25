import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { originProtection } from "../security/originProtection.ts";
import {
  CreateAddressSchema,
  DeleteAddressSchema,
  ReauthenticateSchema,
  SetDefaultAddressSchema,
  UpdatePreferencesSchema,
  UpdateProfileSchema,
} from "../../shared/contracts/profilePrivacy.ts";
import {
  ProfilePrivacyError,
  ProfilePrivacyService,
} from "../services/ProfilePrivacyService.ts";
import {
  createSupabasePublicClient,
  supabaseAdmin,
} from "../supabase/client.ts";
import { runtime } from "../config/runtime.ts";
import {
  loginRateLimit,
  resetLoginRateLimit,
} from "../security/loginRateLimit.ts";
import {
  issueRecentAuthProof,
  RECENT_AUTH_WINDOW_MS,
  verifyRecentAuthProof,
} from "../security/recentAuth.ts";

export const profilePrivacyRouter = Router();

function currentActor(req: Request, res: Response) {
  if (!req.actor) {
    res
      .status(401)
      .json({ error: "AUTH_REQUIRED", requestId: req.requestId });
    return null;
  }
  const role =
    req.actor.roles.includes("producer")
      ? "producer"
      : req.actor.roles.includes("consumer")
        ? "consumer"
        : req.actor.roles[0] ?? "consumer";
  return { userId: req.actor.userId, email: req.actor.email, role };
}

function sendError(res: Response, error: unknown) {
  if (error instanceof ProfilePrivacyError) {
    res
      .status(error.status)
      .json({ error: error.code, requestId: res.locals.requestId });
    return;
  }
  res
    .status(503)
    .json({
      error: "DEPENDENCY_UNAVAILABLE",
      requestId: res.locals.requestId,
    });
}

function parseAddressId(req: Request, res: Response) {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "VALIDATION_ERROR", requestId: req.requestId });
    return null;
  }
  return parsed.data;
}

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

function requireRecentAuth(req: Request, res: Response, userId: string) {
  const accessToken = readAccessToken(req);
  const proof = readCookie(req, "hvm_reauth");
  if (
    !accessToken ||
    !verifyRecentAuthProof(proof, userId, accessToken)
  ) {
    res
      .status(401)
      .json({ error: "RECENT_AUTH_REQUIRED", requestId: req.requestId });
    return false;
  }
  return true;
}

profilePrivacyRouter.post(
  "/account/reauthenticate",
  loginRateLimit,
  originProtection,
  async (req: Request, res: Response) => {
    const actor = currentActor(req, res);
    if (!actor) return;
    const parsed = ReauthenticateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: parsed.error.issues,
        requestId: req.requestId,
      });
      return;
    }
    const accessToken = readAccessToken(req);
    if (!accessToken || !actor.email) {
      res.status(401).json({
        error: "RECENT_AUTH_REQUIRED",
        requestId: req.requestId,
      });
      return;
    }

    const client = createSupabasePublicClient();
    if (!client || !supabaseAdmin) {
      res.status(503).json({
        error: "DEPENDENCY_UNAVAILABLE",
        requestId: req.requestId,
      });
      return;
    }

    const verified = await client.auth.signInWithPassword({
      email: actor.email,
      password: parsed.data.password,
    });

    if (
      verified.error ||
      !verified.data.user ||
      verified.data.user.id !== actor.userId ||
      !verified.data.session
    ) {
      res.status(401).json({
        error: "INVALID_CREDENTIALS",
        requestId: req.requestId,
      });
      return;
    }

    try {
      const proof = issueRecentAuthProof(actor.userId, accessToken);
      res.cookie("hvm_reauth", proof, {
        path: "/",
        httpOnly: true,
        secure: runtime.secureCookies,
        sameSite: "strict",
        maxAge: RECENT_AUTH_WINDOW_MS,
      });
      resetLoginRateLimit(req.clientIpHash);
      res.status(200).json({
        status: "verified",
        expiresInSeconds: RECENT_AUTH_WINDOW_MS / 1000,
      });
    } finally {
      await supabaseAdmin.auth.admin
        .signOut(verified.data.session.access_token, "local")
        .catch(() => undefined);
    }
  },
);

profilePrivacyRouter.get(
  "/account/profile",
  async (req: Request, res: Response) => {
    const actor = currentActor(req, res);
    if (!actor) return;
    try {
      if (req.query.export === "1") {
        if (!requireRecentAuth(req, res, actor.userId)) return;
        res
          .status(200)
          .json(await ProfilePrivacyService.exportData(actor.userId));
        return;
      }
      res
        .status(200)
        .json(await ProfilePrivacyService.getProfile(actor.userId));
    } catch (error) {
      sendError(res, error);
    }
  },
);

profilePrivacyRouter.patch(
  "/account/profile",
  originProtection,
  async (req: Request, res: Response) => {
    const actor = currentActor(req, res);
    if (!actor) return;
    const parsed = UpdateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: parsed.error.issues,
        requestId: req.requestId,
      });
      return;
    }
    try {
      const result = await ProfilePrivacyService.updateProfile(
        actor.userId,
        actor.role,
        parsed.data,
        req.requestId,
        req.clientIpHash,
      );
      res.status(result.status === "conflict" ? 409 : 200).json(result);
    } catch (error) {
      sendError(res, error);
    }
  },
);

profilePrivacyRouter.get(
  "/account/addresses",
  async (req: Request, res: Response) => {
    const actor = currentActor(req, res);
    if (!actor) return;
    try {
      res.status(200).json({
        addresses: await ProfilePrivacyService.listAddresses(actor.userId),
      });
    } catch (error) {
      sendError(res, error);
    }
  },
);

profilePrivacyRouter.post(
  "/account/addresses",
  originProtection,
  async (req: Request, res: Response) => {
    const actor = currentActor(req, res);
    if (!actor) return;
    const parsed = CreateAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: parsed.error.issues,
        requestId: req.requestId,
      });
      return;
    }
    try {
      const address = await ProfilePrivacyService.createAddress(
        actor.userId,
        actor.role,
        parsed.data,
        req.requestId,
        req.clientIpHash,
      );
      res.status(201).json({ address });
    } catch (error) {
      sendError(res, error);
    }
  },
);

profilePrivacyRouter.patch(
  "/account/addresses/:id/default",
  originProtection,
  async (req: Request, res: Response) => {
    const actor = currentActor(req, res);
    const addressId = parseAddressId(req, res);
    if (!actor || !addressId) return;
    const parsed = SetDefaultAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "VALIDATION_ERROR", requestId: req.requestId });
      return;
    }
    try {
      res.status(200).json(
        await ProfilePrivacyService.setDefaultAddress(
          actor.userId,
          actor.role,
          addressId,
          parsed.data.commandId,
          req.requestId,
          req.clientIpHash,
        ),
      );
    } catch (error) {
      sendError(res, error);
    }
  },
);

profilePrivacyRouter.delete(
  "/account/addresses/:id",
  originProtection,
  async (req: Request, res: Response) => {
    const actor = currentActor(req, res);
    const addressId = parseAddressId(req, res);
    if (!actor || !addressId) return;
    const parsed = DeleteAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "VALIDATION_ERROR", requestId: req.requestId });
      return;
    }
    try {
      res.status(200).json(
        await ProfilePrivacyService.deleteAddress(
          actor.userId,
          actor.role,
          addressId,
          parsed.data.commandId,
          req.requestId,
          req.clientIpHash,
        ),
      );
    } catch (error) {
      sendError(res, error);
    }
  },
);

profilePrivacyRouter.get(
  "/account/preferences",
  async (req: Request, res: Response) => {
    const actor = currentActor(req, res);
    if (!actor) return;
    try {
      res
        .status(200)
        .json(await ProfilePrivacyService.getPreferences(actor.userId));
    } catch (error) {
      sendError(res, error);
    }
  },
);

profilePrivacyRouter.patch(
  "/account/preferences",
  originProtection,
  async (req: Request, res: Response) => {
    const actor = currentActor(req, res);
    if (!actor) return;
    const parsed = UpdatePreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: parsed.error.issues,
        requestId: req.requestId,
      });
      return;
    }
    try {
      const result = await ProfilePrivacyService.updatePreferences(
        actor.userId,
        actor.role,
        parsed.data,
        req.requestId,
        req.clientIpHash,
        String(req.headers["user-agent"] ?? "unknown"),
      );
      res.status(result.status === "conflict" ? 409 : 200).json(result);
    } catch (error) {
      sendError(res, error);
    }
  },
);
