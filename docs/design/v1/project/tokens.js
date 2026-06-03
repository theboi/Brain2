/* Brain2 Console — design tokens, font maps, dummy data.
   Plain JS attached to window for the babel jsx files to consume. */

// ── Color tokens (from spec §0) ────────────────────────────────────────
function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const ACCENTS = {
  indigo:  { dark: '#7C8CFF', light: '#5466E5', label: 'Indigo' },
  violet:  { dark: '#A78BFA', light: '#7C3AED', label: 'Violet' },
  emerald: { dark: '#34D399', light: '#0E9F6E', label: 'Emerald' },
};

const FONTS = {
  inter: {
    label: 'Inter',
    ui: "'Inter', system-ui, sans-serif",
    display: "'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    displayTrack: '-0.02em',
  },
  geist: {
    label: 'Geist',
    ui: "'Geist', 'Inter', system-ui, sans-serif",
    display: "'Geist', 'Inter', system-ui, sans-serif",
    mono: "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
    displayTrack: '-0.03em',
  },
  plex: {
    label: 'IBM Plex',
    ui: "'IBM Plex Sans', system-ui, sans-serif",
    display: "'IBM Plex Sans', system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
    displayTrack: '-0.01em',
  },
};

function getTokens(theme, accentKey = 'indigo', fontKey = 'inter') {
  const a = ACCENTS[accentKey] || ACCENTS.indigo;
  const f = FONTS[fontKey] || FONTS.inter;
  const accent = theme === 'dark' ? a.dark : a.light;
  const dark = theme === 'dark';
  return {
    '--bg': dark ? '#0B0D10' : '#FCFCFD',
    '--surface': dark ? '#11141A' : '#FFFFFF',
    '--surface-2': dark ? '#161A22' : '#F4F5F7',
    '--surface-3': dark ? '#1C212B' : '#ECEEF1',
    '--border': dark ? 'rgba(255,255,255,.08)' : '#E4E7EB',
    '--border-strong': dark ? 'rgba(255,255,255,.14)' : '#D4D8DE',
    '--fg': dark ? '#ECEEF2' : '#0F1115',
    '--fg-muted': dark ? '#8B8F98' : '#5C6470',
    '--fg-faint': dark ? '#5B606B' : '#9AA1AC',
    '--accent': accent,
    '--accent-soft': hexToRgba(accent, dark ? 0.16 : 0.10),
    '--accent-line': hexToRgba(accent, dark ? 0.5 : 0.4),
    '--success': dark ? '#22C55E' : '#16A34A',
    '--warning': dark ? '#F59E0B' : '#D97706',
    '--destructive': dark ? '#EF4444' : '#DC2626',
    '--success-soft': hexToRgba(dark ? '#22C55E' : '#16A34A', dark ? 0.16 : 0.12),
    '--warning-soft': hexToRgba(dark ? '#F59E0B' : '#D97706', dark ? 0.16 : 0.12),
    '--destructive-soft': hexToRgba(dark ? '#EF4444' : '#DC2626', dark ? 0.15 : 0.10),
    '--diff-add-bg': dark ? 'rgba(34,197,94,.14)' : 'rgba(22,163,74,.10)',
    '--diff-del-bg': dark ? 'rgba(239,68,68,.14)' : 'rgba(220,38,38,.10)',
    '--diff-add-gutter': dark ? 'rgba(34,197,94,.22)' : 'rgba(22,163,74,.18)',
    '--diff-del-gutter': dark ? 'rgba(239,68,68,.22)' : 'rgba(220,38,38,.18)',
    '--shadow-card': dark ? 'none' : '0 1px 2px rgba(15,17,21,.06)',
    '--ui-font': f.ui,
    '--display-font': f.display,
    '--mono-font': f.mono,
    '--display-track': f.displayTrack,
  };
}

// ── Dummy data ─────────────────────────────────────────────────────────
function seededSeries(n, base, drift, noise, seed) {
  let s = seed || 7;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    v += drift + (rand() - 0.5) * noise;
    out.push(Math.max(0, Math.round(v)));
  }
  return out;
}

