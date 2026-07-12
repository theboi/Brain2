import { describe, expect, it } from 'vitest';
import type { ModelConfig } from '@/lib/types';
import { canSubmitTodo, eligibleAgentModels } from './components';

function model(provider: ModelConfig['provider'], status: ModelConfig['status'] = 'ready'): ModelConfig {
  return {
    model_id: `${provider}-${status}`,
    name: provider,
    provider,
    model: 'provider/model',
    param_count: null,
    system_prompt: '',
    tool_allowlist: [],
    fallback_model: null,
    ollama_base_url: null,
    status,
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
  it('allows durable queueing when all online workers are currently busy', () => {
    expect(canSubmitTodo({
      title: 'Audit the report', workspaceId: 'ws1', modelId: 'm1',
      onlineCount: 2,
    })).toBe(true);
  });

  it('blocks without an online runtime or required live selections', () => {
    expect(canSubmitTodo({ title: 'Task', workspaceId: 'ws1', modelId: 'm1', onlineCount: 0 })).toBe(false);
    expect(canSubmitTodo({ title: 'Task', workspaceId: '', modelId: 'm1', onlineCount: 1 })).toBe(false);
    expect(canSubmitTodo({ title: 'Task', workspaceId: 'ws1', modelId: '', onlineCount: 1 })).toBe(false);
  });
});
