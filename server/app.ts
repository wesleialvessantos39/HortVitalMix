import express, { type Express } from 'express';
import { loadRuntimeConfig, type RuntimeConfig } from './config/runtime';
import { createDatabasePool, type DatabasePool } from './db/pool';
import { errorHandler, apiNotFoundHandler } from './middleware/errorHandler';
import { requestIdMiddleware } from './middleware/requestId';
import { PostgresFoundationRepository, type FoundationRepository } from './repositories/postgresHealthRepository';
import { createFoundationRouter } from './routes/foundationRoutes';
import { FoundationService } from './services/foundationService';

export interface CreateAppOptions {
  runtime?: RuntimeConfig;
  pool?: DatabasePool | null;
  repository?: FoundationRepository;
}

export interface HortiVitalMixApp {
  app: Express;
  pool: DatabasePool | null;
  runtime: RuntimeConfig;
}

export function createApp(options: CreateAppOptions = {}): HortiVitalMixApp {
  const runtime = options.runtime ?? loadRuntimeConfig();
  const pool = options.pool === undefined ? createDatabasePool(runtime) : options.pool;
  const repository = options.repository ?? new PostgresFoundationRepository(pool);
  const service = new FoundationService({
    environment: runtime.environment,
    databaseConfigured: Boolean(runtime.databaseUrl),
    repository,
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: '256kb', strict: true }));
  app.use('/api', createFoundationRouter(service));
  app.use('/api', apiNotFoundHandler);
  app.use(errorHandler);

  return { app, pool, runtime };
}
