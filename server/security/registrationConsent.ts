import { createHmac, timingSafeEqual } from "node:crypto";
import { runtime } from "../config/runtime.ts";

export const REGISTRATION_CONSENT_WINDOW_MS = 10 * 60_000;
type ConsentIdentity = { userId: string; email: string; policyVersion: string };
const signature = (value: string, key: string) =>
  createHmac("sha256", key)
    .update("hvm:registration-consent:v1:" + value)
    .digest("hex");

export function issueRegistrationConsentProof(
  identity: ConsentIdentity,
  now = Date.now(),
  key = runtime.serviceKey,
) {
  if (!key) throw Error("REGISTRATION_CONSENT_UNAVAILABLE");
  const value = Buffer.from(
    JSON.stringify({
      uid: identity.userId,
      email: identity.email.trim().toLowerCase(),
      policy: identity.policyVersion,
      iat: now,
      exp: now + REGISTRATION_CONSENT_WINDOW_MS,
    }),
    "utf8",
  ).toString("base64url");
  return value + "." + signature(value, key);
}

export function verifyRegistrationConsentProof(
  proof: string | undefined,
  identity: ConsentIdentity,
  now = Date.now(),
  key = runtime.serviceKey,
) {
  if (!key || !proof || proof.length > 2048) return false;
  const [value, mac, extra] = proof.split(".");
  if (extra || !/^[\w-]+$/.test(value) || !/^[a-f0-9]{64}$/.test(mac ?? ""))
    return false;
  if (
    !timingSafeEqual(
      Buffer.from(mac, "hex"),
      Buffer.from(signature(value, key), "hex"),
    )
  )
    return false;
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return (
      data.uid === identity.userId &&
      data.email === identity.email.trim().toLowerCase() &&
      data.policy === identity.policyVersion &&
      Number.isFinite(data.iat) &&
      Number.isFinite(data.exp) &&
      data.iat <= now + 30_000 &&
      data.exp === data.iat + REGISTRATION_CONSENT_WINDOW_MS &&
      data.exp > now
    );
  } catch {
    return false;
  }
}
