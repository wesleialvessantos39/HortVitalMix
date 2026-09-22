import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

export function generateOtp(): string {
  const buf = randomBytes(4);
  const num = buf.readUInt32BE(0) % 1_000_000;
  return num.toString().padStart(6, "0");
}

export function generateOtpSalt(): string {
  return randomBytes(16).toString("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashOtp(otp: string, salt: string): string {
  return createHash("sha256").update(`${otp}:${salt}`, "utf8").digest("hex");
}

export function verifyOtpHash(
  providedOtp: string,
  salt: string,
  storedHash: string,
): boolean {
  const provided = hashOtp(providedOtp, salt);
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function digestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
