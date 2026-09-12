import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PLATFORM_PERMISSIONS } from '../../shared/authorization/permissions';
import type { PublicConfigData } from '../../shared/contracts/configuration';
import { createApp } from '../../server/app';
import type {
  ConfigurationUpdateCommand,
  ConfigurationUpdateResult,
  GlobalConfigRepository,
  PersistedGlobalConfiguration,
} from '../../server/repositories/globalConfigRepository';
import type { FoundationRepository } from '../../server/repositories/postgresHealthRepository';

const actorId = '72f4557c-b20c-4ed0-92fe-417829e03401';

function runtime() {
  return {
    environment: 'homologation' as const,
    appBaseUrl: 'https://homologation.example.test',
    apiPort: 3001,
    databaseUrl: 'postgresql://configured',
  };
}

function configuration(revision = 1): PublicConfigData {
  return {
    revision,
    source: 'database',
    brand: {
      name: 'HortiVitalMix',
      tagline: 'Do produtor local para a sua mesa',
      pageTitle: 'HortiVitalMix | Do produtor local para a sua mesa',
      logoAltText: 'HortiVitalMix - do produtor local para a sua mesa',
      theme: {
        primary: '#0F4D2F',
        secondary: '#78A936',
        accent: '#EF6500',
      },
    },
    contacts: { email: null, phone: null, whatsapp: null },
    region: { countryCode: 'BR', stateCode: 'RO', city: 'Ariquemes' },
    parameters: { locale: 'pt-BR', currency: 'BRL', timezone: 'America/Porto_Velho' },
  };
}

class MemoryConfigRepository implements GlobalConfigRepository {
  private record: PersistedGlobalConfiguration = {
    id: '11111111-1111-4111-8111-111111111111',
    data: configuration(),
  };

  private readonly commands = new Map<string, string>();

  public async getCurrent(): Promise<PersistedGlobalConfiguration> {
    return structuredClone(this.record);
  }

  public async update(command: ConfigurationUpdateCommand): Promise<ConfigurationUpdateResult> {
    const existing = this.commands.get(command.commandId);
    if (existing) {
      if (existing !== command.payloadHash) return { kind: 'command_conflict' };
      return {
        kind: 'updated',
        record: structuredClone(this.record),
        idempotent: true,
        changed: false,
      };
    }

    if (this.record.data.revision !== command.expectedRevision) {
      return { kind: 'revision_conflict', currentRevision: this.record.data.revision };
    }

    this.commands.set(command.commandId, command.payloadHash);

    if (!command.changed) {
      return {
        kind: 'updated',
        record: structuredClone(this.record),
        idempotent: false,
        changed: false,
      };
    }

    this.record = {
      id: this.record.id,
      data: {
        revision: this.record.data.revision + 1,
        source: 'database',
        ...command.next,
      },
    };
    return {
      kind: 'updated',
      record: structuredClone(this.record),
      idempotent: false,
      changed: true,
    };
  }
}

function makeApp(configRepository: GlobalConfigRepository, authorized = false) {
  const healthRepository: FoundationRepository = { isAvailable: async () => true };
  return createApp({
    runtime: runtime(),
    pool: null,
    repository: healthRepository,
    configurationRepository: configRepository,
    principalResolver: authorized
      ? () => ({
          actorId,
          permissions: new Set([PLATFORM_PERMISSIONS.configurationManage]),
        })
      : () => null,
  }).app;
}

