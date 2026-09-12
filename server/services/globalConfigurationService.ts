import { createHash } from 'node:crypto';
import { PLATFORM_PERMISSIONS } from '../../shared/authorization/permissions';
import { DEFAULT_GLOBAL_CONFIGURATION } from '../../shared/config/defaultConfiguration';
import {
  publicConfigDataSchema,
  type PublicConfig,
  type PublicConfigData,
  type UpdateGlobalConfigurationInput,
  type UpdateGlobalConfigurationResponse,
} from '../../shared/contracts/configuration';
import type { AuthorizationPrincipal } from '../authorization/principal';
import { ApplicationError } from '../errors/applicationError';
import type {
  GlobalConfigRepository,
  PersistedGlobalConfiguration,
} from '../repositories/globalConfigRepository';

export interface GlobalConfigurationServiceOptions {
  databaseConfigured: boolean;
  repository: GlobalConfigRepository;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function hashPayload(input: UpdateGlobalConfigurationInput): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(input)))
    .digest('hex');
}

function mergeConfiguration(
  current: PublicConfigData,
  input: UpdateGlobalConfigurationInput,
): PublicConfigData {
  const candidate: PublicConfigData = {
    ...current,
    brand: {
      ...current.brand,
      ...input.changes.brand,
      name: 'HortiVitalMix',
      theme: current.brand.theme,
    },
    contacts: {
      ...current.contacts,
      ...input.changes.contacts,
    },
    region: {
      ...current.region,
      ...input.changes.region,
    },
    parameters: {
      ...current.parameters,
      ...input.changes.parameters,
    },
  };

  return publicConfigDataSchema.parse(candidate);
}

function buildAuditDiff(
  current: PublicConfigData,
  next: PublicConfigData,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before: Record<string, unknown> = { revision: current.revision };
  const after: Record<string, unknown> = { revision: current.revision + 1 };

  const sections = ['brand', 'contacts', 'region', 'parameters'] as const;
  for (const section of sections) {
    const beforeSection: Record<string, unknown> = {};
    const afterSection: Record<string, unknown> = {};

    for (const [key, nextValue] of Object.entries(next[section])) {
      if (key === 'theme' || key === 'name') continue;
      const currentSection = current[section] as unknown as Record<string, unknown>;
      const currentValue = currentSection[key];
      if (JSON.stringify(currentValue) !== JSON.stringify(nextValue)) {
        beforeSection[key] = currentValue;
        afterSection[key] = nextValue;
      }
    }

    if (Object.keys(afterSection).length > 0) {
      before[section] = beforeSection;
      after[section] = afterSection;
    }
  }

  return { before, after };
}

function hasEffectiveChange(audit: { after: Record<string, unknown> }): boolean {
  return Object.keys(audit.after).some((key) => key !== 'revision');
}

export class GlobalConfigurationService {
  public constructor(private readonly options: GlobalConfigurationServiceOptions) {}

  public async getPublicConfiguration(requestId: string): Promise<PublicConfig> {
    if (!this.options.databaseConfigured) {
      return { ...DEFAULT_GLOBAL_CONFIGURATION, requestId };
    }

    const persisted = await this.options.repository.getCurrent();
    if (!persisted) {
      throw new ApplicationError(
        503,
        'CONFIGURATION_UNAVAILABLE',
        'A configuração global está temporariamente indisponível.',
      );
    }

    const validated = this.validatePersisted(persisted);
    return { ...validated, requestId };
  }

  public async updateConfiguration(
    input: UpdateGlobalConfigurationInput,
    principal: AuthorizationPrincipal,
    requestId: string,
  ): Promise<UpdateGlobalConfigurationResponse> {
    if (!principal.permissions.has(PLATFORM_PERMISSIONS.configurationManage)) {
      throw new ApplicationError(403, 'FORBIDDEN', 'Você não possui permissão para esta operação.');
    }

    if (!this.options.databaseConfigured) {
      throw new ApplicationError(
        503,
        'CONFIGURATION_UNAVAILABLE',
        'A configuração global está temporariamente indisponível.',
      );
    }

    const currentPersisted = await this.options.repository.getCurrent();
    if (!currentPersisted) {
      throw new ApplicationError(
        503,
        'CONFIGURATION_UNAVAILABLE',
        'A configuração global está temporariamente indisponível.',
      );
    }

    const current = this.validatePersisted(currentPersisted);

    let next: PublicConfigData;
    try {
      next = mergeConfiguration(current, input);
    } catch {
      throw new ApplicationError(
        422,
        'INVALID_CONFIGURATION',
        'A configuração informada é inválida.',
      );
    }

    const audit = buildAuditDiff(current, next);
    const effectiveChange = hasEffectiveChange(audit);
    if (!effectiveChange) {
      audit.after.revision = current.revision;
    }

    const result = await this.options.repository.update({
      actorId: principal.actorId,
      requestId,
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
      payloadHash: hashPayload(input),
      changed: effectiveChange,
      next: {
        brand: next.brand,
        contacts: next.contacts,
        region: next.region,
        parameters: next.parameters,
      },
      beforeAudit: audit.before,
      afterAudit: audit.after,
    });

    if (result.kind === 'unavailable') {
      throw new ApplicationError(
        503,
        'CONFIGURATION_UNAVAILABLE',
        'A configuração global está temporariamente indisponível.',
      );
    }

    if (result.kind === 'revision_conflict') {
      throw new ApplicationError(
        409,
        'CONFIG_REVISION_CONFLICT',
        'A configuração foi alterada por outra sessão. Atualize os dados e tente novamente.',
      );
    }

    if (result.kind === 'command_conflict') {
      throw new ApplicationError(
        409,
        'COMMAND_ID_REUSED',
        'A mesma identificação de comando não pode ser reutilizada com dados diferentes.',
      );
    }

    const validated = this.validatePersisted(result.record);
    return {
      status: 'confirmed',
      config: { ...validated, requestId },
      changed: result.changed,
      idempotent: result.idempotent,
      requestId,
    };
  }

  private validatePersisted(record: PersistedGlobalConfiguration): PublicConfigData {
    const parsed = publicConfigDataSchema.safeParse(record.data);
    if (!parsed.success) {
      throw new ApplicationError(
        503,
        'CONFIGURATION_INVALID',
        'A configuração global está temporariamente indisponível.',
      );
    }
    return parsed.data;
  }
}