const DATA = {
  user: 'Alice',
  greeting: 'Good morning, Alice',
  workspace: 'default',
  hero: [
    { label: 'agents online', value: '5' },
    { label: 'sources', value: '1,284' },
    { label: 'wiki pages', value: '312' },
    { label: 'queries today', value: '89' },
  ],
  agents: [
    { id: 'researcher', name: 'Researcher', model: 'Claude 3.5 Sonnet', provider: 'Anthropic · cloud',
      status: 'active', statusLabel: 'streaming', last: '2h ago', msgs: 12, cost: '$0.014',
      spark: [2, 3, 5, 8, 6, 4, 7, 9, 12], note: 'tool ▸ wiki:get' },
    { id: 'coder', name: 'Coder', model: 'GPT-4o-mini', provider: 'OpenAI · cloud',
      status: 'ready', statusLabel: 'ready', last: '5h ago', msgs: 34, cost: '$0.002',
      spark: [4, 6, 3, 8, 5, 9, 7, 6, 4] },
    { id: 'editor', name: 'Editor', model: 'llama3 · 8B', provider: 'Ollama · local',
      status: 'active', statusLabel: 'tool: read', last: '8m ago', msgs: 4, cost: 'local',
      spark: [1, 0, 2, 3, 1, 4, 2, 5, 4], note: 'tool ▸ sources:read' },
    { id: 'summariser', name: 'Summariser', model: 'gemini-1.5-flash', provider: 'Google · cloud',
      status: 'idle', statusLabel: 'idle 1d', last: '1d ago', msgs: 120, cost: '$0.001',
      spark: [9, 7, 8, 5, 6, 3, 2, 1, 0] },
    { id: 'archivist', name: 'Archivist', model: 'Claude 3 Haiku', provider: 'Anthropic · cloud',
      status: 'degraded', statusLabel: 'degraded', last: '20m ago', msgs: 51, cost: '$0.004',
      spark: [6, 8, 4, 7, 9, 5, 3, 6, 5], note: 'circuit half-open' },
  ],
  sourcesOverTime: seededSeries(30, 980, 10, 26, 3),
  queriesServed: seededSeries(30, 60, 1, 40, 11),
  wikiByProject: [
    { label: 'default', value: 142 },
    { label: 'research-q3', value: 98 },
    { label: 'launch-docs', value: 34 },
    { label: 'archive', value: 22 },
    { label: 'handbook', value: 16 },
  ],
  tokensByProvider: {
    Anthropic: seededSeries(30, 120, 4, 60, 5),
    Gemini: seededSeries(30, 80, 2, 40, 9),
    Ollama: seededSeries(30, 50, 1, 30, 13),
  },
  activity: [
    { t: '14:02', icon: 'sparkles', text: 'Researcher · message returned', meta: '1,840 tok', tone: 'accent' },
    { t: '13:58', icon: 'file', text: 'Source ingested · “Hooke 1665.pdf”', meta: '→ Micrographia', tone: 'muted' },
    { t: '13:31', icon: 'check', text: 'Wiki edit applied via LLM nudge', meta: 'Cell theory', tone: 'success' },
    { t: '13:12', icon: 'alert', text: 'Archivist · circuit breaker half-open', meta: 'retry in 30s', tone: 'warning' },
    { t: '12:10', icon: 'clock', text: 'Coder · went idle', meta: 'after 34 msgs', tone: 'muted' },
    { t: '11:46', icon: 'file', text: 'Source ingested · “standup-04-12.md”', meta: '→ Q3 themes', tone: 'muted' },
    { t: '11:09', icon: 'wiki', text: 'New wiki page compiled · “Bacteria”', meta: 'v1 · 2 sources', tone: 'accent' },
    { t: '10:24', icon: 'sparkles', text: 'Summariser · 12-source digest done', meta: '3,201 tok', tone: 'muted' },
  ],
  quickSuggestions: ['Audit a wiki page', 'Summarise Q3 sources', 'Find unsupported claims'],
  // Boss-level actions, each delivered by an installed plugin. Chat is appended last by the UI.
  quickActions: [
    { id: 'fin-q2', title: 'Generate financial report · Q2', plugin: 'Reports', icon: 'file', tone: 'accent', est: 'PDF · ~2 min', runner: 'Researcher' },
    { id: 'queries', title: 'Draft replies to waiting queries', plugin: 'Query Desk', icon: 'users', tone: 'warning', est: '7 in queue', runner: 'Researcher' },
    { id: 'audit', title: 'Audit wiki for unsupported claims', plugin: 'Citations Guard', icon: 'shield', tone: 'accent', est: '312 pages', runner: 'Archivist' },
    { id: 'digest', title: 'Send the weekly exec digest', plugin: 'Digest', icon: 'mail', tone: 'accent', est: 'to 4 people', runner: 'Summariser' },
    { id: 'recrawl', title: 'Re-crawl tracked sources', plugin: 'Web Crawler', icon: 'globe', tone: 'muted', est: '1,284 sources', runner: 'Editor' },
  ],
  briefing: [
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
      key: 'queries', title: 'Customer queries', icon: 'chats', tone: 'warning', count: 7,
      lead: '7 waiting',
      items: [
        { title: '“Refund window for EU orders?”', meta: 'unanswered · routed to wiki', tone: 'warning' },
        { title: '“Does the Pro plan include SSO?”', meta: '2 sources cited · draft ready', tone: 'success' },
        { title: '+5 more in the queue', meta: 'oldest 2h ago', tone: 'muted' },
      ],
    },
  ],
  wikiHealth: {
    score: 86,
    label: 'Healthy',
    coverage: 95,
    rows: [
      { icon: 'check', tone: 'success', label: 'Pages with provenance', value: '298' },
      { icon: 'alert', tone: 'warning', label: 'Open LLM audits', value: '3' },
      { icon: 'alert', tone: 'warning', label: 'Flagged for review · drift', value: '7' },
      { icon: 'clock', tone: 'muted', label: 'Stale · not edited 30d+', value: '12' },
    ],
  },
};

Object.assign(window, { getTokens, hexToRgba, ACCENTS, FONTS, DATA });
