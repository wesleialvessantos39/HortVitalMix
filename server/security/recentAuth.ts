import { timingSafeEqual } from "node:crypto";
import { runtime } from "../config/runtime.ts";
import { hmacSha256Hex } from "./hash.ts";

export const RECENT_AUTH_WINDOW_MS = 15 * 60 * 1000;

type RecentAuthPayload = {
  v: 1;
  uid: string;
  sid: string;
  iat: number;
};

function sessionIdFromAccessToken(token: string) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    ) as { session_id?: unknown };
    return typeof payload.session_id === "string" &&
      /^[0-9a-f-]{36}$/i.test(payload.session_id)
      ? payload.session_id
      : null;
  } catch {
    return null;
  }
}

function safeEqualHex(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right))
    return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function signature(payload: string, secret: string) {
  return hmacSha256Hex("hvm:recent-auth:v1:" + payload, secret);
}

export function issueRecentAuthProof(
  userId: string,
  accessToken: string,
  now = Date.now(),
  secret = runtime.ipPepper,
) {
  if (!secret) throw new Error("RECENT_AUTH_SECRET_UNAVAILABLE");
  const sessionId = sessionIdFromAccessToken(accessToken);
  if (!sessionId) throw new Error("RECENT_AUTH_SESSION_UNAVAILABLE");
  const payload: RecentAuthPayload = {
    v: 1,
    uid: userId,
    sid: sessionId,
    iat: now,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return encoded + "." + signature(encoded, secret);
}

export function verifyRecentAuthProof(
  proof: string | null | undefined,
  userId: string,
  accessToken: string,
  now = Date.now(),
  secret = runtime.ipPepper,
) {
  if (!proof || !secret) return false;
  const parts = proof.split(".");
  if (parts.length !== 2) return false;
  const [encoded, supplied] = parts;
  if (!safeEqualHex(supplied, signature(encoded, secret))) return false;
  const sessionId = sessionIdFromAccessToken(accessToken);
  if (!sessionId) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as RecentAuthPayload;
    return (
      payload.v === 1 &&
      payload.uid === userId &&
      payload.sid === sessionId &&
      Number.isFinite(payload.iat) &&
      payload.iat <= now + 30_000 &&
      now - payload.iat <= RECENT_AUTH_WINDOW_MS
    );
  } catch {
    return false;
  }
}
