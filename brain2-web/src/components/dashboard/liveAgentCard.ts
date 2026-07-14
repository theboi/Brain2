import type { Complexity, ModelProvider } from '@/lib/types';
import type { Agent } from '@/pages/Agents/data';

export interface LiveAgentCardModel {
  id: string;
  name: string;
  complexity: Complexity;
  modelName: string | null;
  modelProvider: ModelProvider | null;
  status: Agent['status'];
  taskId: string | null;
}

export function liveAgentCard(agent: Agent): LiveAgentCardModel {
  return {
    id: agent.id,
    name: agent.name,
    complexity: agent.complexity,
    modelName: agent.modelName,
    modelProvider: agent.modelProvider,
    status: agent.status,
    taskId: agent.taskId,
  };
}
