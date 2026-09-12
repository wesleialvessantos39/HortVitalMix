import { describe, expect, it } from 'vitest';
import { publicConfigSchema } from '../../shared/contracts/foundation';

describe('foundation public config contract', () => {
  it('rejects accidental credential fields at the public boundary', () => {
    const parsed = publicConfigSchema.parse({
      brand: { name: 'HortiVitalMix', tagline: 'Do produtor local para a sua mesa' },
      locale: 'pt-BR',
      market: { city: 'Ariquemes', state: 'RO' },
      presentationMode: true,
      requestId: '9e3d22d3-c00d-4f06-b5df-f96b76bb2330',
      databaseUrl: 'postgresql://should-not-be-present',
    });

    expect('databaseUrl' in parsed).toBe(false);
  });
});