describe('OE-001-002 configuration API', () => {
  it('keeps GET /api/v1/config public and free of private connection data', async () => {
    const app = makeApp(new MemoryConfigRepository());
    const response = await request(app).get('/api/v1/config');

    expect(response.status).toBe(200);
    expect(response.body.brand.name).toBe('HortiVitalMix');
    expect(response.body.contacts.email).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('DATABASE_URL');
    expect(JSON.stringify(response.body)).not.toContain('postgresql://');
  });

  it('returns 403 for a direct administrative write without permission', async () => {
    const app = makeApp(new MemoryConfigRepository());
    const response = await request(app)
      .patch('/api/v1/admin/configuration')
      .send({
        commandId: '9cc725bf-d4f2-46f4-94bd-51ae0fdcb658',
        expectedRevision: 1,
        changes: { region: { city: 'Cacaulândia' } },
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('prevents two administrators from overwriting the same revision', async () => {
    const repository = new MemoryConfigRepository();
    const app = makeApp(repository, true);

    const first = await request(app)
      .patch('/api/v1/admin/configuration')
      .send({
        commandId: 'f24bd3c3-cb92-4fcf-ac72-9afe2bf56b01',
        expectedRevision: 1,
        changes: { region: { city: 'Cacaulândia' } },
      });

    const second = await request(app)
      .patch('/api/v1/admin/configuration')
      .send({
        commandId: '61c70b71-6a77-423d-b3ea-b88fb5a51c1f',
        expectedRevision: 1,
        changes: { region: { city: 'Alto Paraíso' } },
      });

    expect(first.status).toBe(200);
    expect(first.body.config.revision).toBe(2);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFIG_REVISION_CONFLICT');
  });

  it('accepts a null contact and increments the revision only after confirmation', async () => {
    const repository = new MemoryConfigRepository();
    const app = makeApp(repository, true);

    const response = await request(app)
      .patch('/api/v1/admin/configuration')
      .send({
        commandId: '72d34f3e-f73c-40f9-83ba-cbffb2cd14ef',
        expectedRevision: 1,
        changes: { contacts: { email: null, phone: null, whatsapp: null } },
      });

    expect(response.status).toBe(200);
    expect(response.body.changed).toBe(false);
    expect(response.body.config.revision).toBe(1);
  });

  it('makes a repeated command idempotent without creating a second revision', async () => {
    const repository = new MemoryConfigRepository();
    const app = makeApp(repository, true);
    const payload = {
      commandId: '5519066b-281f-4b2a-9a38-47f7da8399dd',
      expectedRevision: 1,
      changes: { region: { city: 'Cacaulândia' } },
    };

    const first = await request(app).patch('/api/v1/admin/configuration').send(payload);
    const retry = await request(app).patch('/api/v1/admin/configuration').send(payload);

    expect(first.status).toBe(200);
    expect(first.body.changed).toBe(true);
    expect(first.body.config.revision).toBe(2);
    expect(retry.status).toBe(200);
    expect(retry.body.idempotent).toBe(true);
    expect(retry.body.changed).toBe(false);
    expect(retry.body.config.revision).toBe(2);
  });

  it('rejects commandId reuse with a different payload', async () => {
    const repository = new MemoryConfigRepository();
    const app = makeApp(repository, true);
    const commandId = '1ded0f69-a3bc-4f36-956d-ab65cd302a86';

    const first = await request(app)
      .patch('/api/v1/admin/configuration')
      .send({
        commandId,
        expectedRevision: 1,
        changes: { region: { city: 'Cacaulândia' } },
      });

    const conflictingReuse = await request(app)
      .patch('/api/v1/admin/configuration')
      .send({
        commandId,
        expectedRevision: 1,
        changes: { region: { city: 'Alto Paraíso' } },
      });

    expect(first.status).toBe(200);
    expect(conflictingReuse.status).toBe(409);
    expect(conflictingReuse.body.error.code).toBe('COMMAND_ID_REUSED');
  });

  it('rejects an invalid region without leaking it to the public configuration', async () => {
    const repository = new MemoryConfigRepository();
    const app = makeApp(repository, true);

    const invalid = await request(app)
      .patch('/api/v1/admin/configuration')
      .send({
        commandId: '4ae39b43-f857-48bd-9ad4-5893553cfc5f',
        expectedRevision: 1,
        changes: { region: { stateCode: 'RONDONIA' } },
      });

    const publicConfig = await request(app).get('/api/v1/config');

    expect(invalid.status).toBe(422);
    expect(publicConfig.status).toBe(200);
    expect(publicConfig.body.region.stateCode).toBe('RO');
  });
});
