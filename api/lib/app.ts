import {randomUUID, timingSafeEqual} from 'node:crypto';
import express, {type NextFunction, type Request, type Response} from 'express';
import {z} from 'zod';
import {getRuntimeConfig} from './config.ts';
import {getPool, withTransaction} from './db.ts';

const updateConfigSchema = z.object({
  expectedRevision: z.number().int().positive(),
  systemName: z.string().trim().min(2).max(80).optional(),
  slogan: z.string().trim().min(2).max(180).optional(),
  supportEmail: z.string().email().nullable().optional(),
  supportPhone: z.string().trim().max(30).nullable().optional(),
  defaultCity: z.string().trim().min(2).max(80).optional(),
  defaultState: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
});

function problem(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({error: {code, message, requestId: res.locals.requestId}});
}

function requireConfigPermission(req: Request, res: Response, next: NextFunction) {
  const expected = getRuntimeConfig().PLATFORM_CONFIG_ADMIN_TOKEN;
  const received = req.header('x-platform-admin-token');
  if (!expected || !received) return problem(res, 403, 'FORBIDDEN', 'Permissão platform.config.manage necessária.');
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return problem(res, 403, 'FORBIDDEN', 'Permissão platform.config.manage necessária.');
  }
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const incoming = req.header('x-request-id');
    const requestId = incoming && /^[a-zA-Z0-9._:-]{8,128}$/.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });
  app.use(express.json({limit: '256kb'}));

  app.get('/api/health', (_req, res) => res.status(200).json({status: 'ok', requestId: res.locals.requestId}));

  app.get('/api/ready', async (_req, res) => {
    try {
      const {APP_ENV, APP_RELEASE} = getRuntimeConfig();
      const result = await getPool().query<{version: number}>('SELECT COALESCE(MAX(version), 0)::int AS version FROM app_schema_migrations');
      if (result.rows[0]?.version !== 1) return problem(res, 503, 'SCHEMA_NOT_READY', 'Schema esperado não está aplicado.');
      return res.status(200).json({status: 'ready', environment: APP_ENV, release: APP_RELEASE, schemaVersion: 1, requestId: res.locals.requestId});
    } catch {
      return problem(res, 503, 'DEPENDENCY_UNAVAILABLE', 'Banco de dados indisponível.');
    }
  });

  app.get('/api/v1/config', async (_req, res) => {
    try {
      const result = await getPool().query('SELECT system_name AS "systemName", slogan, support_email AS "supportEmail", support_phone AS "supportPhone", default_city AS "defaultCity", default_state AS "defaultState", currency, timezone, revision FROM app_global_config WHERE singleton = true');
      if (!result.rowCount) return problem(res, 503, 'CONFIG_UNAVAILABLE', 'Configuração global indisponível.');
      return res.json({data: result.rows[0], requestId: res.locals.requestId});
    } catch {
      return problem(res, 503, 'DEPENDENCY_UNAVAILABLE', 'Não foi possível carregar a configuração.');
    }
  });

  app.patch('/api/v1/admin/configuration', requireConfigPermission, async (req, res) => {
    const parsed = updateConfigSchema.safeParse(req.body);
    if (!parsed.success) return problem(res, 422, 'VALIDATION_ERROR', 'Dados de configuração inválidos.');
    const {expectedRevision, ...changes} = parsed.data;
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
    if (!entries.length) return problem(res, 422, 'NO_CHANGES', 'Informe ao menos um campo para alteração.');
    const columnMap: Record<string, string> = {systemName: 'system_name', slogan: 'slogan', supportEmail: 'support_email', supportPhone: 'support_phone', defaultCity: 'default_city', defaultState: 'default_state'};
    try {
      const updated = await withTransaction(async (client) => {
        const assignments = entries.map(([key], index) => `${columnMap[key]} = $${index + 1}`);
        const values = entries.map(([, value]) => value);
        const result = await client.query(`UPDATE app_global_config SET ${assignments.join(', ')}, revision = revision + 1, updated_at = now() WHERE singleton = true AND revision = $${values.length + 1} RETURNING *`, [...values, expectedRevision]);
        if (!result.rowCount) return null;
        await client.query('INSERT INTO app_audit_events (request_id, actor_type, action_code, entity_type, entity_id, after_state, redacted_fields) VALUES ($1, $2, $3, $4, $5, $6, $7)', [res.locals.requestId, 'bootstrap_admin', 'platform.config.updated', 'app_global_config', result.rows[0].id, JSON.stringify({revision: result.rows[0].revision, changedFields: entries.map(([key]) => key)}), []]);
        return result.rows[0];
      });
      if (!updated) return problem(res, 409, 'REVISION_CONFLICT', 'A configuração foi alterada por outra operação. Recarregue e tente novamente.');
      return res.json({data: {revision: updated.revision}, requestId: res.locals.requestId});
    } catch {
      return problem(res, 503, 'DEPENDENCY_UNAVAILABLE', 'Não foi possível persistir a configuração.');
    }
  });

  app.use('/api', (_req, res) => problem(res, 404, 'NOT_FOUND', 'Rota não encontrada.'));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof SyntaxError) return problem(res, 400, 'INVALID_JSON', 'JSON inválido.');
    if (typeof error === 'object' && error && 'type' in error && error.type === 'entity.too.large') return problem(res, 413, 'PAYLOAD_TOO_LARGE', 'O corpo excede 256 KiB.');
    return problem(res, 500, 'INTERNAL_ERROR', 'Erro interno inesperado.');
  });
  return app;
}
