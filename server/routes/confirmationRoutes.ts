import { Router } from "express";
import { z } from "zod";
import {
  supabaseAdmin,
  createSupabasePublicClient,
} from "../supabase/client.ts";
import {
  readConfirmationContext,
  issueConfirmationContext,
} from "../security/confirmationContext.ts";
import { loginRateLimit } from "../security/loginRateLimit.ts";
import { safeRequestOrigin } from "../security/origin.ts";

export const confirmationRouter = Router();
const Input = z
  .object({
    context: z.string().max(2048).optional(),
    accessToken: z.string().max(8192).optional(),
    resend: z.boolean().optional(),
    portalRole: z.enum(["consumer", "producer"]).optional(),
  })
  .strict();
confirmationRouter.post("/confirmation", loginRateLimit, async (req, res) => {
  const input = Input.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "VALIDATION_ERROR" });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
    return;
  }
  try {
    const context = input.data.context
      ? readConfirmationContext(input.data.context)
      : null;
    const auth = context
      ? await supabaseAdmin.auth.admin.getUserById(context.uid)
      : input.data.accessToken
        ? await supabaseAdmin.auth.getUser(input.data.accessToken)
        : null;
    const user = auth?.data.user;
    if (auth?.error || !user) {
      if (auth?.error && (!auth.error.status || auth.error.status >= 500)) {
        res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" }); return;
      }
      res.status(401).json({ error: "CONFIRMATION_LINK_INVALID" });
      return;
    }
    const [person, roles] = await Promise.all([
      supabaseAdmin
        .from("app_people")
        .select("full_name,email_normalized")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabaseAdmin
        .from("app_user_role_assignments")
        .select("role_code,expires_at")
        .eq("user_id", user.id)
        .is("revoked_at", null)
        .in("role_code", ["consumer", "producer"]),
    ]);
    if (person.error || roles.error) {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }
    const active = (roles.data ?? []).filter(
      (r) => !r.expires_at || new Date(r.expires_at).getTime() > Date.now(),
    );
    const role = context?.role ?? input.data.portalRole ?? active[0]?.role_code;
    if (!person.data || !active.some((r) => r.role_code === role)) {
      res.status(403).json({ error: "ROLE_NOT_ALLOWED_FOR_PORTAL" });
      return;
    }
    if (user.email_confirmed_at) {
      // Link proof only; never create a login session or trust a name from the URL.
      res.json({
        status: "confirmed",
        fullName: person.data.full_name,
        email: person.data.email_normalized,
        role,
      });
      return;
    }
    if (!context) {
      res.status(401).json({ error: "CONFIRMATION_LINK_INVALID" });
      return;
    }
    if (input.data.resend) {
      const client = createSupabasePublicClient();
      const origin = safeRequestOrigin(req);
      if (!client || !origin) {
        res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
        return;
      }
      const fresh = issueConfirmationContext(user.id, context.role);
      const result = await client.auth.resend({
        type: "signup",
        email: user.email!,
        options: {
          emailRedirectTo:
            origin +
            "/confirmar-contato?portal=" +
            role +
            "&context=" +
            encodeURIComponent(fresh),
        },
      });
      if (result.error) {
        res
          .status(result.error.status === 429 ? 429 : 503)
          .json({ error: "CONFIRMATION_RESEND_UNAVAILABLE" });
        return;
      }
      res.status(202).json({ status: "sent", role });
      return;
    }
    res.json({ status: "pending", role });
  } catch {
    res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
  }
});
