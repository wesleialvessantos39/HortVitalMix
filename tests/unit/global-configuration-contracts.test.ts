import { describe, expect, it } from 'vitest';
import {
  publicConfigDataSchema,
  updateGlobalConfigurationSchema,
} from '../../shared/contracts/configuration';
import { DEFAULT_GLOBAL_CONFIGURATION } from '../../shared/config/defaultConfiguration';

describe('OE-001-002 configuration contracts', () => {
  it('keeps the default configuration valid and revisioned', () => {
    const parsed = publicConfigDataSchema.parse(DEFAULT_GLOBAL_CONFIGURATION);
    expect(parsed.revision).toBe(0);
    expect(parsed.brand.name).toBe('HortiVitalMix');
    expect(parsed.region.city).toBe('Ariquemes');
    expect(parsed.parameters.currency).toBe('BRL');
  });

  it('accepts nullable public contacts', () => {
    const parsed = publicConfigDataSchema.parse(DEFAULT_GLOBAL_CONFIGURATION);
    expect(parsed.contacts).toEqual({ email: null, phone: null, whatsapp: null });
  });

  it('rejects an invalid region before it reaches persistence', () => {
    const result = updateGlobalConfigurationSchema.safeParse({
      commandId: '7ef8abbb-f5a5-48a8-8b21-c8bdf011c10d',
      expectedRevision: 1,
      changes: { region: { stateCode: 'RONDONIA' } },
    });
    expect(result.success).toBe(false);
  });

  it('does not expose brand name or theme as editable fields', () => {
    const result = updateGlobalConfigurationSchema.safeParse({
      commandId: '7ef8abbb-f5a5-48a8-8b21-c8bdf011c10d',
      expectedRevision: 1,
      changes: {
        brand: {
          name: 'Outra Marca',
          theme: { primary: '#000000' },
        },
      },
    });
    expect(result.success).toBe(false);
  });
});
