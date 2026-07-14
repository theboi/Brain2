import { describe, expect, it } from 'vitest';
import type { ModelConfig, ModelProvider } from '@/lib/types';
import {
  agentUpdateChanges,
  canCreateAgent,
  canSubmitTodo,
  eligibleAgentModels,
  todoStatusView,
} from './components';
import type { Agent } from './data';

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
    has_api_key: provider === 'anthropic' || provider === 'openrouter',
    max_concurrency: 1,
    status,
    created_by: null,
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  };
}

describe('eligibleAgentModels', () => {
  it('keeps every ready runtime provider', () => {
    expect(eligibleAgentModels([
      model('anthropic'), model('openrouter'), model('ollama'),
      model('gemini'), model('anthropic', 'paused'),
    ]).map((item) => item.provider)).toEqual(['anthropic', 'openrouter', 'ollama']);
  });

  it('does not filter ready models already used by another agent', () => {
    const shared = model('ollama');
    expect(eligibleAgentModels([shared, shared]).map((item) => item.model_id))
      .toEqual([shared.model_id, shared.model_id]);
  });
});

describe('canCreateAgent', () => {
  it('requires a name, ready model selection, exact complexity, and settled mutation', () => {
    expect(canCreateAgent({ name: 'Analyst', modelId: 'm1', complexity: 'hard' })).toBe(true);
    expect(canCreateAgent({ name: '', modelId: 'm1', complexity: 'hard' })).toBe(false);
    expect(canCreateAgent({ name: 'Analyst', modelId: '', complexity: 'hard' })).toBe(false);
    expect(canCreateAgent({ name: 'Analyst', modelId: 'm1', complexity: 'extreme' })).toBe(false);
    expect(canCreateAgent({ name: 'Analyst', modelId: 'm1', complexity: 'hard', pending: true })).toBe(false);
  });
});

describe('agent configuration changes', () => {
  it('omits an unchanged paused model from unrelated edits', () => {
    const current: Agent = {
      id: 'a1', name: 'Analyst', modelId: 'm1', modelName: 'Paused local',
      modelProvider: 'ollama', modelStatus: 'paused', complexity: 'hard',
      enabled: true, status: 'offline', taskId: null, lastHeartbeat: null,
      todoSummary: null,
    };
    expect(agentUpdateChanges(current, {
      name: 'Senior analyst', modelId: 'm1', complexity: 'hard', enabled: true,
    })).toEqual({ name: 'Senior analyst' });
  });
});

describe('todo status view', () => {
  it('renders failed as a terminal alert state', () => {
    expect(todoStatusView('failed')).toMatchObject({
      icon: 'alert', label: 'Failed', spin: false,
    });
  });
});

describe('canSubmitTodo', () => {
  it('allows durable queueing without a ready model or online agent', () => {
    expect(canSubmitTodo({
      title: 'Audit the report',
      workspaceId: 'ws1',
      complexity: 'hard',
      pending: false,
    })).toBe(true);
  });

  it('requires title, workspace, exact complexity, and a settled mutation', () => {
    expect(canSubmitTodo({ title: '', workspaceId: 'ws1', complexity: 'hard' })).toBe(false);
    expect(canSubmitTodo({ title: 'Task', workspaceId: '', complexity: 'hard' })).toBe(false);
    expect(canSubmitTodo({ title: 'Task', workspaceId: 'ws1', complexity: 'extreme' })).toBe(false);
    expect(canSubmitTodo({ title: 'Task', workspaceId: 'ws1', complexity: 'hard', pending: true })).toBe(false);
  });
});
