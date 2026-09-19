export type FailureCategory =
  | 'db_unavailable'
  | 'db_migration_missing'
  | 'auth_unavailable'
  | 'storage_unavailable'
  | 'external_timeout'
  | 'validation_error'
  | 'authorization_denied'
  | 'conflict'
  | 'unknown';

const SENSITIVE_PATTERNS: RegExp[] = [
  /postgres(ql)?:\/\/[^\s"]+/gi,
  /SUPABASE_SERVICE_ROLE_KEY[=:]\s*[^\s,}"]+/gi,
  /SUPABASE_DB_URL[=:]\s*[^\s,}"]+/gi,
  /SUPABASE_JWT_SECRET[=:]\s*[^\s,}"]+/gi,
  /Bearer\s+[A-Za-z0-9\-_\.]+/g,
  /\b[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}\b/g,
  /\b[0-9]{11}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b(?:\+55)?\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g,
];

export function scrub(message: string): string {
  let out = message;
  for (const pattern of SENSITIVE_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return out;
}

export interface FailureReport {
  category: FailureCategory;
  requestId?: string;
  hostname?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  detail?: string;
}

export function reportFailure(report: FailureReport): void {
  const payload: Record<string, unknown> = {
    severity: 'error',
    category: report.category,
    requestId: report.requestId ?? null,
  };

  if (report.category === 'db_unavailable' || report.category === 'external_timeout') {
    payload.hostname = report.hostname ?? null;
  }
  if (report.route) payload.route = report.route;
  if (report.method) payload.method = report.method;
  if (report.statusCode) payload.statusCode = report.statusCode;
  if (report.detail) payload.detail = scrub(report.detail);

  console.error('[FAILURE]', JSON.stringify(payload));
}

export function classifyDbError(err: unknown): FailureCategory {
  if (!err || typeof err !== 'object') return 'unknown';
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'db_unavailable';
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT') return 'db_unavailable';
  if (code === '42P01') return 'db_migration_missing';
  if (code === '28P01' || code === '28000') return 'db_unavailable';
  if (code === '23505') return 'conflict';
  if (code === '42501') return 'authorization_denied';
  return 'unknown';
}
