import { describe, expect, it } from 'vitest';
import type { ModelConfig, ModelProvider } from '@/lib/types';
import { canSubmitTodo, eligibleAgentModels } from './components';

function model(provider: ModelProvider, status: ModelConfig['status'] = 'ready'): ModelConfig {
  return {
    model_id: `${provider}-${status}`,
    tenant_id: 'tenant',
    name: provider,
    provider,
    model: 'provider/model',
    param_count: null,
    system_prompt: '',
    tool_allowlist: [],
    fallback_model: null,
    ollama_base_url: null,
    max_concurrency: 1,
    status,
    created_by: null,
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  };
}

describe('eligibleAgentModels', () => {
  it('keeps only ready Anthropic and OpenRouter configurations', () => {
    expect(eligibleAgentModels([
      model('anthropic'), model('openrouter'), model('ollama'),
      model('gemini'), model('anthropic', 'paused'),
    ]).map((item) => item.provider)).toEqual(['anthropic', 'openrouter']);
  });
});

describe('canSubmitTodo', () => {
  it('allows durable queueing without a ready model or online agent', () => {
    expect(canSubmitTodo({
      title: 'Audit the report',
      workspaceId: 'ws1',
      complexity: 'hard',
    })).toBe(true);
  });

  it('requires title, workspace, exact complexity, and a settled mutation', () => {
    expect(canSubmitTodo({ title: '', workspaceId: 'ws1', complexity: 'hard' })).toBe(false);
    expect(canSubmitTodo({ title: 'Task', workspaceId: '', complexity: 'hard' })).toBe(false);
    expect(canSubmitTodo({ title: 'Task', workspaceId: 'ws1', complexity: 'extreme' })).toBe(false);
    expect(canSubmitTodo({ title: 'Task', workspaceId: 'ws1', complexity: 'hard', pending: true })).toBe(false);
  });
});
