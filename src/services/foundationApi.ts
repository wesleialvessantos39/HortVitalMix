import {
  healthResponseSchema,
  readinessResponseSchema,
  type HealthResponse,
  type ReadinessResponse,
} from '../../shared/contracts/foundation';
import {
  publicConfigSchema,
  updateGlobalConfigurationResponseSchema,
  type PublicConfig,
  type UpdateGlobalConfigurationInput,
  type UpdateGlobalConfigurationResponse,
} from '../../shared/contracts/configuration';

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export class FoundationApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new FoundationApiError('A API respondeu em formato inválido.', response.status, 'INVALID_RESPONSE');
  }
}

async function getJson<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  const body = await parseJson(response);

  if (!response.ok) {
    const apiError = body as ApiErrorBody;
    throw new FoundationApiError(
      apiError.error?.message ?? 'Falha ao acessar o serviço.',
      response.status,
      apiError.error?.code ?? 'API_ERROR',
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

  async updateConfiguration(
    input: UpdateGlobalConfigurationInput,
  ): Promise<UpdateGlobalConfigurationResponse> {
    const response = await fetch('/api/v1/admin/configuration', {
      method: 'PATCH',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    const body = await parseJson(response);

    if (!response.ok) {
      const apiError = body as ApiErrorBody;
      throw new FoundationApiError(
        apiError.error?.message ?? 'Não foi possível salvar a configuração.',
        response.status,
        apiError.error?.code ?? 'API_ERROR',
      );
    }

    return updateGlobalConfigurationResponseSchema.parse(body);
  },
};
