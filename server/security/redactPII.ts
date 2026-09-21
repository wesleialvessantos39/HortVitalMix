const PII_KEY_PATTERNS = [
  /password/i,
  /senha/i,
  /token/i,
  /secret/i,
  /credential/i,
  /cpf/i,
  /cnpj/i,
  /phone/i,
  /telefone/i,
  /email/i,
  /ip_address/i,
  /authorization/i,
  /bearer/i,
  /session_id/i,
];

export function redactPII<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return redactString(input) as T;
  if (typeof input !== "object") return input;
  if (Array.isArray(input))
    return input.map((value) => redactPII(value)) as T;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = PII_KEY_PATTERNS.some((pattern) => pattern.test(key))
      ? "[REDACTED]"
      : redactPII(value);
  }
  return out as T;
}

function redactString(value: string): string {
  return value
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[CPF_REDACTED]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL_REDACTED]")
    .replace(/postgres(ql)?:\/\/[^\s]+/g, "[DB_URL_REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9\-_.]+/g, "Bearer [TOKEN_REDACTED]");
}
