const patterns = [
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
  /Bearer\s+[^\s"']+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /sb_secret_[A-Za-z0-9_-]+/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
  /\+[1-9]\d{7,14}\b/g,
  /\b\d{11}\b/g,
];

export function scrub(value: string) {
  return patterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value);
}

type FailureInput = {
  category: string;
  requestId?: string;
  hostname?: string;
  detail?: string;
  route?: string;
  method?: string;
};

export function reportFailure(
  input: string | FailureInput,
  legacyRequestId?: string,
) {
  const data: FailureInput =
    typeof input === "string"
      ? { category: input, requestId: legacyRequestId }
      : input;

  console.error(
    JSON.stringify({
      severity: "error",
      category: scrub(data.category),
      requestId: data.requestId,
      ...(data.hostname ? { hostname: scrub(data.hostname) } : {}),
      ...(data.detail ? { detail: scrub(data.detail) } : {}),
      ...(data.route ? { route: scrub(data.route) } : {}),
      ...(data.method ? { method: scrub(data.method) } : {}),
    }),
  );
}

export function classifyDbError(err: unknown) {
  const code = (err as { code?: string })?.code;
  return code === "23505"
    ? "conflict"
    : code === "42P01"
      ? "db_migration_missing"
      : code === "42501"
        ? "authorization_denied"
        : "db_unavailable";
}
