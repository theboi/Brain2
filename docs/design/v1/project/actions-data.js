/* Brain2 Console — plugin Action registry.

   Each installed plugin registers Action cards. An Action declares the
   PARAMETERS it exposes and a buildPrompt() template; changing a parameter
   rewrites the LLM prompt draft that the Generate overlay submits to the
   chosen agent. The Home quick-action tiles and the Reports cards are both
   just instances of these registered Actions — same schema, same overlay. */

// Pick the default value for each parameter (explicit default, else first option).
function paramDefaults(params) {
  const out = {};
  (params || []).forEach((p) => { out[p.id] = p.default != null ? p.default : (p.options[0] && p.options[0].id); });
  return out;
}

// ── Per-plugin parameter schemas + prompt templates ────────────────────────
// A plugin owns one schema; every Action that plugin registers reuses it.
const PLUGIN_SPECS = {
  Reports: {
    icon: 'file',
    defaultRunner: 'Researcher',
    params: [
      { id: 'format', label: 'Document type', icon: 'file', default: 'doc', options: [
        { id: 'doc', label: 'Document', hint: 'DOCX · Markdown' },
        { id: 'deck', label: 'Deck', hint: 'Slides · PDF' },
        { id: 'video', label: 'Video', hint: 'Narrated overview' },
      ] },
      { id: 'period', label: 'Period', icon: 'calendar', default: 'q2', options: [
        { id: 'q2', label: 'Q2 FY26' }, { id: 'q1', label: 'Q1 FY26' },
        { id: 'month', label: 'This month' }, { id: 'ytd', label: 'Year to date' },
      ] },
      { id: 'audience', label: 'Audience', icon: 'users', default: 'board', options: [
        { id: 'board', label: 'Board' }, { id: 'exec', label: 'Exec team' },
        { id: 'team', label: 'Wider team' }, { id: 'investors', label: 'Investors' },
      ] },
      { id: 'depth', label: 'Depth', icon: 'layers', default: 'standard', options: [
        { id: 'brief', label: 'One-pager' }, { id: 'standard', label: 'Standard' },
        { id: 'deep', label: 'Deep dive' },
      ] },
    ],
    buildPrompt: (ctx, v) => {
      const fmt = { doc: 'a fully-cited document (DOCX / Markdown)', deck: 'a board-ready slide deck', video: 'a short narrated video walkthrough' }[v.format];
      const period = { q2: 'Q2 FY26', q1: 'Q1 FY26', month: 'this month', ytd: 'the year so far' }[v.period];
      const aud = { board: 'the board', exec: 'the exec team', team: 'the wider team', investors: 'investors' }[v.audience];
      const depth = { brief: 'Keep it to a single page of headline numbers.', standard: 'Use the standard sections and length.', deep: 'Go deep: full breakdowns, method notes and an appendix.' }[v.depth];
      const subject = ctx.title || 'report';
      const cov = ctx.coverage ? ctx.coverage + ' ' : '';
      const src = ctx.sources ? `${ctx.sources} cited sources` : 'cited sources';
      return `Generate ${fmt} for ${aud} — “${subject}”, covering ${period}.\n\n${cov}Pull every figure from ${src} and reference each one inline. ${depth}`;
    },
  },

  'Query Desk': {
    icon: 'users',
    defaultRunner: 'Researcher',
    params: [
      { id: 'scope', label: 'Which queries', icon: 'chats', default: 'waiting', options: [
        { id: 'waiting', label: 'All waiting' }, { id: 'unanswered', label: 'Unanswered only' },
        { id: 'priority', label: 'High-priority' },
      ] },
      { id: 'tone', label: 'Tone', icon: 'sparkles', default: 'friendly', options: [
        { id: 'friendly', label: 'Friendly' }, { id: 'formal', label: 'Formal' },
        { id: 'concise', label: 'Concise' },
      ] },
      { id: 'approval', label: 'After drafting', icon: 'check', default: 'queue', options: [
        { id: 'queue', label: 'Queue for approval' }, { id: 'draft', label: 'Leave as drafts' },
      ] },
    ],
    buildPrompt: (ctx, v) => {
      const scope = { waiting: 'all waiting', unanswered: 'only the still-unanswered', priority: 'the highest-priority' }[v.scope];
      const tone = { friendly: 'a warm, friendly', formal: 'a formal, professional', concise: 'a short, to-the-point' }[v.tone];
      const approval = { queue: 'Queue each draft for one-click approval before anything sends.', draft: 'Leave them as drafts for me to review — send nothing automatically.' }[v.approval];
      return `Draft replies to ${scope} customer queries in ${tone} tone.\n\nCite the wiki pages and sources behind every answer, and flag any question with no supporting source. ${approval}`;
    },
  },

  'Citations Guard': {
    icon: 'shield',
    defaultRunner: 'Archivist',
    params: [
      { id: 'scope', label: 'Pages to check', icon: 'wiki', default: 'all', options: [
        { id: 'all', label: 'All pages' }, { id: 'week', label: 'Changed this week' },
        { id: 'flagged', label: 'Already flagged' },
      ] },
      { id: 'severity', label: 'Surface', icon: 'alert', default: 'all', options: [
        { id: 'all', label: 'Uncited + contradicted' }, { id: 'uncited', label: 'Uncited only' },
        { id: 'contradicted', label: 'Contradicted only' },
      ] },
      { id: 'output', label: 'Then', icon: 'clipboard', default: 'report', options: [
        { id: 'report', label: 'Compile a review list' }, { id: 'fix', label: 'Suggest sourced fixes' },
      ] },
    ],
    buildPrompt: (ctx, v) => {
      const scope = { all: 'all 312 wiki pages', week: 'pages changed in the last week', flagged: 'pages already flagged for review' }[v.scope];
      const sev = { all: 'every uncited or source-contradicted claim', uncited: 'claims with no citation at all', contradicted: 'claims a cited source actually contradicts' }[v.severity];
      const out = { report: 'Compile the findings into a single review list.', fix: 'For each one, suggest a sourced fix I can accept.' }[v.output];
      return `Audit the wiki for unsupported claims across ${scope}.\n\nSurface ${sev}, each with the page, the exact claim, and the missing or contradicting source. ${out}`;
    },
  },

  Digest: {
    icon: 'mail',
    defaultRunner: 'Summariser',
    params: [
      { id: 'cadence', label: 'Cover', icon: 'calendar', default: 'week', options: [
        { id: 'week', label: 'This week' }, { id: 'month', label: 'This month' },
      ] },
      { id: 'channel', label: 'Send via', icon: 'send', default: 'email', options: [
        { id: 'email', label: 'Email' }, { id: 'telegram', label: 'Telegram' },
      ] },
      { id: 'audience', label: 'To', icon: 'users', default: 'exec', options: [
        { id: 'exec', label: 'Exec team · 4' }, { id: 'all', label: 'All members' },
      ] },
    ],
    buildPrompt: (ctx, v) => {
      const cadence = { week: "this week's", month: "this month's" }[v.cadence];
      const channel = { email: 'email', telegram: 'the linked Telegram bot' }[v.channel];
      const aud = { exec: 'the exec team (4 people)', all: 'all workspace members' }[v.audience];
      return `Compile ${cadence} executive digest of ingests, audits and agent activity.\n\nKeep it skimmable — highlights first, detail below — then send it via ${channel} to ${aud}.`;
    },
  },

  'Web Crawler': {
    icon: 'globe',
    defaultRunner: 'Editor',
    params: [
      { id: 'scope', label: 'Sources', icon: 'globe', default: 'all', options: [
        { id: 'all', label: 'All tracked' }, { id: 'stale', label: 'Stale only' },
        { id: 'watch', label: 'Watch-list' },
      ] },
      { id: 'depth', label: 'Crawl depth', icon: 'layers', default: 'shallow', options: [
        { id: 'shallow', label: 'Top-level' }, { id: 'full', label: 'Follow links' },
      ] },
      { id: 'when', label: 'Run', icon: 'clock', default: 'now', options: [
        { id: 'now', label: 'Once, now' }, { id: 'schedule', label: 'On schedule' },
      ] },
    ],
    buildPrompt: (ctx, v) => {
      const scope = { all: 'all 1,284 tracked sources', stale: 'sources flagged as stale', watch: 'the priority watch-list' }[v.scope];
      const depth = { shallow: 'top-level pages only', full: 'following links to full depth' }[v.depth];
      const when = { now: ' Run this once, now.', schedule: ' Set this to repeat on the current re-crawl schedule.' }[v.when];
      return `Re-crawl ${scope}, ${depth}.\n\nRe-ingest only the pages that changed since the last run and refresh their wiki entries.${when}`;
    },
  },
};

