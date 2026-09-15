import {Router, type Response} from 'express';
import {GlobalConfigPublicSchema} from '../../shared/contracts/foundation';
import {getRuntimeConfig} from '../config/runtime';
import {getDbPool} from '../db/pool';

export const foundationRouter = Router();

function requestId(res: Response): string {
  return String(res.locals.requestId);
}

foundationRouter.get('/health', (_req, res) => {
  const {APP_ENV} = getRuntimeConfig();
  return res.status(200).json({
    status: 'ok',
    time: new Date().toISOString(),
    environment: APP_ENV,
    requestId: requestId(res),
  });
});

foundationRouter.get('/ready', async (_req, res) => {
  const {APP_ENV} = getRuntimeConfig();

  try {
    const db = getDbPool();
    const schemaResult = await db.query<{schema_version: number}>(
      'SELECT COALESCE(MAX(version), 0)::int AS schema_version FROM app_schema_migrations',
    );
    const schemaVersion = schemaResult.rows[0]?.schema_version ?? 0;

    const releaseResult = await db.query<{schema_version: number; release_tag: string}>(
      `SELECT schema_version, release_tag
       FROM app_releases
       WHERE environment = $1 AND is_current = true
       ORDER BY deployed_at DESC
       LIMIT 1`,
      [APP_ENV],
    );

    if (!releaseResult.rowCount) {
      return res.status(503).json({
        status: 'degraded',
        databaseConnected: true,
        schemaVersion,
        releaseTag: '',
        reason: 'Release corrente não configurado',
        requestId: requestId(res),
      });
    }

    const release = releaseResult.rows[0];
    if (release.schema_version !== schemaVersion) {
      return res.status(503).json({
        status: 'degraded',
        databaseConnected: true,
        schemaVersion,
        releaseTag: release.release_tag,
        reason: 'Release corrente não corresponde ao schema aplicado',
        requestId: requestId(res),
      });
    }

    return res.status(200).json({
      status: 'ready',
      databaseConnected: true,
      schemaVersion,
      releaseTag: release.release_tag,
      requestId: requestId(res),
    });
  } catch {
    return res.status(503).json({
      status: 'unavailable',
      databaseConnected: false,
      schemaVersion: 0,
      releaseTag: '',
      reason: 'Falha de conexão com PostgreSQL Neon',
      requestId: requestId(res),
    });
  }
});

foundationRouter.get('/v1/config', async (_req, res) => {
  try {
    const result = await getDbPool().query(
      `SELECT
         platform_name AS "platformName",
         slogan,
         default_municipality AS "defaultMunicipality",
         default_state AS "defaultState",
         currency,
         timezone,
         support_email AS "supportEmail",
         support_phone AS "supportPhone",
         revision
       FROM app_global_config
       WHERE singleton_guard = true
       LIMIT 1`,
    );

    if (!result.rowCount) {
      return res.status(503).json({
        error: {
          code: 'CONFIG_UNAVAILABLE',
          message: 'Configuração global indisponível.',
          requestId: requestId(res),
        },
      });
    }

    const parsed = GlobalConfigPublicSchema.safeParse(result.rows[0]);
    if (!parsed.success) {
      return res.status(503).json({
        error: {
          code: 'CONFIG_INVALID',
          message: 'Configuração global inválida.',
          requestId: requestId(res),
        },
      });
    }

    return res.status(200).json(parsed.data);
  } catch {
    return res.status(503).json({
      error: {
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Não foi possível carregar a configuração.',
        requestId: requestId(res),
      },
    });
  }
});
