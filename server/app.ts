import express, { type Express } from 'express';
import {
  anonymousPrincipalResolver,
  type PrincipalResolver,
} from './authorization/principal';
import { loadRuntimeConfig, type RuntimeConfig } from './config/runtime';
import { createDatabasePool, type DatabasePool } from './db/pool';
import { errorHandler, apiNotFoundHandler } from './middleware/errorHandler';
import { createEnvironmentSecurityMiddleware } from './middleware/environmentSecurity';
import { requestIdMiddleware } from './middleware/requestId';
import {
  PostgresGlobalConfigRepository,
  type GlobalConfigRepository,
} from './repositories/globalConfigRepository';
import {
  PostgresFoundationRepository,
  type FoundationRepository,
} from './repositories/postgresHealthRepository';
import { createFoundationRouter } from './routes/foundationRoutes';
import { FoundationService } from './services/foundationService';
import { GlobalConfigurationService } from './services/globalConfigurationService';

export interface CreateAppOptions {
  runtime?: RuntimeConfig;
  pool?: DatabasePool | null;
  repository?: FoundationRepository;
  configurationRepository?: GlobalConfigRepository;
  principalResolver?: PrincipalResolver;
}

export interface HortiVitalMixApp {
  app: Express;
  pool: DatabasePool | null;
  runtime: RuntimeConfig;
}

export function createApp(options: CreateAppOptions = {}): HortiVitalMixApp {
  const runtime = options.runtime ?? loadRuntimeConfig();
  const pool = options.pool === undefined ? createDatabasePool(runtime) : options.pool;
  const foundationRepository = options.repository ?? new PostgresFoundationRepository(pool);
  const configurationRepository =
    options.configurationRepository ?? new PostgresGlobalConfigRepository(pool);
  const principalResolver = options.principalResolver ?? anonymousPrincipalResolver;

  const foundationService = new FoundationService({
    environment: runtime.environment,
    deploymentSource: runtime.deploymentSource,
    databaseConfigured: Boolean(runtime.databaseUrl),
    indexingAllowed: runtime.indexingAllowed,
    tlsRequired: runtime.tlsRequired,
    secureCookies: runtime.secureCookies,
    testTokensEnabled: runtime.testTokensEnabled,
    repository: foundationRepository,
  });

  const configurationService = new GlobalConfigurationService({
    databaseConfigured: Boolean(runtime.databaseUrl),
    repository: configurationRepository,
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestIdMiddleware);
  app.use(createEnvironmentSecurityMiddleware(runtime));
  app.use(express.json({ limit: '256kb', strict: true }));
  app.use(
    '/api',
    createFoundationRouter(
      foundationService,
      configurationService,
      principalResolver,
    ),
  );
  app.use('/api', apiNotFoundHandler);
  app.use(errorHandler);

  return { app, pool, runtime };
}
