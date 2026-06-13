/* Brain2 Console — organization graph data.
   Workspaces + vaults mirror Settings → Workspaces (workspaces.jsx INITIAL_WS);
   people / groups / guests mirror Settings → People (settings.jsx seeds).
   Loaded after wiki-data.js — wiki-backed vaults pull their pages from WIKI_TREE. */

// ── workspaces & vaults (color = workspace identity in the graph) ───────────
const ORG_WS = [
  { id: 'default', name: 'default', color: { dark: '#7C8CFF', light: '#5466E5' }, vaults: [
    { id: 'v_general', name: 'General', mode: 'wiki', items: 142 },
    { id: 'v_fin', name: 'Q2 Financials', mode: 'static', items: 38 },
  ] },
  { id: 'research-q3', name: 'research-q3', color: { dark: '#34D399', light: '#0E9F6E' }, vaults: [
    { id: 'v_research', name: 'User Research', mode: 'wiki', items: 98 },
    { id: 'v_launch', name: 'Launch Docs', mode: 'static', items: 34 },
  ] },
  { id: 'engineering', name: 'engineering', color: { dark: '#E8A33D', light: '#B26E0E' }, vaults: [
    { id: 'v_gateway', name: 'LLM Gateway', mode: 'dynamic', items: 21 },
    { id: 'v_runbooks', name: 'Infra Runbooks', mode: 'wiki', items: 47 },
  ] },
  { id: 'personal', name: 'personal', private: true, color: { dark: '#F07EA8', light: '#C23D6B' }, vaults: [
    { id: 'v_notes', name: 'Personal Notes', mode: 'wiki', items: 16 },
  ] },
];

const ORG_VAULT_INDEX = {};
ORG_WS.forEach((ws) => ws.vaults.forEach((v) => { ORG_VAULT_INDEX[v.id] = { ...v, ws: ws.id, wsName: ws.name }; }));
const vaultWsOf = (vid) => (ORG_VAULT_INDEX[vid] || {}).ws;

function ogWsColor(wsId, theme) {
  const ws = ORG_WS.find((w) => w.id === wsId);
  return ws ? ws.color[theme === 'light' ? 'light' : 'dark'] : 'var(--fg-muted)';
}

// ── pages per vault — wiki-backed vaults read straight from WIKI_TREE ───────
const ogPagesFromWiki = (project) => ({
  pages: (WIKI_TREE.find((g) => g.project === project) || { pages: [] }).pages.map((p) => p.topic),
  links: (WIKI_GRAPH_LINKS[project] || []).slice(),
});
const ORG_VAULT_PAGES = {
  v_general: ogPagesFromWiki('default'),
  v_research: ogPagesFromWiki('research-q3'),
  v_gateway: ogPagesFromWiki('launch-docs'),
  v_fin: { pages: ['P&L summary', 'Revenue model', 'Burn & runway', 'Vendor contracts'],
    links: [['P&L summary', 'Revenue model'], ['P&L summary', 'Burn & runway']] },
  v_launch: { pages: ['Launch plan', 'Timeline', 'Press kit', 'FAQ'],
    links: [['Launch plan', 'Timeline'], ['Launch plan', 'Press kit'], ['Press kit', 'FAQ']] },
  v_runbooks: { pages: ['Incident response', 'On-call rotation', 'Deploy pipeline', 'Postgres failover', 'Backups'],
    links: [['Incident response', 'On-call rotation'], ['Incident response', 'Deploy pipeline'], ['Deploy pipeline', 'Postgres failover'], ['Postgres failover', 'Backups']] },
  v_notes: { pages: ['Reading list', 'Ideas', '1:1 notes'], links: [['Ideas', 'Reading list']] },
};

