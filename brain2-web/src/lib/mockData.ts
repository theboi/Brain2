/* Brain2 Console — mock data for UI development */

export type AgentStatus = 'active' | 'ready' | 'idle' | 'degraded' | 'error';

export interface Agent {
  id: string;
  name: string;
  model: string;
  provider: string;
  status: AgentStatus;
  statusLabel: string;
  last: string;
  msgs: number;
  cost: string;
  spark: number[];
  note?: string;
}

export interface ActivityItem {
  t: string;
  icon: string;
  text: string;
  meta: string;
  tone: 'accent' | 'success' | 'warning' | 'muted';
}

export interface WikiHealthRow {
  icon: string;
  tone: 'success' | 'warning' | 'muted';
  label: string;
  value: string;
}

export interface QuickAction {
  id: string;
  title: string;
  plugin: string;
  icon: string;
  tone: 'accent' | 'warning' | 'muted';
  est: string;
  runner: string;
  available: boolean;
  unavailableReason?: string;
}

export const AGENTS: Agent[] = [
  {
    id: 'researcher', name: 'Researcher', model: 'Claude 3.5 Sonnet', provider: 'Anthropic · cloud',
    status: 'active', statusLabel: 'streaming', last: '2h ago', msgs: 12, cost: '$0.014',
    spark: [2, 3, 5, 8, 6, 4, 7, 9, 12], note: 'tool ▸ wiki:get',
  },
  {
    id: 'coder', name: 'Coder', model: 'GPT-4o-mini', provider: 'OpenAI · cloud',
    status: 'ready', statusLabel: 'ready', last: '5h ago', msgs: 34, cost: '$0.002',
    spark: [4, 6, 3, 8, 5, 9, 7, 6, 4],
  },
  {
    id: 'editor', name: 'Editor', model: 'llama3 · 8B', provider: 'Ollama · local',
    status: 'active', statusLabel: 'tool: read', last: '8m ago', msgs: 4, cost: 'local',
    spark: [1, 0, 2, 3, 1, 4, 2, 5, 4], note: 'tool ▸ sources:read',
  },
  {
    id: 'summariser', name: 'Summariser', model: 'gemini-1.5-flash', provider: 'Google · cloud',
    status: 'idle', statusLabel: 'idle 1d', last: '1d ago', msgs: 120, cost: '$0.001',
    spark: [9, 7, 8, 5, 6, 3, 2, 1, 0],
  },
  {
    id: 'archivist', name: 'Archivist', model: 'Claude 3 Haiku', provider: 'Anthropic · cloud',
    status: 'degraded', statusLabel: 'degraded', last: '20m ago', msgs: 51, cost: '$0.004',
    spark: [6, 8, 4, 7, 9, 5, 3, 6, 5], note: 'circuit half-open',
  },
];

export const WIKI_HEALTH: {
  score: number;
  label: string;
  coverage: number;
  rows: WikiHealthRow[];
} | null = null;

export const QUICK_ACTIONS: QuickAction[] = [];
