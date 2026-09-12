import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { PublicConfigData } from '../../shared/contracts/configuration';
import type { DatabasePool } from '../db/pool';

interface GlobalConfigRow {
  id: string;
  revision: string;
  brand_name: string;
  brand_tagline: string;
  page_title: string;
  logo_alt_text: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  support_email: string | null;
  support_phone: string | null;
  support_whatsapp: string | null;
  region_country_code: string;
  region_state_code: string;
  region_city: string;
  default_locale: string;
  currency_code: string;
  timezone: string;
}

interface ExistingCommandRow {
  payload_hash: string | null;
}

export interface PersistedGlobalConfiguration {
  id: string;
  data: PublicConfigData;
}

export interface ConfigurationUpdateCommand {
  actorId: string;
  requestId: string;
  commandId: string;
  expectedRevision: number;
  payloadHash: string;
  changed: boolean;
  next: Omit<PublicConfigData, 'revision' | 'source'>;
  beforeAudit: Record<string, unknown>;
  afterAudit: Record<string, unknown>;
}

export type ConfigurationUpdateResult =
  | {
      kind: 'updated';
      record: PersistedGlobalConfiguration;
      idempotent: boolean;
      changed: boolean;
    }
  | { kind: 'revision_conflict'; currentRevision: number }
  | { kind: 'command_conflict' }
  | { kind: 'unavailable' };

export interface GlobalConfigRepository {
  getCurrent(): Promise<PersistedGlobalConfiguration | null>;
  update(command: ConfigurationUpdateCommand): Promise<ConfigurationUpdateResult>;
}

function mapRow(row: GlobalConfigRow): PersistedGlobalConfiguration {
  return {
    id: row.id,
    data: {
      revision: Number(row.revision),
      source: 'database',
      brand: {
        name: 'HortiVitalMix',
        tagline: row.brand_tagline,
        pageTitle: row.page_title,
        logoAltText: row.logo_alt_text,
        theme: {
          primary: row.primary_color,
          secondary: row.secondary_color,
          accent: row.accent_color,
        },
      },
      contacts: {
        email: row.support_email,
        phone: row.support_phone,
        whatsapp: row.support_whatsapp,
      },
      region: {
        countryCode: row.region_country_code,
        stateCode: row.region_state_code,
        city: row.region_city,
      },
      parameters: {
        locale: row.default_locale,
        currency: row.currency_code,
        timezone: row.timezone,
      },
    },
  };
}

const selectConfigSql = `
  SELECT
    id,
    revision::text,
    brand_name,
    brand_tagline,
    page_title,
    logo_alt_text,
    primary_color,
    secondary_color,
    accent_color,
    support_email,
    support_phone,
    support_whatsapp,
    region_country_code,
    region_state_code,
    region_city,
    default_locale,
    currency_code,
    timezone
  FROM app_global_config
  WHERE singleton_key = 'global'
`;

export class PostgresGlobalConfigRepository implements GlobalConfigRepository {
  public constructor(private readonly pool: DatabasePool | null) {}

