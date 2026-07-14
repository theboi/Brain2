import type { RuntimeModelProvider } from '@/lib/types';

export interface ModelFormValues {
  provider: RuntimeModelProvider;
  name: string;
  model: string;
  endpoint: string;
  key: string;
  concurrency: string;
}

export type ModelFormField = 'name' | 'model' | 'endpoint' | 'key' | 'concurrency';
export type ModelFormErrors = Partial<Record<ModelFormField, string>>;

type ModelCreateCommon = {
  name: string;
  model: string;
  max_concurrency: number;
};

export type ModelCreatePayload = ModelCreateCommon & (
  | { provider: 'ollama'; ollama_base_url: string; api_key?: never }
  | {
      provider: Exclude<RuntimeModelProvider, 'ollama'>;
      api_key: string;
      ollama_base_url?: never;
    }
);

export type ModelUpdatePayload = {
  model_id: string;
  name: string;
  model: string;
  max_concurrency: number;
  ollama_base_url?: string;
  api_key?: string;
};

export class ModelFormValidationError extends Error {
  readonly errors: ModelFormErrors;

  constructor(errors: ModelFormErrors) {
    super(Object.values(errors)[0] ?? 'Model registration is invalid.');
    this.name = 'ModelFormValidationError';
    this.errors = errors;
  }
}

export function modelCreatePayload(values: ModelFormValues): ModelCreatePayload {
  const common = validateCommon(values, true);

  if (values.provider === 'ollama') {
    return {
      provider: values.provider,
      ...common,
      ollama_base_url: validatedEndpoint(values.endpoint),
    };
  }

  const key = values.key.trim();
  if (!key) {
    throw new ModelFormValidationError({
      key: `API key is required for ${providerLabel(values.provider)}.`,
    });
  }
  return { provider: values.provider, ...common, api_key: key };
}

export function modelUpdatePayload(
  modelId: string,
  values: ModelFormValues,
): ModelUpdatePayload {
  const common = validateCommon(values, false);
  if (values.provider === 'ollama') {
    return {
      model_id: modelId,
      ...common,
      ollama_base_url: validatedEndpoint(values.endpoint),
    };
  }
  const key = values.key.trim();
  return {
    model_id: modelId,
    ...common,
    ...(key ? { api_key: key } : {}),
  };
}

function validateCommon(values: ModelFormValues, requireCloudKey: boolean) {
  const name = values.name.trim();
  const model = values.model.trim();
  const errors: ModelFormErrors = {};
  if (!name) errors.name = 'Display name is required.';
  if (!model) errors.model = 'Provider model ID is required.';

  const rawConcurrency = values.concurrency.trim();
  const maxConcurrency = rawConcurrency === '' ? 1 : Number(rawConcurrency);
  if (!/^\d+$/.test(rawConcurrency || '1') || !Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
    errors.concurrency = 'Concurrency must be a positive integer.';
  }

  if (values.provider === 'ollama') {
    Object.assign(errors, endpointErrors(values.endpoint));
  } else if (requireCloudKey && !values.key.trim()) {
    errors.key = `API key is required for ${providerLabel(values.provider)}.`;
  }

  if (Object.keys(errors).length > 0) throw new ModelFormValidationError(errors);
  return { name, model, max_concurrency: maxConcurrency };
}

function validatedEndpoint(value: string): string {
  const errors = endpointErrors(value);
  if (errors.endpoint) throw new ModelFormValidationError(errors);
  return value.trim().replace(/\/+$/, '');
}

function endpointErrors(value: string): ModelFormErrors {
  const endpoint = value.trim().replace(/\/+$/, '');
  if (!endpoint) return { endpoint: 'Local endpoint is required for Ollama.' };
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { endpoint: 'Local endpoint must be a valid HTTP or HTTPS URL.' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    return { endpoint: 'Local endpoint must be a valid HTTP or HTTPS URL.' };
  }
  if (parsed.username || parsed.password) {
    return { endpoint: 'Local endpoint must not include credentials.' };
  }
  return {};
}

function providerLabel(provider: Exclude<RuntimeModelProvider, 'ollama'>): string {
  return provider === 'anthropic' ? 'Anthropic' : 'OpenRouter';
}
