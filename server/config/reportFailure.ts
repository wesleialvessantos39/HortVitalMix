const patterns = [
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
  /Bearer\s+[^\s"']+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /sb_secret_[A-Za-z0-9_-]+/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
  /\b\d{11}\b/g,
];
export function scrub(value: string) {
  return patterns.reduce((s, p) => s.replace(p, "[REDACTED]"), value);
}
export function reportFailure(category: string, requestId?: string) {
  console.error(
    JSON.stringify({ severity: "error", category: scrub(category), requestId }),
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
