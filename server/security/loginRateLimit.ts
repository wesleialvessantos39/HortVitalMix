import type { NextFunction, Request, Response } from "express";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type LoginRateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function consumeLoginAttempt(key: string, now = Date.now()): LoginRateLimitDecision {
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS } : current;
  if (bucket.count >= MAX_ATTEMPTS) {
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  return { allowed: true, remaining: Math.max(0, MAX_ATTEMPTS - bucket.count), retryAfterSeconds: 0 };
}

export function resetLoginRateLimit(key: string): void { buckets.delete(key); }
export function resetAllLoginRateLimitsForTests(): void { buckets.clear(); }

export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const decision = consumeLoginAttempt(req.clientIpHash || "unknown");
  res.setHeader("X-RateLimit-Limit", String(MAX_ATTEMPTS));
  res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
  if (!decision.allowed) {
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    res.status(429).json({ error: "TOO_MANY_ATTEMPTS", retryAfterSeconds: decision.retryAfterSeconds, requestId: res.locals.requestId });
    return;
  }
  next();
}