// Extra context for Home tiles that map onto a plugin spec.
const HOME_ACTION_CTX = {
  'fin-q2':  { title: 'Financial report', coverage: 'Cover P&L, burn and runway.', sources: 12, runner: 'Researcher', initial: { period: 'q2' } },
  'queries': { runner: 'Researcher' },
  'audit':   { runner: 'Archivist' },
  'digest':  { runner: 'Summariser' },
  'recrawl': { runner: 'Editor' },
};

// ── Action factories — turn a card's data into a Generate-overlay config ────

// A suggested / catalog report card → an Action instance.
function reportActionConfig(r, fmt) {
  const spec = PLUGIN_SPECS.Reports;
  return {
    id: r.id, plugin: 'Reports', pluginIcon: spec.icon, icon: r.icon, tone: r.tone || 'accent',
    title: r.title, runner: spec.defaultRunner, est: r.est, sources: r.sources, coverage: r.desc,
    params: spec.params,
    initial: { ...paramDefaults(spec.params), format: fmt || r.best },
    buildPrompt: (v) => spec.buildPrompt({ title: r.title, sources: r.sources, coverage: r.desc }, v),
  };
}

// The free-text custom report composer → an Action instance.
function customReportConfig(text, fmt) {
  const spec = PLUGIN_SPECS.Reports;
  const raw = (text || '').trim();
  const body = raw || 'Summarise the most important numbers for the period.';
  const coverage = /[.!?]$/.test(body) ? body : body + '.';
  return {
    id: 'custom', plugin: 'Reports', pluginIcon: spec.icon, icon: 'wand', tone: 'accent',
    title: 'Custom report', runner: spec.defaultRunner, est: '~2 min', sources: 12, coverage,
    params: spec.params,
    initial: { ...paramDefaults(spec.params), format: fmt || 'doc' },
    buildPrompt: (v) => spec.buildPrompt({ title: 'custom report', sources: 12, coverage }, v),
  };
}

// A Home quick-action tile → an Action instance.
function homeActionConfig(a) {
  // If this id is a known report (Reports page data is loaded), reuse it.
  const reports = (typeof window !== 'undefined' && window.SUGGESTED_REPORTS) || [];
  const rep = reports.find((r) => r.id === a.id);
  if (rep) return reportActionConfig(rep, rep.best);

  const spec = PLUGIN_SPECS[a.plugin] || PLUGIN_SPECS.Reports;
  const ctx = HOME_ACTION_CTX[a.id] || {};
  return {
    id: a.id, plugin: a.plugin, pluginIcon: spec.icon, icon: a.icon, tone: a.tone || 'accent',
    title: a.title, runner: ctx.runner || a.runner || spec.defaultRunner, est: a.est,
    sources: ctx.sources, coverage: ctx.coverage,
    params: spec.params,
    initial: { ...paramDefaults(spec.params), ...(ctx.initial || {}) },
    buildPrompt: (v) => spec.buildPrompt({ title: ctx.title || a.title, sources: ctx.sources, coverage: ctx.coverage }, v),
  };
}

Object.assign(window, {
  PLUGIN_SPECS, HOME_ACTION_CTX, paramDefaults,
  reportActionConfig, customReportConfig, homeActionConfig,
});
