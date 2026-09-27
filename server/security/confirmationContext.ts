import { createHmac, timingSafeEqual } from "node:crypto";
import { runtime } from "../config/runtime.ts";
export type ConfirmationContext = {
  uid: string;
  role: "consumer" | "producer";
  exp: number;
};
const sign = (value: string, key: string) =>
  createHmac("sha256", key)
    .update("hvm:confirmation:v1:" + value)
    .digest("hex");
export function issueConfirmationContext(
  uid: string,
  role: ConfirmationContext["role"],
  now = Date.now(),
  key = runtime.serviceKey,
) {
  if (!key) throw new Error("CONFIRMATION_UNAVAILABLE");
  const value = Buffer.from(
    JSON.stringify({ uid, role, exp: now + 24 * 60 * 60_000 }),
  ).toString("base64url");
  return value + "." + sign(value, key);
}
export function readConfirmationContext(
  token: string,
  now = Date.now(),
  key = runtime.serviceKey,
): ConfirmationContext | null {
  if (!key || token.length > 2048) return null;
  const [value, mac, extra] = token.split(".");
  if (extra || !value || !/^[a-f0-9]{64}$/.test(mac ?? "")) return null;
  if (
    !timingSafeEqual(
      Buffer.from(mac, "hex"),
      Buffer.from(sign(value, key), "hex"),
    )
  )
    return null;
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString());
    return /^[a-f0-9-]{36}$/i.test(data.uid) &&
      ["consumer", "producer"].includes(data.role) &&
      Number.isFinite(data.exp) &&
      data.exp > now
      ? data
      : null;
  } catch {
    return null;
  }
}
