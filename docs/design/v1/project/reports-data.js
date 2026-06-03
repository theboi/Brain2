/* Brain2 Console — Reports / Studio data.
   Output formats, the active user persona, AI-suggested report types,
   the full catalog, and recently generated reports. Plain JS → window. */

// ── Output formats a report can be generated as ───────────────────────────
const REPORT_FORMATS = [
  { id: 'doc',   label: 'Document', sub: 'DOCX · Markdown',     icon: 'file',         blurb: 'Long-form, fully cited narrative' },
  { id: 'deck',  label: 'Deck',     sub: 'Slides · PDF',         icon: 'presentation', blurb: 'Board-ready slides, one idea per page' },
  { id: 'video', label: 'Video',    sub: 'Narrated overview',    icon: 'play',         blurb: 'A short narrated walkthrough to share' },
];

// ── Who we are suggesting for ──────────────────────────────────────────────
const REPORT_PERSONA = {
  name: 'Alice',
  role: 'Operations & Finance Lead',
  workspace: 'default',
  basis: 'Tuned to your role, the sources you own, and what you open most',
  signals: ['Owns 12 finance sources', 'Opens Q2 docs daily', 'Board meeting in 6 days'],
};

// ── AI-suggested report types (persona-ranked) ─────────────────────────────
// tone uses the shared semantic keys (accent / success / warning / muted).
const SUGGESTED_REPORTS = [
  {
    id: 'fin-q2', title: 'Q2 Financial Report', icon: 'barChart', tone: 'accent',
    desc: 'P&L, burn and runway with every figure cited back to your finance sources.',
    formats: ['doc', 'deck'], best: 'doc', sources: 12, est: '~2 min', category: 'Financial',
    why: 'You own the finance sources and open the Q2 folder daily.', match: 98,
  },
  {
    id: 'board', title: 'Board Briefing', icon: 'briefcase', tone: 'accent',
    desc: 'A one-page executive summary of the quarter, written for your board.',
    formats: ['deck', 'doc'], best: 'deck', sources: 24, est: '~3 min', category: 'Executive',
    why: 'Board meeting in 6 days, per your linked calendar.', match: 95,
  },
  {
    id: 'sales', title: 'Sales Performance Summary', icon: 'trendingUp', tone: 'success',
    desc: 'Pipeline, wins and churn for the month, broken down by segment.',
    formats: ['doc', 'deck'], best: 'doc', sources: 9, est: '~2 min', category: 'Financial',
    why: 'Pulls from the sales dashboards you ingested last week.', match: 88,
  },
  {
    id: 'video-q2', title: 'Q2 Earnings Walkthrough', icon: 'play', tone: 'warning',
    desc: 'A 4-minute narrated overview of the quarter, ready to send to the team.',
    formats: ['video'], best: 'video', sources: 12, est: '~6 min', category: 'Executive',
    why: 'New — turn your Q2 numbers into something shareable.', match: 84, isNew: true,
  },
  {
    id: 'headcount', title: 'Headcount & Cost Snapshot', icon: 'users', tone: 'muted',
    desc: 'Team size and spend versus plan, with a hiring-vs-attrition view.',
    formats: ['doc', 'deck'], best: 'doc', sources: 6, est: '~90 s', category: 'Operations',
    why: 'Frequently requested in your weekly ops review.', match: 79,
  },
  {
    id: 'investor', title: 'Investor Update', icon: 'mail', tone: 'muted',
    desc: 'Monthly update with metrics, highlights, lowlights and a clear ask.',
    formats: ['doc'], best: 'doc', sources: 18, est: '~2 min', category: 'Executive',
    why: 'Matches the cadence of your last three updates.', match: 74,
  },
];

// ── Full catalog, grouped — what you get under “Browse all report types” ──
const REPORT_CATALOG = [
  { category: 'Financial', types: [
    { id: 'revenue', title: 'Revenue Breakdown', icon: 'barChart', formats: ['doc', 'deck'] },
    { id: 'burn', title: 'Burn & Runway', icon: 'trendingUp', formats: ['doc', 'deck'] },
    { id: 'expense', title: 'Expense Audit', icon: 'clipboard', formats: ['doc'] },
  ] },
  { category: 'Operations', types: [
    { id: 'ops-weekly', title: 'Weekly Ops Review', icon: 'calendar', formats: ['doc', 'deck'] },
    { id: 'postmortem', title: 'Incident Postmortem', icon: 'alert', formats: ['doc'] },
    { id: 'sla', title: 'SLA & Uptime Report', icon: 'shield', formats: ['doc', 'deck'] },
  ] },
  { category: 'Customer', types: [
    { id: 'voc', title: 'Voice-of-Customer Summary', icon: 'chats', formats: ['doc', 'deck', 'video'] },
    { id: 'support', title: 'Support Trends', icon: 'users', formats: ['doc'] },
    { id: 'churn', title: 'Churn Analysis', icon: 'trendingUp', formats: ['doc', 'deck'] },
  ] },
  { category: 'Knowledge', types: [
    { id: 'research', title: 'Research Digest', icon: 'sparkles', formats: ['doc', 'video'] },
    { id: 'litreview', title: 'Literature Review', icon: 'wiki', formats: ['doc'] },
    { id: 'landscape', title: 'Competitive Landscape', icon: 'globe', formats: ['doc', 'deck'] },
  ] },
];

// ── Recently generated reports (history) ───────────────────────────────────
const RECENT_REPORTS = [
  { id: 'r1', title: 'Q1 Financial Report', format: 'doc',   when: '3 weeks ago', meta: '14 pages · 12 sources', status: 'ready' },
  { id: 'r2', title: 'March Sales Summary', format: 'doc',   when: 'Apr 2',       meta: '8 pages · 9 sources',   status: 'ready' },
  { id: 'r3', title: 'Board pack · Q1',     format: 'deck',  when: 'Mar 28',      meta: '11 slides',             status: 'ready' },
  { id: 'r4', title: 'Annual review',       format: 'video', when: 'Jan 12',      meta: '5 min · narrated',      status: 'ready' },
];

const QUICK_PROMPTS = [
  'Summarise Q2 finances for the board',
  'Compare this month’s sales to last',
  'Where are we over budget?',
];

Object.assign(window, {
  REPORT_FORMATS, REPORT_PERSONA, SUGGESTED_REPORTS, REPORT_CATALOG, RECENT_REPORTS, QUICK_PROMPTS,
});
