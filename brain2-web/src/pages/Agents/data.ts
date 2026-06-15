/*
 * Brain2 Console — Agents page data + seed.
 * Faithful TS port of docs/design/v1/project/agents-data.js (mock only — no live data yet).
 */

export type Access = string;
export type Loc = 'cloud' | 'local';
export type TodoStatus = 'running' | 'queued' | 'done';
export type AgentRunStatus = 'busy' | 'idle' | 'offline';

export interface Person {
  name: string;
  short: string;
  access: Access;
}

export interface Agent {
  id: string;
  name: string;
  status: AgentRunStatus;
  taskId: string | null;
}

export interface PickModel {
  id: string;
  label: string;
  host?: string;
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

// people who can request work
export const AG_PEOPLE: Record<string, Person> = {
  alice: { name: 'Alice Chen', short: 'alice', access: 'admin' },
  bob:   { name: 'Bob Ng', short: 'bob', access: 'read · research-q3' },
  carol: { name: 'Carol Diaz', short: 'carol', access: 'write' },
  dan:   { name: 'Dan Park', short: 'dan', access: 'write · default' },
};

// named, multi-purpose worker agents
export const SEED_AGENTS: Agent[] = [
  { id: 'jarvis', name: 'Jarvis', status: 'busy', taskId: 't1' },
  { id: 'steve',  name: 'Steve',  status: 'busy', taskId: 't2' },
  { id: 'marvin', name: 'Marvin', status: 'busy', taskId: 't3' },
  { id: 'ada',    name: 'Ada',    status: 'busy', taskId: 't10' },
  { id: 'hal',    name: 'Hal',    status: 'busy', taskId: 't11' },
  { id: 'friday', name: 'Friday', status: 'offline', taskId: null },
];

// models available to pick from (mirrors Settings → Models)
export const PICK_MODELS: { cloud: PickModel[]; local: PickModel[] } = {
  cloud: [
    { id: 'sonnet', label: 'Claude Sonnet 4.5' },
    { id: 'haiku', label: 'Claude Haiku 4.5' },
    { id: 'gflash', label: 'Gemini 2.5 Flash' },
  ],
  local: [
    { id: 'llama70', label: 'llama3.3 · 70B', host: 'workstation-1' },
    { id: 'qwen32', label: 'qwen2.5 · 32B', host: 'gpu-box' },
    { id: 'llama8', label: 'llama3.1 · 8B', host: 'mac-studio' },
  ],
};

// build an assistant message; reveal=null means fully shown (with footer)
export function asst(full: string, tools?: Tool[], footer?: Footer | null, reveal?: number | null): Message {
  return { role: 'assistant', tools: tools || [], text: full, footer: footer || null, reveal: (reveal === undefined ? null : reveal) };
}

export const CANNED_REPLY =
  "On it. I pulled the relevant wiki page and its cited sources, cross-checked each claim against them, and flagged anything that isn't directly supported. A short summary and suggested edits are ready for review — tell me if you'd like me to apply them.";

export const SEED_TODOS: Todo[] = [
  // ── running ──────────────────────────────────────────────────────────────
  {
    id: 't1', title: 'Audit the Cell theory page for unsupported claims', by: 'alice', priority: false,
    status: 'running', agentId: 'jarvis', loc: 'cloud', model: 'Claude Sonnet 4.5', elapsed: 20, dur: 80,
    messages: [
      { role: 'user', text: 'Audit the **Cell theory** page and flag any claim its sources don’t support.' },
      asst("Most of the page is well supported by its three cited sources. I found **one claim** I can't trace to any of them — the passage in *Origins* attributing the 1839 generalisation to Schwann. I'd flag that for review and keep the rest.",
        [{ name: 'wiki:get', args: '"Cell theory"', result: 'got 3.1 KB · v7', done: true }, { name: 'sources:get', args: '"Hooke 1665"', result: '', running: true }], null, 14),
    ],
  },
  {
    id: 't2', title: 'Summarise the research-q3 sources into a digest', by: 'bob', priority: false,
    status: 'running', agentId: 'steve', loc: 'local', model: 'llama3.3 · 70B', elapsed: 130, dur: 168,
    messages: [
      { role: 'user', text: 'Give me a tight digest of the **research-q3** sources.' },
      asst("Reading through the 12 sources now. Early themes: ingestion and the audit trail are the most-used surfaces, and there's a clear preference for treating raw sources as first-class objects.",
        [{ name: 'sources:list_for_project', args: '"research-q3"', result: '12 sources', done: true }], null, 22),
    ],
  },
  {
    id: 't3', title: 'Re-crawl tracked sources and flag changed pages', by: 'carol', priority: false,
    status: 'running', agentId: 'marvin', loc: 'local', model: 'qwen2.5 · 32B', elapsed: 8, dur: 66,
    messages: [
      { role: 'user', text: 'Re-crawl everything we track and tell me what changed.' },
      asst("Starting the crawl across 1,284 tracked sources. I'll report any pages whose content hash changed since the last run.",
        [{ name: 'web:crawl', args: 'tracked', result: '', running: true }], null, 12),
    ],
  },
  {
    id: 't10', title: 'Compile a changelog from the last 20 source updates', by: 'carol', priority: false,
    status: 'running', agentId: 'ada', loc: 'local', model: 'qwen2.5 · 32B', elapsed: 20, dur: 72,
    messages: [
      { role: 'user', text: 'Compile a changelog from the **last 20 source updates**.' },
      asst("Pulling the 20 most recent source revisions and grouping them by topic. I'll write a dated changelog with links back to each source.",
        [{ name: 'sources:recent', args: '20', result: '20 revisions', done: true }], null, 16),
    ],
  },
  {
    id: 't11', title: 'Answer: which plans include SSO?', by: 'alice', priority: false,
    status: 'running', agentId: 'hal', loc: 'cloud', model: 'Claude Haiku 4.5', elapsed: 6, dur: 48,
    messages: [
      { role: 'user', text: 'Which plans include **SSO**? Cite the pricing page.' },
      asst("Checking the pricing wiki page and the latest plan matrix to confirm which tiers include SSO.",
        [{ name: 'wiki:get', args: '"Pricing"', result: '', running: true }], null, 10),
    ],
  },
  // ── queued ───────────────────────────────────────────────────────────────
  {
    id: 't4', title: 'Draft replies to the 7 waiting customer queries', by: 'alice', priority: true,
    status: 'queued', agentId: null, modelPref: 'local', loc: 'local',
    messages: [{ role: 'user', text: 'Draft replies to the **7 waiting customer queries**, citing wiki sources.' }],
  },
  {
    id: 't5', title: 'Rewrite the Origins section per the new source', by: 'dan', priority: false,
    status: 'queued', agentId: null, modelPref: 'auto', loc: 'local',
    messages: [{ role: 'user', text: 'Rewrite the **Origins** section to reflect schwann-1839.pdf.' }],
  },
  {
    id: 't6', title: 'Compile the weekly exec digest and email it', by: 'alice', priority: false,
    status: 'queued', agentId: null, modelPref: 'cloud', loc: 'cloud',
    messages: [{ role: 'user', text: 'Compile this week’s exec digest and send it to the leads.' }],
  },
  {
    id: 't12', title: 'Check the Bacteria page for broken source links', by: 'carol', priority: false,
    status: 'queued', agentId: null, modelPref: 'auto', loc: 'local',
    messages: [{ role: 'user', text: 'Check the **Bacteria** page for broken or dead source links.' }],
  },
  {
    id: 't13', title: 'Summarise what changed in the gateway.py source', by: 'dan', priority: false,
    status: 'queued', agentId: null, modelPref: 'local', loc: 'local',
    messages: [{ role: 'user', text: 'Summarise what changed in **gateway.py** since last week.' }],
  },
  // ── done (memory flushed) ────────────────────────────────────────────────
  {
    id: 't7', title: 'Find every page that cites “Hooke 1665”', by: 'alice', priority: false,
    status: 'done', agentId: 'jarvis', loc: 'cloud', model: 'Claude Sonnet 4.5', when: '14m ago', tokens: '920 tok', memoryFlushed: true,
    messages: [
      { role: 'user', text: 'List every wiki page whose sources include **“Hooke 1665”**.' },
      asst("Three pages cite that source:\n- **Cell theory** · v7\n- **Micrographia** · v3\n- **Microscopy** · v2",
        [{ name: 'wiki:search', args: '"Hooke 1665"', result: '3 pages', done: true }], { latency: '3.1s', tokens: '920 tok', cost: '$0.007' }),
    ],
  },
  {
    id: 't8', title: 'Tighten the Microscopy introduction', by: 'carol', priority: false,
    status: 'done', agentId: 'ada', loc: 'local', model: 'llama3.3 · 70B', when: '1h ago', tokens: 'local', memoryFlushed: true,
    messages: [
      { role: 'user', text: 'Tighten the intro paragraph on **Microscopy**.' },
      asst("Done — I trimmed the intro from 6 sentences to 3 and kept the citations. Applied as an audit suggestion on the page; accept it from the Wiki → Audit drawer.",
        [{ name: 'wiki:get', args: '"Microscopy"', result: 'got 2.2 KB', done: true }], { latency: '1.2s', tokens: 'local', cost: 'local' }),
    ],
  },
  {
    id: 't9', title: 'Where are mitochondria described in the wiki?', by: 'bob', priority: false,
    status: 'done', agentId: 'steve', loc: 'local', model: 'qwen2.5 · 32B', when: '3h ago', tokens: '1,240 tok', memoryFlushed: true,
    messages: [
      { role: 'user', text: 'Where are **mitochondria** described?' },
      asst("Mitochondria are covered in two places: the **Cell theory** page (Organelles section) and a dedicated **Bacteria vs. Eukaryotes** page. Both cite the same 1967 endosymbiosis source.",
        [{ name: 'wiki:search', args: '"mitochondria"', result: '2 pages', done: true }], { latency: '0.9s', tokens: '1,240 tok', cost: '$0.002' }),
    ],
  },
];
