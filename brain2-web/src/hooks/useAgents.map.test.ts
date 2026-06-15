import { describe, expect, it } from 'vitest';
import { mapTodo, mapWorker } from './useAgents';
import type { LiveTodo, Worker } from '@/lib/types';

const W: Worker = {
  agent_id: 'a1',
  name: 'Jarvis',
  status: 'busy',
  current_todo_id: 't1',
  todo_summary: { todo_id: 't1', title: 'Audit page' },
};

const T: LiveTodo = {
  todo_id: 't1',
  tenant_id: 'x',
  workspace_id: 'ws1',
  requester_user_id: 'u1',
  title: 'Audit page',
  priority: 1,
  status: 'running',
  assigned_agent_id: 'a1',
  preferred_agent_id: null,
  model_pref: 'auto',
  conversation_id: 'c1',
  memory_flushed: 0,
  tokens_total: null,
  cost_total: null,
  created_at: '2026-06-15T10:00:00Z',
  started_at: '2026-06-15T10:00:01Z',
  completed_at: null,
};

describe('mapWorker', () => {
  it('maps status busy->busy and carries taskId', () => {
    const agent = mapWorker(W);
    expect(agent.id).toBe('a1');
    expect(agent.name).toBe('Jarvis');
    expect(agent.status).toBe('busy');
    expect(agent.taskId).toBe('t1');
  });
});

describe('mapTodo', () => {
  it('maps priority>0 to boolean and keeps status', () => {
    const todo = mapTodo(T, []);
    expect(todo.id).toBe('t1');
    expect(todo.priority).toBe(true);
    expect(todo.status).toBe('running');
    expect(todo.agentId).toBe('a1');
  });

  it('maps done todo memory flush', () => {
    const todo = mapTodo({ ...T, status: 'done', memory_flushed: 1, priority: 0 }, []);
    expect(todo.memoryFlushed).toBe(true);
    expect(todo.priority).toBe(false);
  });
});
