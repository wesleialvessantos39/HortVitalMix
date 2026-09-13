import type {
  EnvironmentResponse,
  HealthResponse,
  ReadinessResponse,
} from '../../shared/contracts/foundation';
import type {
  AppEnvironment,
  DatabaseBindingStatus,
} from '../../shared/domain';
import type { DeploymentSource } from '../../shared/environment/policy';
import type {
  FoundationProbe,
  FoundationRepository,
} from '../repositories/postgresHealthRepository';

export interface FoundationServiceOptions {
  environment: AppEnvironment;
  deploymentSource: DeploymentSource;
  databaseConfigured: boolean;
  indexingAllowed: boolean;
  tlsRequired: boolean;
  secureCookies: boolean;
  testTokensEnabled: boolean;
  repository: FoundationRepository;
}

interface BindingInspection {
  probe: FoundationProbe;
  binding: DatabaseBindingStatus;
}

const unavailableProbe: FoundationProbe = {
  databaseAvailable: false,
  databaseEnvironment: null,
  releaseVersion: null,
};

export class FoundationService {
  public constructor(private readonly options: FoundationServiceOptions) {}

  public async health(requestId: string): Promise<HealthResponse> {
    const inspection = await this.inspectBinding();
    return {
      status: 'ok',
      service: 'hortivitalmix-api',
      presentation: 'available',
      environment: this.options.environment,
      database: inspection.binding === 'ready' ? 'ready' : 'unavailable',
      databaseBinding: inspection.binding,
      requestId,
    };
  }

  public async readiness(requestId: string): Promise<ReadinessResponse> {
    const inspection = await this.inspectBinding();
    const ready = inspection.binding === 'ready';
    return {
      status: ready ? 'ready' : 'unavailable',
      environment: this.options.environment,
      dependencies: {
        database: ready ? 'ready' : 'unavailable',
      },
      databaseBinding: inspection.binding,
      expectedDatabaseEnvironment: this.options.environment,
      actualDatabaseEnvironment: inspection.probe.databaseEnvironment,
      releaseVersion: inspection.probe.releaseVersion,
      requestId,
    };
  }

  public async environment(requestId: string): Promise<EnvironmentResponse> {
    const inspection = await this.inspectBinding();
    return {
      environment: this.options.environment,
      deploymentSource: this.options.deploymentSource,
      databaseConfigured: this.options.databaseConfigured,
      databaseBinding: inspection.binding,
      databaseEnvironment: inspection.probe.databaseEnvironment,
      releaseVersion: inspection.probe.releaseVersion,
      indexing: this.options.indexingAllowed ? 'index' : 'noindex',
      tlsRequired: this.options.tlsRequired,
      secureCookies: this.options.secureCookies,
      testTokensEnabled: this.options.testTokensEnabled,
      requestId,
    };
  }

  private async inspectBinding(): Promise<BindingInspection> {
    if (!this.options.databaseConfigured) {
      return { probe: unavailableProbe, binding: 'unavailable' };
    }

    let probe: FoundationProbe;
    try {
      probe = await this.options.repository.probe();
    } catch {
      return { probe: unavailableProbe, binding: 'unavailable' };
    }

    if (!probe.databaseAvailable) {
      return { probe, binding: 'unavailable' };
    }

    if (!probe.databaseEnvironment) {
      return { probe, binding: 'unbound' };
    }

    if (probe.databaseEnvironment !== this.options.environment) {
      return { probe, binding: 'mismatch' };
    }

    return { probe, binding: 'ready' };
  }
}