// ── sources per vault — the files a page is grounded in. A source can be cited
//    by several pages, so source nodes weave page clusters together. type drives
//    the node glyph: pdf / img / data / code / doc. ───────────────────────────
const ORG_VAULT_SOURCES = {
  v_general: [
    { id: 's_hooke', name: 'Hooke 1665.pdf', type: 'pdf', cites: ['Cell theory', 'Micrographia', 'Robert Hooke'] },
    { id: 's_schwann', name: 'schwann-1839.pdf', type: 'pdf', cites: ['Cell theory', 'Schwann & Schleiden'] },
    { id: 's_celldiag', name: 'cell-diagram.png', type: 'img', cites: ['Cell membrane', 'Organelles'] },
    { id: 's_brenner', name: 'brenner-1974.pdf', type: 'pdf', cites: ['DNA', 'Bacteria'] },
  ],
  v_research: [
    { id: 's_survey', name: 'survey-export.csv', type: 'data', cites: ['Survey results', 'User research Q3', 'Churn analysis'] },
    { id: 's_interviews', name: 'interviews.zip', type: 'doc', cites: ['User research Q3', 'Personas'] },
    { id: 's_pricing', name: 'pricing-benchmark.xlsx', type: 'data', cites: ['Pricing study', 'Churn analysis'] },
  ],
  v_gateway: [
    { id: 's_gatewaypy', name: 'gateway.py', type: 'code', cites: ['LLM Gateway', 'Routing', 'Failover'] },
    { id: 's_openapi', name: 'openapi.yaml', type: 'code', cites: ['LLM Gateway', 'Auth & keys', 'Python SDK'] },
    { id: 's_grafana', name: 'grafana.json', type: 'data', cites: ['Observability', 'Rate limiting'] },
  ],
  v_fin: [
    { id: 's_actuals', name: 'Q2-actuals.xlsx', type: 'data', cites: ['P&L summary', 'Burn & runway'] },
    { id: 's_board', name: 'board-deck.pdf', type: 'pdf', cites: ['Revenue model', 'P&L summary'] },
    { id: 's_msa', name: 'vendor-MSA.pdf', type: 'pdf', cites: ['Vendor contracts'] },
  ],
  v_launch: [
    { id: 's_gtm', name: 'gtm-brief.docx', type: 'doc', cites: ['Launch plan', 'Timeline'] },
    { id: 's_press', name: 'press-release.docx', type: 'doc', cites: ['Press kit', 'FAQ'] },
  ],
  v_runbooks: [
    { id: 's_pager', name: 'pagerduty.json', type: 'data', cites: ['Incident response', 'On-call rotation'] },
    { id: 's_postmortem', name: 'postmortem-2025.pdf', type: 'pdf', cites: ['Postgres failover', 'Backups', 'Incident response'] },
  ],
  v_notes: [
    { id: 's_bookmarks', name: 'bookmarks.html', type: 'doc', cites: ['Reading list', 'Ideas'] },
  ],
};
const orgVaultSources = (vid) => ORG_VAULT_SOURCES[vid] || [];
const orgPageSources = (vid, title) => orgVaultSources(vid).filter((s) => s.cites.includes(title));
const ORG_SRC_GLYPH = { pdf: 'file', img: 'image', data: 'hash', code: 'code', doc: 'clipboard' };
// page "mode" follows the vault it lives in
const orgVaultMode = (vid) => (ORG_VAULT_INDEX[vid] || {}).mode || 'wiki';


// ── people directory ─────────────────────────────────────────────────────────
const ORG_DIR = {
  alice: { name: 'Alice Chen', email: 'alice@brain2.dev' },
  bob:   { name: 'Bob Ng', email: 'bob@brain2.dev' },
  carol: { name: 'Carol Diaz', email: 'carol@brain2.dev' },
  dan:   { name: 'Dan Park', email: 'dan@brain2.dev' },
  eve:   { name: 'Eve Liu', email: 'eve@brain2.dev' },
  frank: { name: 'Frank Oyelaran', email: 'frank@brain2.dev' },
  grace: { name: 'Grace Kim', email: 'grace@brain2.dev' },
  henry: { name: 'Henry Voss', email: 'henry@brain2.dev' },
  mia:   { name: 'Mia Tran', email: 'mia@partner.io' },
  leo:   { name: 'Leo Marsh', email: 'leo@contractor.dev' },
};

