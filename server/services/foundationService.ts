import {
  EXPECTED_RELEASE_VERSION,
  EXPECTED_SCHEMA_VERSION,
} from '../../shared/database/migrationManifest';
import type {
  EnvironmentResponse,
  HealthResponse,
  ReadinessResponse,
} from '../../shared/contracts/foundation';
import type { AppEnvironment, DatabaseBindingStatus } from '../../shared/domain';
import type { DeploymentSource } from '../../shared/environment/policy';
import type { FoundationProbe, FoundationRepository } from '../repositories/postgresHealthRepository';

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
  ready: boolean;
}

const unavailableProbe: FoundationProbe = {
  databaseAvailable: false,
  databaseEnvironment: null,
  releaseVersion: null,
  schemaVersion: null,
  migrationIntegrity: 'unavailable',
  releaseHistoryHashMatches: false,
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
      database: inspection.ready ? 'ready' : 'unavailable',
      databaseBinding: inspection.binding,
      migrationIntegrity: inspection.probe.migrationIntegrity,
      requestId,
    };
  }

  public async readiness(requestId: string): Promise<ReadinessResponse> {
    const inspection = await this.inspectBinding();
    return {
      status: inspection.ready ? 'ready' : 'unavailable',
      environment: this.options.environment,
      dependencies: { database: inspection.ready ? 'ready' : 'unavailable' },
      databaseBinding: inspection.binding,
      migrationIntegrity: inspection.probe.migrationIntegrity,
      expectedDatabaseEnvironment: this.options.environment,
      actualDatabaseEnvironment: inspection.probe.databaseEnvironment,
      expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
      actualSchemaVersion: inspection.probe.schemaVersion,
      expectedReleaseVersion: EXPECTED_RELEASE_VERSION,
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
      migrationIntegrity: inspection.probe.migrationIntegrity,
      expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
      schemaVersion: inspection.probe.schemaVersion,
      expectedReleaseVersion: EXPECTED_RELEASE_VERSION,
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
      return { probe: unavailableProbe, binding: 'unavailable', ready: false };
    }
    let probe: FoundationProbe;
    try {
      probe = await this.options.repository.probe();
    } catch {
      return { probe: unavailableProbe, binding: 'unavailable', ready: false };
    }
    if (!probe.databaseAvailable) return { probe, binding: 'unavailable', ready: false };
    if (!probe.databaseEnvironment) return { probe, binding: 'unbound', ready: false };
    if (probe.databaseEnvironment !== this.options.environment) return { probe, binding: 'mismatch', ready: false };

    const ready =
      probe.migrationIntegrity === 'valid'
      && probe.schemaVersion === EXPECTED_SCHEMA_VERSION
      && probe.releaseVersion === EXPECTED_RELEASE_VERSION
      && probe.releaseHistoryHashMatches;
    return { probe, binding: 'ready', ready };
  }
}
