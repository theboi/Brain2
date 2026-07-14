/* Brain2 Console — mock data for UI development */

export type AgentStatus = 'active' | 'ready' | 'idle' | 'degraded' | 'error';

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

export const WIKI_HEALTH: {
  score: number;
  label: string;
  coverage: number;
  rows: WikiHealthRow[];
} | null = null;

export const QUICK_ACTIONS: QuickAction[] = [];
