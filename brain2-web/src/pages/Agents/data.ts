// Brain2 Console — Agents page view-model types.

export type Loc = 'cloud' | 'local';
export type TodoStatus = 'running' | 'queued' | 'done';
export type AgentRunStatus = 'busy' | 'idle' | 'offline';

export interface Agent {
  id: string;
  name: string;
  status: AgentRunStatus;
  taskId: string | null;
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
  role: 'user' | 'assistant';
  text: string;
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
  agentId: string | null;
  loc?: Loc;
  model?: string;
  modelPref?: string;
  elapsed?: number;
  dur?: number;
  when?: string;
  tokens?: string;
  memoryFlushed?: boolean;
  doneAt?: number;
  preferredAgent?: string | null;
  messages: Message[];
}
