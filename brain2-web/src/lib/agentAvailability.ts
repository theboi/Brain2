import type { Agent } from '@/pages/Agents/data';

export interface AgentAvailability {
  total: number;
  free: number;
  online: number;
}

export function agentAvailability(agents: Agent[]): AgentAvailability {
  return {
    total: agents.length,
    free: agents.filter((agent) => agent.status === 'idle').length,
    online: agents.filter((agent) => agent.status !== 'offline').length,
  };
}
