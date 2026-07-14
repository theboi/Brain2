import { describe, expect, it } from 'vitest';
import {
  ModelFormValidationError,
  modelCreatePayload,
  modelUpdatePayload,
} from './modelsLogic';

describe('modelCreatePayload', () => {
  it('builds an exact trimmed local registration without an api key', () => {
    expect(modelCreatePayload({
      provider: 'ollama',
      name: '  Local Qwen  ',
      model: ' qwen2.5:9b ',
      endpoint: ' http://127.0.0.1:11434/ ',
      key: ' must-not-leak ',
      concurrency: '2',
    })).toEqual({
      provider: 'ollama',
      name: 'Local Qwen',
      model: 'qwen2.5:9b',
      ollama_base_url: 'http://127.0.0.1:11434',
      max_concurrency: 2,
    });
  });

  it('builds an exact cloud registration without an endpoint', () => {
    expect(modelCreatePayload({
      provider: 'openrouter',
      name: ' Router ',
      model: ' anthropic/claude-sonnet-4.5 ',
      endpoint: 'http://ignored.example',
      key: ' secret-value ',
      concurrency: '3',
    })).toEqual({
      provider: 'openrouter',
      name: 'Router',
      model: 'anthropic/claude-sonnet-4.5',
      api_key: 'secret-value',
      max_concurrency: 3,
    });
  });

  it('defaults blank concurrency to one', () => {
    expect(modelCreatePayload({
      provider: 'anthropic',
      name: 'Claude',
      model: 'claude-sonnet-4-5',
      endpoint: '',
      key: 'secret-value',
      concurrency: '',
    }).max_concurrency).toBe(1);
  });

  it.each([
    ['0', 'Concurrency must be a positive integer.'],
    ['-1', 'Concurrency must be a positive integer.'],
    ['1.5', 'Concurrency must be a positive integer.'],
    ['two', 'Concurrency must be a positive integer.'],
  ])('rejects invalid concurrency %s at the concurrency field', (concurrency, message) => {
    expectValidation(
      () => modelCreatePayload({
        provider: 'ollama', name: 'Local', model: 'qwen',
        endpoint: 'http://localhost:11434', key: '', concurrency,
      }),
      { concurrency: message },
    );
  });

  it.each([
    ['', 'Local endpoint is required for Ollama.'],
    ['localhost:11434', 'Local endpoint must be a valid HTTP or HTTPS URL.'],
    ['file:///tmp/ollama.sock', 'Local endpoint must be a valid HTTP or HTTPS URL.'],
    ['http://user:password@localhost:11434', 'Local endpoint must not include credentials.'],
  ])('rejects unsafe local endpoint %j at the endpoint field', (endpoint, message) => {
    expectValidation(
      () => modelCreatePayload({
        provider: 'ollama', name: 'Local', model: 'qwen',
        endpoint, key: '', concurrency: '1',
      }),
      { endpoint: message },
    );
  });

  it('reports required cloud fields independently', () => {
    expectValidation(
      () => modelCreatePayload({
        provider: 'anthropic', name: ' ', model: ' ', endpoint: '', key: '', concurrency: '1',
      }),
      {
        name: 'Display name is required.',
        model: 'Provider model ID is required.',
        key: 'API key is required for Anthropic.',
      },
    );
  });
});

describe('modelUpdatePayload', () => {
  it('does not send a blank stored cloud secret', () => {
    expect(modelUpdatePayload('model-1', {
      provider: 'anthropic', name: 'Claude', model: 'claude-sonnet-4-5',
      endpoint: '', key: ' ', concurrency: '1',
    })).toEqual({
      model_id: 'model-1',
      name: 'Claude',
      model: 'claude-sonnet-4-5',
      max_concurrency: 1,
    });
  });

  it('includes a replacement cloud secret only when entered', () => {
    expect(modelUpdatePayload('model-1', {
      provider: 'openrouter', name: 'Router', model: 'open/model',
      endpoint: '', key: ' replacement ', concurrency: '4',
    })).toEqual({
      model_id: 'model-1',
      name: 'Router',
      model: 'open/model',
      api_key: 'replacement',
      max_concurrency: 4,
    });
  });
});

function expectValidation(run: () => unknown, errors: Record<string, string>) {
  try {
    run();
    throw new Error('Expected validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ModelFormValidationError);
    expect((error as ModelFormValidationError).errors).toEqual(errors);
  }
}
