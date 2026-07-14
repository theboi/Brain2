import { describe, expect, it } from 'vitest';
import { mapTodo, mapWorker } from './useAgents';
import type { LiveTodo, ModelProvider, Worker } from '@/lib/types';

const MODEL_PROVIDERS: ModelProvider[] = [
  'anthropic', 'ollama', 'openrouter', 'gemini', 'openai', 'stub',
];

const W: Worker = {
  agent_id: 'a1',
  name: 'Terra',
  model_id: 'm1',
  model_name: 'Team Sonnet',
  model_provider: 'anthropic',
  model_status: 'ready',
  complexity: 'hard',
  enabled: true,
  status: 'busy',
  current_todo_id: 't1',
  last_heartbeat: '2026-07-14T10:00:00Z',
  todo_summary: { todo_id: 't1', title: 'Audit page' },
};

const T: LiveTodo = {
  todo_id: 't1',
  tenant_id: 'x',
  workspace_id: 'ws1',
  requester_user_id: 'u1',
  title: 'Audit page',
  complexity: 'hard',
  priority: 1,
  status: 'failed',
  assigned_agent_id: 'a1',
  preferred_agent_id: null,
  model_pref: 'legacy-auto',
  conversation_id: 'c1',
  memory_flushed: 0,
  tokens_total: 0,
  cost_total: null,
  error: 'Provider unavailable',
  cancel_requested: 0,
  created_at: '2026-06-15T10:00:00Z',
  started_at: '2026-06-15T10:00:01Z',
  completed_at: '2026-06-15T10:00:02Z',
  agent_id: 'a1',
  agent_name: 'Terra',
  model_id: 'm1',
  model_name: 'Team Sonnet',
  model_provider: 'anthropic',
  runs: [{
    tenant_id: 'x',
    todo_id: 't1',
    runtime_agent_id: 'a1',
    agent_name: 'Terra',
    model_id: 'm1',
    model_name: 'Team Sonnet',
    model_provider: 'anthropic',
    attribution_complete: 1,
    conversation_id: 'c1',
    status: 'failed',
    tokens_total: 0,
    cost_total: null,
    error: 'Provider unavailable',
    started_at: '2026-06-15T10:00:01Z',
    completed_at: '2026-06-15T10:00:02Z',
  }],
};

describe('mapWorker', () => {
  it('maps the configured agent and model contract', () => {
    expect(mapWorker(W)).toMatchObject({
      id: 'a1',
      name: 'Terra',
      modelId: 'm1',
      modelName: 'Team Sonnet',
      modelProvider: 'anthropic',
      modelStatus: 'ready',
      complexity: 'hard',
      enabled: true,
      status: 'busy',
      taskId: 't1',
      lastHeartbeat: '2026-07-14T10:00:00Z',
      todoSummary: { todo_id: 't1', title: 'Audit page' },
    });
  });

  it('preserves a valid disabled value', () => {
    expect(mapWorker({ ...W, enabled: false }).enabled).toBe(false);
  });

  it.each(MODEL_PROVIDERS)('preserves the known %s response provider', (provider) => {
    expect(mapWorker({ ...W, model_provider: provider }).modelProvider).toBe(provider);
  });

  it('keeps migrated unbound model fields null', () => {
    expect(mapWorker({
      ...W,
      model_id: null,
      model_name: null,
      model_provider: null,
      model_status: null,
      enabled: false,
      status: 'offline',
    })).toMatchObject({
      modelId: null,
      modelName: null,
      modelProvider: null,
      modelStatus: null,
      enabled: false,
    });
  });

  it('maps an unknown response provider to null', () => {
    expect(mapWorker({
      ...W,
      model_provider: 'future-provider' as Worker['model_provider'],
    }).modelProvider).toBeNull();
  });
});

describe('mapTodo', () => {
  it('maps failed status, error, complexity, attribution, and run history', () => {
    expect(mapTodo(T, [])).toMatchObject({
      id: 't1',
      priority: true,
      status: 'failed',
      complexity: 'hard',
      error: 'Provider unavailable',
      assignedAgentId: 'a1',
      agentId: 'a1',
      agentName: 'Terra',
      modelId: 'm1',
      modelName: 'Team Sonnet',
      modelProvider: 'anthropic',
      conversationId: 'c1',
      tokens: '0 tok',
      runs: T.runs,
    });
  });

  it('maps queued, running, done, and failed without collapsing valid zeroes', () => {
    expect((['queued', 'running', 'done', 'failed'] as const).map((status) =>
      mapTodo({ ...T, status, priority: 0, memory_flushed: 0 }, []).status,
    )).toEqual(['queued', 'running', 'done', 'failed']);
    expect(mapTodo({ ...T, priority: 0, memory_flushed: 0 }, [])).toMatchObject({
      priority: false,
      memoryFlushed: false,
      tokens: '0 tok',
    });
  });

  it('keeps partial legacy model attribution unknown', () => {
    const todo = mapTodo({
      ...T,
      model_id: null,
      model_name: null,
      model_provider: null,
      runs: [{ ...T.runs[0], model_id: null, model_name: null, model_provider: null, attribution_complete: 0 }],
    }, []);
    expect(todo.modelId).toBeNull();
    expect(todo.modelName).toBeNull();
    expect(todo.modelProvider).toBeNull();
    expect(todo.runs[0].attribution_complete).toBe(0);
  });

  it.each(MODEL_PROVIDERS)('preserves the known %s todo and run provider', (provider) => {
    const todo = mapTodo({
      ...T,
      model_provider: provider,
      runs: [{ ...T.runs[0], model_provider: provider }],
    }, []);
    expect(todo.modelProvider).toBe(provider);
    expect(todo.runs[0].model_provider).toBe(provider);
  });

  it('maps unknown todo and run providers to null', () => {
    const todo = mapTodo({
      ...T,
      model_provider: 'future-provider' as LiveTodo['model_provider'],
      runs: [{
        ...T.runs[0],
        model_provider: 'future-provider' as LiveTodo['model_provider'],
      }],
    }, []);
    expect(todo.modelProvider).toBeNull();
    expect(todo.runs[0].model_provider).toBeNull();
  });
});
