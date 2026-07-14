import { describe, expect, it } from 'vitest';
import type { Agent } from './data';
import { COMPLEXITIES, eligibleAgentsForComplexity } from './logic';

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: 'agent',
    name: 'Agent',
    modelId: 'model',
    modelName: 'Model',
    modelProvider: 'ollama',
    complexity: 'medium',
    enabled: true,
    status: 'idle',
    taskId: null,
    lastHeartbeat: null,
    todoSummary: null,
    ...overrides,
  };
}

describe('configured agent eligibility', () => {
  it('defines all exact complexity choices', () => {
    expect(COMPLEXITIES.map((item) => item.id)).toEqual([
      'simple', 'medium', 'hard', 'complex',
    ]);
  });

  it('returns only enabled exact-complexity agents', () => {
    expect(eligibleAgentsForComplexity([
      agent({ id: 'simple', complexity: 'simple', enabled: true }),
      agent({ id: 'hard', complexity: 'hard', enabled: true }),
      agent({ id: 'off', complexity: 'hard', enabled: false }),
    ], 'hard').map((item) => item.id)).toEqual(['hard']);
  });
});
