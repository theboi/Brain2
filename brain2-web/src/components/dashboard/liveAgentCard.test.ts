import { describe, expect, it } from 'vitest';
import type { Agent } from '@/pages/Agents/data';
import { liveAgentCard } from './liveAgentCard';

const AGENT: Agent = {
  id: 'a1',
  name: 'Analyst',
  modelId: 'm1',
  modelName: 'Local Qwen',
  modelProvider: 'ollama',
  modelStatus: 'ready',
  complexity: 'hard',
  enabled: true,
  status: 'busy',
  taskId: 'td1',
  lastHeartbeat: '2026-07-14T10:00:00Z',
  todoSummary: { todo_id: 'td1', title: 'Review sources' },
};

describe('liveAgentCard', () => {
  it('maps only live configured-agent facts', () => {
    expect(liveAgentCard(AGENT)).toEqual({
      id: 'a1',
      name: 'Analyst',
      complexity: 'hard',
      modelName: 'Local Qwen',
      modelProvider: 'ollama',
      status: 'busy',
      taskId: 'td1',
    });
  });

  it('keeps unknown model identity null instead of inventing a fallback', () => {
    expect(liveAgentCard({
      ...AGENT,
      modelName: null,
      modelProvider: null,
      status: 'offline',
      taskId: null,
    })).toMatchObject({
      modelName: null,
      modelProvider: null,
      status: 'offline',
      taskId: null,
    });
  });
});
