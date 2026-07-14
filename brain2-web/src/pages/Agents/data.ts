// Brain2 Console — Agents page view-model types.
import type { Complexity, RuntimeModelProvider, TodoRun } from '@/lib/types';

export type TodoStatus = 'running' | 'queued' | 'done' | 'failed';
export type AgentRunStatus = 'busy' | 'idle' | 'offline';

export interface Agent {
  id: string;
  name: string;
  modelId: string | null;
  modelName: string | null;
  modelProvider: RuntimeModelProvider | null;
  complexity: Complexity;
  enabled: boolean;
  status: AgentRunStatus;
  taskId: string | null;
  lastHeartbeat: string | null;
  todoSummary: { todo_id: string; title: string } | null;
}

export interface Tool {
  name: string;
  args: string;
  result?: string;
  running?: boolean;
  done?: boolean;
}

export interface Footer {
  latency: string;
  tokens: string;
  cost: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  text: string;
  messageId?: string;
  conversationId?: string;
  createdAt?: string;
  tokensIn?: number;
  tokensOut?: number;
  costMicros?: number;
  latencyMs?: number;
  by?: string;
  tools?: Tool[];
  footer?: Footer | null;
  reveal?: number | null;
}

export interface Todo {
  id: string;
  workspace_id?: string;
  title: string;
  by: string;
  priority: boolean;
  status: TodoStatus;
  complexity: Complexity;
  error: string | null;
  assignedAgentId: string | null;
  agentId: string | null;
  agentName: string | null;
  modelId: string | null;
  modelName: string | null;
  modelProvider: RuntimeModelProvider | null;
  conversationId: string | null;
  runs: TodoRun[];
  /** Compatibility alias for existing rendering; never inferred. */
  model?: string;
  /** Legacy output-only value retained for existing historical rows. */
  modelPref?: string;
  tokens?: string;
  memoryFlushed?: boolean;
  doneAt?: number;
  completedLabel?: string;
  preferredAgent?: string | null;
  messages: Message[];
}
