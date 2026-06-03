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

export interface BriefingItem {
  title: string;
  meta: string;
  tone: 'accent' | 'success' | 'warning' | 'destructive' | 'muted';
}

export interface BriefingGroup {
  key: string;
  title: string;
  icon: string;
  tone: 'accent' | 'destructive' | 'warning' | 'success' | 'muted';
  count: number;
  lead: string;
  items: BriefingItem[];
}

export interface QuickAction {
  id: string;
  title: string;
  plugin: string;
  icon: string;
  tone: 'accent' | 'warning' | 'muted';
  est: string;
  runner: string;
}

function seededSeries(n: number, base: number, drift: number, noise: number, seed: number): number[] {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out: number[] = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    v += drift + (rand() - 0.5) * noise;
    out.push(Math.max(0, Math.round(v)));
  }
  return out;
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

export const HERO_STATS = [
  { label: 'agents online', value: '5' },
  { label: 'sources', value: '1,284' },
  { label: 'wiki pages', value: '312' },
  { label: 'queries today', value: '89' },
];

export const ACTIVITY: ActivityItem[] = [
  { t: '14:02', icon: 'sparkles', text: 'Researcher · message returned', meta: '1,840 tok', tone: 'accent' },
  { t: '13:58', icon: 'file', text: 'Source ingested · "Hooke 1665.pdf"', meta: '→ Micrographia', tone: 'muted' },
  { t: '13:31', icon: 'check', text: 'Wiki edit applied via LLM nudge', meta: 'Cell theory', tone: 'success' },
  { t: '13:12', icon: 'alert', text: 'Archivist · circuit breaker half-open', meta: 'retry in 30s', tone: 'warning' },
  { t: '12:10', icon: 'clock', text: 'Coder · went idle', meta: 'after 34 msgs', tone: 'muted' },
  { t: '11:46', icon: 'file', text: 'Source ingested · "standup-04-12.md"', meta: '→ Q3 themes', tone: 'muted' },
  { t: '11:09', icon: 'sparkles', text: 'New wiki page compiled · "Bacteria"', meta: 'v1 · 2 sources', tone: 'accent' },
  { t: '10:24', icon: 'sparkles', text: 'Summariser · 12-source digest done', meta: '3,201 tok', tone: 'muted' },
];

export const WIKI_HEALTH = {
  score: 86,
  label: 'Healthy',
  coverage: 95,
  rows: [
    { icon: 'check', tone: 'success' as const, label: 'Pages with provenance', value: '298' },
    { icon: 'alert', tone: 'warning' as const, label: 'Open LLM audits', value: '3' },
    { icon: 'alert', tone: 'warning' as const, label: 'Flagged for review · drift', value: '7' },
    { icon: 'clock', tone: 'muted' as const, label: 'Stale · not edited 30d+', value: '12' },
  ],
};

export const WIKI_BY_PROJECT = [
  { label: 'default', value: 142 },
  { label: 'research-q3', value: 98 },
  { label: 'launch-docs', value: 34 },
  { label: 'archive', value: 22 },
  { label: 'handbook', value: 16 },
];

export const SOURCES_OVER_TIME = seededSeries(30, 980, 10, 26, 3);
export const QUERIES_SERVED = seededSeries(30, 60, 1, 40, 11);
export const TOKENS_BY_PROVIDER: Record<string, number[]> = {
  Anthropic: seededSeries(30, 120, 4, 60, 5),
  Gemini: seededSeries(30, 80, 2, 40, 9),
  Ollama: seededSeries(30, 50, 1, 30, 13),
};

export const BRIEFING: BriefingGroup[] = [
  {
    key: 'digests', title: 'Digests', icon: 'sparkles', tone: 'accent', count: 2,
    lead: '2 new',
    items: [
      { title: 'Morning digest · 12 sources summarised', meta: '3,201 tok · 8m ago', tone: 'accent' },
      { title: 'Weekly wiki digest is ready', meta: '24 pages changed', tone: 'muted' },
    ],
  },
  {
    key: 'errors', title: 'Critical errors', icon: 'alert', tone: 'destructive', count: 2,
    lead: '2 active',
    items: [
      { title: 'Archivist · circuit breaker open', meta: 'per-tenant limit · retry 30s', tone: 'destructive' },
      { title: 'Gemini · 3 failed calls', meta: 'HTTP 429 · rate limited', tone: 'destructive' },
    ],
  },
  {
    key: 'queries', title: 'Customer queries', icon: 'users', tone: 'warning', count: 7,
    lead: '7 waiting',
    items: [
      { title: '"Refund window for EU orders?"', meta: 'unanswered · routed to wiki', tone: 'warning' },
      { title: '"Does the Pro plan include SSO?"', meta: '2 sources cited · draft ready', tone: 'success' },
      { title: '+5 more in the queue', meta: 'oldest 2h ago', tone: 'muted' },
    ],
  },
];

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'fin-q2', title: 'Generate financial report · Q2', plugin: 'Reports', icon: 'file', tone: 'accent', est: 'PDF · ~2 min', runner: 'Researcher' },
  { id: 'queries', title: 'Draft replies to waiting queries', plugin: 'Query Desk', icon: 'users', tone: 'warning', est: '7 in queue', runner: 'Researcher' },
  { id: 'audit', title: 'Audit wiki for unsupported claims', plugin: 'Citations Guard', icon: 'shield', tone: 'accent', est: '312 pages', runner: 'Archivist' },
  { id: 'digest', title: 'Send the weekly exec digest', plugin: 'Digest', icon: 'mail', tone: 'accent', est: 'to 4 people', runner: 'Summariser' },
  { id: 'recrawl', title: 'Re-crawl tracked sources', plugin: 'Web Crawler', icon: 'globe', tone: 'muted', est: '1,284 sources', runner: 'Editor' },
];
