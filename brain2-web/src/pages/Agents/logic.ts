import type { Complexity } from '@/lib/types';
import type { Agent } from './data';

export const COMPLEXITIES = [
  { id: 'simple', label: 'Simple' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
  { id: 'complex', label: 'Complex' },
] as const;

export function eligibleAgentsForComplexity(
  agents: Agent[],
  complexity: Complexity,
): Agent[] {
  return agents.filter(
    (agent) => agent.enabled && agent.complexity === complexity,
  );
}
