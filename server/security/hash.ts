import { createHash, createHmac } from "node:crypto";
import { runtime } from "../config/runtime.ts";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hmacSha256Hex(input: string, pepper?: string): string {
  const key = pepper ?? runtime.ipPepper ?? "";
  return key
    ? createHmac("sha256", key).update(input, "utf8").digest("hex")
    : sha256Hex(input);
}