// direct per-workspace grants (group-inherited access is NOT repeated here)
const ORG_MEMBERS = [
  { u: 'alice', owner: true, ws: [{ w: 'default', role: 'Owner' }, { w: 'research-q3', role: 'Admin' }, { w: 'engineering', role: 'Viewer' }, { w: 'personal', role: 'Owner' }] },
  { u: 'bob', ws: [{ w: 'engineering', role: 'Admin' }, { w: 'default', role: 'Member' }, { w: 'research-q3', role: 'Member' }] },
  { u: 'grace', ws: [{ w: 'engineering', role: 'Admin' }] },
  { u: 'carol', ws: [{ w: 'default', role: 'Member' }] },
  { u: 'eve', ws: [] },
  { u: 'frank', ws: [{ w: 'engineering', role: 'Member' }] },
  { u: 'henry', ws: [{ w: 'engineering', role: 'Member' }] },
  { u: 'dan', invited: true, ws: [{ w: 'default', role: 'Member' }] },
];

// groups carry per-workspace roles; members inherit them (color = group identity)
const ORG_GROUPS = [
  { id: 'research-team', name: 'Research team', color: { dark: '#4CC3E8', light: '#0E87A8' },
    ws: [{ w: 'research-q3', role: 'Member' }, { w: 'default', role: 'Member' }], members: ['carol', 'eve', 'frank'] },
  { id: 'eng-leads', name: 'Engineering leads', color: { dark: '#B58CFA', light: '#7C3AED' },
    ws: [{ w: 'engineering', role: 'Admin' }, { w: 'default', role: 'Member' }], members: ['grace', 'henry'] },
];
function ogGroupColor(gid, theme) {
  const g = ORG_GROUPS.find((x) => x.id === gid);
  return g ? g.color[theme === 'light' ? 'light' : 'dark'] : 'var(--fg-muted)';
}

// external guests — vault-level shares only, no workspace membership
const ORG_GUESTS = [
  { u: 'mia', vaults: [{ v: 'v_research', level: 'Viewer' }] },
  { u: 'leo', vaults: [{ v: 'v_runbooks', level: 'Editor' }, { v: 'v_general', level: 'Viewer' }] },
];

// ── access resolution ────────────────────────────────────────────────────────
const ORG_ROLE_RANK = { Owner: 4, Admin: 3, Editor: 2, Member: 2, Viewer: 1 };

// person → effective workspace roles (direct beats group only if higher rank)
function orgPersonAccess(u) {
  const m = ORG_MEMBERS.find((x) => x.u === u);
  const rows = {};
  if (m) for (const r of m.ws) rows[r.w] = { role: r.role, via: null, viaId: null };
  const groups = ORG_GROUPS.filter((g) => g.members.includes(u));
  for (const g of groups) for (const r of g.ws) {
    const cur = rows[r.w];
    if (!cur || ORG_ROLE_RANK[r.role] > ORG_ROLE_RANK[cur.role]) rows[r.w] = { role: r.role, via: g.name, viaId: g.id };
  }
  const wsRows = ORG_WS.filter((w) => rows[w.id]).map((w) => ({ w: w.id, ...rows[w.id] }));
  const vaults = wsRows.flatMap((r) => (ORG_WS.find((x) => x.id === r.w) || { vaults: [] }).vaults.map((v) => v.id));
  const guest = ORG_GUESTS.find((g) => g.u === u);
  return { wsRows, groups, vaults, guestVaults: guest ? guest.vaults : [] };
}

function orgWsMembers(wsId) {
  return ORG_MEMBERS.map((m) => {
    const row = orgPersonAccess(m.u).wsRows.find((r) => r.w === wsId);
    return row ? { u: m.u, role: row.role, via: row.via, viaId: row.viaId, invited: m.invited } : null;
  }).filter(Boolean).sort((a, b) => ORG_ROLE_RANK[b.role] - ORG_ROLE_RANK[a.role]);
}

function orgVaultPeople(vaultId) {
  const ws = vaultWsOf(vaultId);
  return {
    members: orgWsMembers(ws),
    guests: ORG_GUESTS.map((g) => { const s = g.vaults.find((x) => x.v === vaultId); return s ? { u: g.u, level: s.level } : null; }).filter(Boolean),
  };
}

Object.assign(window, { ORG_WS, ORG_VAULT_INDEX, vaultWsOf, ogWsColor, ORG_VAULT_PAGES, ORG_VAULT_SOURCES, orgVaultSources, orgPageSources, ORG_SRC_GLYPH, orgVaultMode, ORG_DIR, ORG_MEMBERS, ORG_GROUPS, ogGroupColor, ORG_GUESTS, ORG_ROLE_RANK, orgPersonAccess, orgWsMembers, orgVaultPeople });
