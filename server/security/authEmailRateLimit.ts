type AuthMailError = {
  status?: number;
  code?: string;
  message?: string;
};

export function authEmailRetryAfter(error: unknown): number | null {
  const candidate = error as AuthMailError | null;
  if (!candidate) return null;

  const rateLimited =
    candidate.status === 429 ||
    candidate.code === "over_email_send_rate_limit" ||
    /rate.?limit/i.test(candidate.code ?? "");

  if (!rateLimited) return null;

  const seconds =
    /after\s+(\d+)\s+seconds?/i.exec(candidate.message ?? "")?.[1];
  const parsed = Number(seconds ?? 60);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 60;
}
