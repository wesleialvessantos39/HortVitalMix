export type FailureCategory = 'db_unavailable'|'db_migration_missing'|'auth_unavailable'|'storage_unavailable'|'validation_error'|'unexpected';
const secretPattern = /(postgres(?:ql)?:\/\/[^\s]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+|service_role)/gi;
export function scrub(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(secretPattern, '[REDACTED]');
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([k,v]) => [k, /password|secret|token|key|authorization/i.test(k) ? '[REDACTED]' : scrub(v)]));
  return value;
}
export function reportFailure(category: FailureCategory, requestId: string, error?: unknown, details?: Record<string, unknown>): void {
  console.error('[FAILURE]', scrub({category,requestId,error:error instanceof Error ? error.name : typeof error,details}));
}
