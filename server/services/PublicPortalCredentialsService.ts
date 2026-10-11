import { createHash, randomBytes } from "node:crypto";
import { dbPool } from "../db/pool.ts";
import {
  createSupabasePublicClient,
  supabaseAdmin,
} from "../supabase/client.ts";

export type PublicPortalRole = "consumer" | "producer";
export const isPublicPortalRole = (role: string): role is PublicPortalRole =>
  role === "consumer" || role === "producer";

export function authSessionId(token: string): string | null {
  try {
    const value = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    ).session_id;
    return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

async function call<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (supabaseAdmin) {
    const result = await supabaseAdmin.rpc(name, args);
    if (!result.error) return result.data as T;
    // No password or token is included in errors or logs.
    throw new Error("PUBLIC_PORTAL_CREDENTIALS_UNAVAILABLE");
  }
  if (!dbPool) throw new Error("PUBLIC_PORTAL_CREDENTIALS_UNAVAILABLE");
  const values = Object.values(args);
  const result = await dbPool.query(
    `SELECT public.${name}(${values.map((_, i) => "$" + (i + 1)).join(",")}) AS result`,
    values,
  );
  return result.rows[0].result as T;
}

/** Auth supplies transport/session tokens; only this portal's credential authorizes a login. */
export async function loginPublicPortal(
  email: string,
  role: PublicPortalRole,
  password: string,
) {
  const identity = await call<{
    userId: string;
    confirmed: boolean;
    authEmail: string;
  } | null>("fn_public_portal_login", {
    p_email: email,
    p_role: role,
    p_password: password,
  });
  if (!identity) return { error: "INVALID_CREDENTIALS" as const };
  if (!identity.confirmed)
    return { error: "EMAIL_CONFIRMATION_REQUIRED" as const };
  return {
    data: await createPublicPortalSession(
      identity.userId,
      identity.authEmail,
      role,
    ),
  };
}

export async function createPublicPortalSession(
  userId: string,
  authEmail: string,
  role: PublicPortalRole,
) {
  const client = createSupabasePublicClient();
  if (!supabaseAdmin || !client)
    throw new Error("PUBLIC_PORTAL_CREDENTIALS_UNAVAILABLE");
  // The caller must already have verified this portal's password or a scoped
  // one-use mailbox proof. generateLink never dispatches an e-mail.
  const generated = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: authEmail,
  });
  if (
    generated.error ||
    generated.data.user?.id !== userId ||
    !generated.data.properties?.hashed_token
  )
    throw new Error("PUBLIC_PORTAL_SESSION_UNAVAILABLE");
  const verified = await client.auth.verifyOtp({
    token_hash: generated.data.properties.hashed_token,
    type: "magiclink",
  });
  if (
    verified.error ||
    !verified.data.session ||
    verified.data.user?.id !== userId
  )
    throw new Error("PUBLIC_PORTAL_SESSION_UNAVAILABLE");
  try {
    await bindPublicPortalSession(
      userId,
      verified.data.session.access_token,
      role,
    );
    return verified.data.session;
  } catch (error) {
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    throw error;
  }
}

export async function resolvePortalEmailFlow(
  role: PublicPortalRole,
  purpose: "login" | "confirmation",
  token: string,
) {
  return call<{ userId: string; email: string } | null>(
    "fn_resolve_public_portal_email_flow",
    {
      p_role: role,
      p_purpose: purpose,
      p_digest: createHash("sha256").update(token).digest("hex"),
    },
  );
}

export async function bindPublicPortalSession(
  userId: string,
  token: string,
  role: PublicPortalRole,
) {
  const sessionId = authSessionId(token);
  if (
    !sessionId ||
    !(await call<boolean>("fn_bind_public_portal_session", {
      p_user: userId,
      p_session: sessionId,
      p_role: role,
    }))
  )
    throw new Error("PUBLIC_PORTAL_SESSION_UNAVAILABLE");
}

export async function publicSessionRole(
  userId: string,
  sessionId: string,
): Promise<PublicPortalRole | null> {
  return call<PublicPortalRole | null>("fn_public_portal_session_role", {
    p_user: userId,
    p_session: sessionId,
  });
}

export async function registerIndependentPublicRole(input: {
  userId: string;
  cpf: string;
  email: string;
  role: PublicPortalRole;
  fullName: string;
  phone: string;
  password: string;
}) {
  return call<boolean>("fn_register_independent_public_role", {
    p_user: input.userId,
    p_cpf: input.cpf,
    p_email: input.email,
    p_role: input.role,
    p_name: input.fullName,
    p_phone: input.phone,
    p_password: input.password,
  });
}

export async function resetPublicPortalPassword(
  userId: string,
  role: PublicPortalRole,
  password: string,
  flowToken: string,
) {
  return call<boolean>("fn_reset_public_portal_password", {
    p_user: userId,
    p_role: role,
    p_password: password,
    p_digest: createHash("sha256").update(flowToken).digest("hex"),
  });
}

export async function changePublicPortalPassword(
  userId: string,
  role: PublicPortalRole,
  password: string,
  challengeId: string,
) {
  return call<boolean>("fn_change_public_portal_password", {
    p_user: userId,
    p_role: role,
    p_password: password,
    p_challenge: challengeId,
  });
}

export async function portalConfirmationState(
  userId: string,
  role: PublicPortalRole,
) {
  return call<boolean>("fn_public_portal_confirmed", {
    p_user: userId,
    p_role: role,
  });
}

export async function issuePortalEmailFlow(
  userId: string,
  role: PublicPortalRole,
  purpose: "confirmation" | "login",
) {
  const token = randomBytes(32).toString("base64url");
  const issued = await call<boolean>("fn_issue_public_portal_email_flow", {
    p_user: userId,
    p_role: role,
    p_purpose: purpose,
    p_digest: createHash("sha256").update(token).digest("hex"),
  });
  if (!issued) throw new Error("PUBLIC_PORTAL_FLOW_UNAVAILABLE");
  return token;
}

export async function consumePortalEmailFlow(
  userId: string,
  role: PublicPortalRole,
  purpose: "confirmation" | "login",
  token: string,
) {
  return call<boolean>("fn_consume_public_portal_email_flow", {
    p_user: userId,
    p_role: role,
    p_purpose: purpose,
    p_digest: createHash("sha256").update(token).digest("hex"),
  });
}
