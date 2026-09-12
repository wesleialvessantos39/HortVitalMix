import {
  healthResponseSchema,
  publicConfigSchema,
  readinessResponseSchema,
  type HealthResponse,
  type PublicConfig,
  type ReadinessResponse,
} from '../../shared/contracts/foundation';

export class FoundationApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function getJson<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FoundationApiError('A API respondeu em formato inválido.', response.status);
  }

  if (!response.ok) {
    throw new FoundationApiError(
      typeof body === 'object' && body !== null && 'error' in body ? 'Serviço temporariamente indisponível.' : 'Falha ao acessar o serviço.',
      response.status,
    );
  }

  return parse(body);
}

export const foundationApi = {
  getConfig(): Promise<PublicConfig> {
    return getJson('/api/v1/config', (value) => publicConfigSchema.parse(value));
  },
  getHealth(): Promise<HealthResponse> {
    return getJson('/api/health', (value) => healthResponseSchema.parse(value));
  },
  getReadiness(): Promise<ReadinessResponse> {
    return getJson('/api/ready', (value) => readinessResponseSchema.parse(value));
  },
};
