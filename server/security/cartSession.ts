import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { runtime } from "../config/runtime.ts";
import { CartSessionSchema } from "../../shared/contracts/cart.ts";
import { CartService } from "../services/CartService.ts";
import { reportFailure } from "../config/reportFailure.ts";

const options = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: runtime.secureCookies,
};
export function readCartSession(req: Request) {
  const parts =
    req.headers.cookie
      ?.split(";")
      .map((p) => p.trim())
      .filter((p) => p.startsWith("hvm_cart=")) ?? [];
  if (parts.length !== 1) return null;
  try {
    const result = CartSessionSchema.safeParse(
      decodeURIComponent(parts[0].slice(9)),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function cartSession(req: Request, res: Response, rotate = false) {
  const existing = rotate ? null : readCartSession(req);
  const id = existing ?? randomUUID();
  if (!existing)
    res.cookie("hvm_cart", id, { ...options, maxAge: 30 * 86400 * 1000 });
  return id;
}
export function clearCartSession(res: Response) {
  res.clearCookie("hvm_cart", options);
}
export async function mergeLoginCart(req: Request, userId: string) {
  const sessionId = readCartSession(req);
  if (!sessionId) return;
  try {
    await CartService.mergeCartOnLogin(sessionId, userId);
  } catch {
    // Preserve the guest cookie/items if the database is temporarily unavailable.
    // The next basket request retries the same atomic merge; login stays usable.
    reportFailure("cart_merge_deferred", req.requestId);
  }
}