  public async getCurrent(): Promise<PersistedGlobalConfiguration | null> {
    if (!this.pool) return null;
    const result = await this.pool.query<GlobalConfigRow>(selectConfigSql);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  public async update(command: ConfigurationUpdateCommand): Promise<ConfigurationUpdateResult> {
    if (!this.pool) return { kind: 'unavailable' };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [command.commandId]);

      const existingCommand = await client.query<ExistingCommandRow>(
        `SELECT metadata->>'payloadHash' AS payload_hash
         FROM app_audit_events
         WHERE command_id = $1
         LIMIT 1`,
        [command.commandId],
      );

      const existing = existingCommand.rows[0];
      if (existing) {
        if (existing.payload_hash !== command.payloadHash) {
          await client.query('ROLLBACK');
          return { kind: 'command_conflict' };
        }

        const current = await this.readCurrent(client);
        await client.query('COMMIT');
        return current
          ? { kind: 'updated', record: current, idempotent: true, changed: false }
          : { kind: 'unavailable' };
      }

      const locked = await client.query<GlobalConfigRow>(`${selectConfigSql} FOR UPDATE`);
      const currentRow = locked.rows[0];
      if (!currentRow) {
        await client.query('ROLLBACK');
        return { kind: 'unavailable' };
      }

      const currentRevision = Number(currentRow.revision);
      if (currentRevision !== command.expectedRevision) {
        await client.query('ROLLBACK');
        return { kind: 'revision_conflict', currentRevision };
      }

      if (!command.changed) {
        await client.query(
          `INSERT INTO app_audit_events(
             id, event_type, resource_type, resource_id, actor_id, request_id, command_id,
             before_data, after_data, metadata
           ) VALUES (
             $1, 'global_configuration.confirmed_noop', 'app_global_config', $2, $3, $4, $5,
             $6::jsonb, $7::jsonb, $8::jsonb
           )`,
          [
            randomUUID(),
            currentRow.id,
            command.actorId,
            command.requestId,
            command.commandId,
            JSON.stringify(command.beforeAudit),
            JSON.stringify(command.afterAudit),
            JSON.stringify({
              payloadHash: command.payloadHash,
              previousRevision: currentRevision,
              resultingRevision: currentRevision,
              changed: false,
            }),
          ],
        );
        await client.query('COMMIT');
        return {
          kind: 'updated',
          record: mapRow(currentRow),
          idempotent: false,
          changed: false,
        };
      }

      const nextRevision = currentRevision + 1;
      const next = command.next;
      const updated = await client.query<GlobalConfigRow>(
        `UPDATE app_global_config
         SET
           revision = $1,
           brand_tagline = $2,
           page_title = $3,
           logo_alt_text = $4,
           support_email = $5,
           support_phone = $6,
           support_whatsapp = $7,
           region_country_code = $8,
           region_state_code = $9,
           region_city = $10,
           default_locale = $11,
           currency_code = $12,
           timezone = $13,
           updated_at = now(),
           updated_by = $14
         WHERE id = $15
         RETURNING
           id,
           revision::text,
           brand_name,
           brand_tagline,
           page_title,
           logo_alt_text,
           primary_color,
           secondary_color,
           accent_color,
           support_email,
           support_phone,
           support_whatsapp,
           region_country_code,
           region_state_code,
           region_city,
           default_locale,
           currency_code,
           timezone`,
        [
          nextRevision,
          next.brand.tagline,
          next.brand.pageTitle,
          next.brand.logoAltText,
          next.contacts.email,
          next.contacts.phone,
          next.contacts.whatsapp,
          next.region.countryCode,
          next.region.stateCode,
          next.region.city,
          next.parameters.locale,
          next.parameters.currency,
          next.parameters.timezone,
          command.actorId,
          currentRow.id,
        ],
      );

      await client.query(
        `INSERT INTO app_audit_events(
           id, event_type, resource_type, resource_id, actor_id, request_id, command_id,
           before_data, after_data, metadata
         ) VALUES (
           $1, 'global_configuration.updated', 'app_global_config', $2, $3, $4, $5,
           $6::jsonb, $7::jsonb, $8::jsonb
         )`,
        [
          randomUUID(),
          currentRow.id,
          command.actorId,
          command.requestId,
          command.commandId,
          JSON.stringify(command.beforeAudit),
          JSON.stringify(command.afterAudit),
          JSON.stringify({
            payloadHash: command.payloadHash,
            previousRevision: currentRevision,
            resultingRevision: nextRevision,
            changed: true,
          }),
        ],
      );

      await client.query('COMMIT');
      const updatedRow = updated.rows[0];
      return updatedRow
        ? {
            kind: 'updated',
            record: mapRow(updatedRow),
            idempotent: false,
            changed: true,
          }
        : { kind: 'unavailable' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async readCurrent(client: PoolClient): Promise<PersistedGlobalConfiguration | null> {
    const result = await client.query<GlobalConfigRow>(selectConfigSql);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }
}
