import type {
  EnvironmentResponse,
  HealthResponse,
  ReadinessResponse,
} from '../../shared/contracts/foundation';
import type { AppEnvironment } from '../config/runtime';
import type { FoundationRepository } from '../repositories/postgresHealthRepository';

export interface FoundationServiceOptions {
  environment: AppEnvironment;
  databaseConfigured: boolean;
  repository: FoundationRepository;
}

export class FoundationService {
  public constructor(private readonly options: FoundationServiceOptions) {}

  public async health(requestId: string): Promise<HealthResponse> {
    const ready = await this.options.repository.isAvailable();
    return {
      status: 'ok',
      service: 'hortivitalmix-api',
      presentation: 'available',
      database: ready ? 'ready' : 'unavailable',
      requestId,
    };
  }

  public async readiness(requestId: string): Promise<ReadinessResponse> {
    const ready = await this.options.repository.isAvailable();
    return {
      status: ready ? 'ready' : 'unavailable',
      dependencies: {
        database: ready ? 'ready' : 'unavailable',
      },
      requestId,
    };
  }

  public environment(requestId: string): EnvironmentResponse {
    return {
      environment: this.options.environment,
      databaseConfigured: this.options.databaseConfigured,
      requestId,
    };
  }
}
