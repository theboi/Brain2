import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ModelConfig, ModelProvider } from '@/lib/types';
import componentSource from './ModelsSection.tsx?raw';

const mutate = vi.fn();
const reset = vi.fn();

function model(overrides: Partial<ModelConfig> & { provider: ModelProvider }): ModelConfig {
  return {
    model_id: `model-${overrides.provider}`,
    tenant_id: 'tenant-1',
    name: 'Model',
    model: 'provider/model-id',
    param_count: null,
    system_prompt: '',
    tool_allowlist: [],
    fallback_model: null,
    ollama_base_url: null,
    has_api_key: false,
    max_concurrency: 1,
    status: 'ready',
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

vi.mock('@/hooks/useModels', () => ({
  useModels: () => ({
    data: [
      model({
        provider: 'ollama',
        name: 'Local Qwen',
        model: 'qwen2.5:9b',
        ollama_base_url: 'http://127.0.0.1:11434',
        max_concurrency: 2,
      }),
      model({
        provider: 'anthropic',
        name: 'Cloud Claude',
        model: 'claude-sonnet-4-5',
        has_api_key: true,
      }),
      model({
        provider: 'openrouter',
        name: 'Cloud missing key',
        model: 'open/model',
        has_api_key: false,
      }),
      model({
        provider: 'openai',
        name: 'Readable legacy model',
        model: 'gpt-legacy',
        status: 'paused',
      }),
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateModel: () => ({ mutate, reset, isPending: false, isError: false }),
  useUpdateModel: () => ({ mutate, reset, isPending: false, isError: false }),
  useDeleteModel: () => ({ mutate, reset, isPending: false, isError: false }),
  useTestModel: () => ({ mutate, reset, isPending: false, isError: false }),
  usePauseModel: () => ({ mutate, reset, isPending: false, isError: false }),
  useResumeModel: () => ({ mutate, reset, isPending: false, isError: false }),
}));

import { ModelsSection } from './ModelsSection';

describe('ModelsSection', () => {
  it('truthfully renders local, cloud, and legacy registered rows', () => {
    const html = renderToStaticMarkup(<ModelsSection />);

    expect(html).toContain('Registered models');
    expect(html).toContain('Local Qwen');
    expect(html).toContain('Ollama');
    expect(html).toContain('qwen2.5:9b');
    expect(html).toContain('http://127.0.0.1:11434');
    expect(html).toContain('Concurrency: 2');
    expect(html).toContain('Cloud Claude');
    expect(html).toContain('Anthropic');
    expect(html).toContain('API key saved · secret hidden');
    expect(html).toContain('Cloud missing key');
    expect(html).toContain('API key required');
    expect(html).toContain('Readable legacy model');
    expect(html).toContain('OpenAI · Legacy');
    expect(html).toContain('aria-label="Test Local Qwen"');
    expect(html).toContain('aria-label="Remove Local Qwen"');
    expect(html).toContain('aria-label="Pause Local Qwen"');
    expect(html).toContain('aria-label="Resume Readable legacy model"');
    expect(html).not.toContain('stored-api-key');
  });

  it('uses keyboard-submit and visible focus semantics for model fields', () => {
    expect(componentSource).toContain('<form');
    expect(componentSource).toContain('onSubmit=');
    expect(componentSource).toContain('type="submit"');
    expect(componentSource.match(/className="b2-model-field"/g)?.length).toBe(6);
    expect(componentSource).not.toContain("outline: 'none'");
  });
});
