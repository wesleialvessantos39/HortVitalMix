import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";

type LiveSession =
  | { status: "active"; createdAt: string }
  | { status: "invalid" | "unavailable" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ler somente depois de Auth.getUser: decodificar uma claim não valida um JWT.
export function sessionIdFromVerifiedToken(token: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as { session_id?: unknown };
    return typeof payload.session_id === "string" &&
      uuid.test(payload.session_id)
      ? payload.session_id
      : null;
  } catch {
    return null;
  }
}

function resolveRow(row?: { created_at: string | Date }): LiveSession {
  if (!row) return { status: "invalid" };
  const issued = new Date(row.created_at).getTime();
  return Number.isFinite(issued) && issued <= Date.now() + 30_000
    ? { status: "active", createdAt: new Date(issued).toISOString() }
    : { status: "invalid" };
}

export async function resolveLiveAuthSession(
  userId: string,
  sessionId: string | null,
  useDatabase = true,
): Promise<LiveSession> {
  if (!uuid.test(userId) || !sessionId || !uuid.test(sessionId))
    return { status: "invalid" };
  if (useDatabase && dbPool) {
    try {
      const result = await dbPool.query<{ created_at: Date | string }>(
        `SELECT created_at FROM auth.sessions
          WHERE id=$1 AND user_id=$2
            AND (not_after IS NULL OR not_after>now())`,
        [sessionId, userId],
      );
      return resolveRow(result.rows[0]);
    } catch {
      // O fallback lê o mesmo estado canônico por RPC restrita ao backend.
    }
  }
  if (!supabaseAdmin) return { status: "unavailable" };
  try {
    const result = await supabaseAdmin.rpc("fn_live_auth_session", {
      p_user_id: userId,
      p_session_id: sessionId,
    });
    if (result.error || !Array.isArray(result.data))
      return { status: "unavailable" };
    return resolveRow(result.data[0]);
  } catch {
    return { status: "unavailable" };
  }
}
