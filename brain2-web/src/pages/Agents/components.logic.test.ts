import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ModelConfig, ModelProvider } from '@/lib/types';
import {
  agentUpdateChanges,
  canContinueTodo,
  canCreateAgent,
  canManageAgents,
  canSubmitTodo,
  eligibleAgentModels,
  revalidateAgentModelSelection,
  RosterCard,
  TodoRow,
  todoAgentDisplayName,
  todoStatusView,
} from './components';
import type { Agent, Todo } from './data';

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

describe('live permissions and selections', () => {
  it('matches backend manage_agents tenant roles', () => {
    expect(canManageAgents('owner')).toBe(true);
    expect(canManageAgents('admin')).toBe(true);
    expect(canManageAgents('member')).toBe(false);
    expect(canManageAgents(undefined)).toBe(false);
  });

  it('clears a selection that disappears while preserving an existing paused binding', () => {
    const ready = model('ollama');
    const paused = model('anthropic', 'paused');
    expect(revalidateAgentModelSelection(ready.model_id, [ready], null)).toBe(ready.model_id);
    expect(revalidateAgentModelSelection(ready.model_id, [], null)).toBe('');
    expect(revalidateAgentModelSelection(paused.model_id, [paused], paused.model_id)).toBe(paused.model_id);
    expect(revalidateAgentModelSelection(paused.model_id, [], paused.model_id)).toBe('');
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

  it('allows continuation only after a terminal result', () => {
    expect(canContinueTodo('done')).toBe(true);
    expect(canContinueTodo('failed')).toBe(true);
    expect(canContinueTodo('queued')).toBe(false);
    expect(canContinueTodo('running')).toBe(false);
  });

  it('preserves deleted-agent attribution from the todo snapshot', () => {
    const todo = { agentName: 'Deleted analyst' } as Todo;
    expect(todoAgentDisplayName(todo, null)).toBe('Deleted analyst');
  });

  it('treats a null model status as unavailable', () => {
    const agent: Agent = {
      id: 'a1', name: 'Analyst', modelId: 'm1', modelName: 'Mystery model',
      modelProvider: 'ollama', modelStatus: null, complexity: 'hard', enabled: true,
      status: 'offline', taskId: null, lastHeartbeat: null, todoSummary: null,
    };
    const html = renderToStaticMarkup(createElement(RosterCard, {
      a: agent, todo: null, onOpen: () => undefined,
    }));
    expect(html).toContain('configured model status is unknown');
    expect(html).not.toContain('Waiting for queued');
  });

  it('renders an inaccessible busy todo generically without exposing its id', () => {
    const agent: Agent = {
      id: 'a1', name: 'Analyst', modelId: 'm1', modelName: 'Local model',
      modelProvider: 'ollama', modelStatus: 'ready', complexity: 'hard', enabled: true,
      status: 'busy', taskId: 'secret-todo-id', lastHeartbeat: null, todoSummary: null,
    };
    const html = renderToStaticMarkup(createElement(RosterCard, {
      a: agent, todo: null, onOpen: () => undefined,
    }));
    expect(html).toContain('Working on a todo you cannot access');
    expect(html).not.toContain('secret-todo-id');
    expect(html).not.toContain('Waiting for queued');
    expect(html).not.toContain('<button');
  });

  it('renders failed rows as keyboard buttons with a semantic action menu', () => {
    const todo: Todo = {
      id: 't1', workspace_id: 'ws1', title: 'Failed audit', by: 'u1',
      priority: false, status: 'failed', complexity: 'hard', error: 'Provider failed',
      assignedAgentId: 'a1', agentId: 'a1', agentName: 'Deleted analyst',
      modelId: 'm1', modelName: 'Local model', modelProvider: 'ollama',
      conversationId: 'c1', runs: [], messages: [],
    };
    const actions = {
      open: () => undefined, priority: () => undefined, stop: () => undefined,
      remove: () => undefined, rerun: () => undefined,
      add: () => undefined,
    };
    const html = renderToStaticMarkup(createElement(TodoRow, {
      t: todo, menuOpen: true, onMenu: () => undefined, actions,
    }));
    expect(html).toContain('aria-label="Open Failed audit"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('Deleted analyst');
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
    expect(canSubmitTodo({ title: 'Task', workspaceId: 'ws1', complexity: 'hard', workspaceReady: false })).toBe(false);
  });
});
