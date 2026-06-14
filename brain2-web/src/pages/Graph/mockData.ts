/* Brain2 Console — organization graph mock data.
   Mirrors docs/design/v1/project/org-graph-data.js as TypeScript types + data. */

// ── types ─────────────────────────────────────────────────────────────────────
export interface OrgVault { id: string; name: string; mode: 'wiki' | 'static' | 'dynamic'; items: number; }
export interface OrgWs { id: string; name: string; private?: boolean; color: { dark: string; light: string }; vaults: OrgVault[]; }

export interface OrgDirEntry { name: string; email: string; }
export interface OrgWsRole { w: string; role: string; }
export interface OrgMember { u: string; owner?: boolean; invited?: boolean; ws: OrgWsRole[]; }
export interface OrgGroup { id: string; name: string; color: { dark: string; light: string }; ws: OrgWsRole[]; members: string[]; }
export interface OrgGuestVault { v: string; level: string; }
export interface OrgGuest { u: string; vaults: OrgGuestVault[]; }
export interface OrgSource { id: string; name: string; type: 'pdf' | 'img' | 'data' | 'code' | 'doc'; cites: string[]; }
export interface OrgVaultPages { pages: string[]; links: [string, string][]; }

// ── workspaces & vaults ───────────────────────────────────────────────────────
export const ORG_WS: OrgWs[] = [
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

export const ORG_VAULT_INDEX: Record<string, OrgVault & { ws: string; wsName: string }> = {};
ORG_WS.forEach((ws) => ws.vaults.forEach((v) => {
  ORG_VAULT_INDEX[v.id] = { ...v, ws: ws.id, wsName: ws.name };
}));

export function vaultWsOf(vid: string): string { return ORG_VAULT_INDEX[vid]?.ws ?? ''; }
export function ogWsColor(wsId: string, theme: string): string {
  const ws = ORG_WS.find((w) => w.id === wsId);
  return ws ? ws.color[theme === 'light' ? 'light' : 'dark'] : 'var(--fg-muted)';
}

// ── pages per vault ───────────────────────────────────────────────────────────
export const ORG_VAULT_PAGES: Record<string, OrgVaultPages> = {
  v_general: {
    pages: ['Micrographia', 'Cell theory', 'Bacteria', 'Robert Hooke', 'Microscopy', 'Cell membrane', 'Organelles', 'Mitochondria', 'Schwann & Schleiden', 'Prokaryotes', 'DNA', 'Constitutional AI'],
    links: [['Cell theory','Micrographia'],['Cell theory','Bacteria'],['Cell theory','Organelles'],['Cell theory','Cell membrane'],['Cell theory','Schwann & Schleiden'],['Cell theory','Prokaryotes'],['Micrographia','Robert Hooke'],['Micrographia','Microscopy'],['Robert Hooke','Microscopy'],['Cell membrane','Organelles'],['Organelles','Mitochondria'],['DNA','Bacteria'],['DNA','Prokaryotes']],
  },
  v_research: {
    pages: ['Q3 themes','User research Q3','Personas','Churn analysis','Pricing study','Onboarding friction','Survey results'],
    links: [['User research Q3','Q3 themes'],['User research Q3','Personas'],['User research Q3','Churn analysis'],['User research Q3','Survey results'],['Churn analysis','Pricing study'],['Personas','Onboarding friction']],
  },
  v_gateway: {
    pages: ['LLM Gateway','Rate limiting','Auth & keys','Routing','Failover','Observability','Python SDK'],
    links: [['LLM Gateway','Rate limiting'],['LLM Gateway','Auth & keys'],['LLM Gateway','Routing'],['Routing','Failover'],['LLM Gateway','Observability'],['Auth & keys','Python SDK']],
  },
  v_fin: {
    pages: ['P&L summary','Revenue model','Burn & runway','Vendor contracts'],
    links: [['P&L summary','Revenue model'],['P&L summary','Burn & runway']],
  },
  v_launch: {
    pages: ['Launch plan','Timeline','Press kit','FAQ'],
    links: [['Launch plan','Timeline'],['Launch plan','Press kit'],['Press kit','FAQ']],
  },
  v_runbooks: {
    pages: ['Incident response','On-call rotation','Deploy pipeline','Postgres failover','Backups'],
    links: [['Incident response','On-call rotation'],['Incident response','Deploy pipeline'],['Deploy pipeline','Postgres failover'],['Postgres failover','Backups']],
  },
  v_notes: {
    pages: ['Reading list','Ideas','1:1 notes'],
    links: [['Ideas','Reading list']],
  },
};

// ── sources ───────────────────────────────────────────────────────────────────
export const ORG_VAULT_SOURCES: Record<string, OrgSource[]> = {
  v_general: [
    { id: 's_hooke', name: 'Hooke 1665.pdf', type: 'pdf', cites: ['Cell theory','Micrographia','Robert Hooke'] },
    { id: 's_schwann', name: 'schwann-1839.pdf', type: 'pdf', cites: ['Cell theory','Schwann & Schleiden'] },
    { id: 's_celldiag', name: 'cell-diagram.png', type: 'img', cites: ['Cell membrane','Organelles'] },
    { id: 's_brenner', name: 'brenner-1974.pdf', type: 'pdf', cites: ['DNA','Bacteria'] },
  ],
  v_research: [
    { id: 's_survey', name: 'survey-export.csv', type: 'data', cites: ['Survey results','User research Q3','Churn analysis'] },
    { id: 's_interviews', name: 'interviews.zip', type: 'doc', cites: ['User research Q3','Personas'] },
    { id: 's_pricing', name: 'pricing-benchmark.xlsx', type: 'data', cites: ['Pricing study','Churn analysis'] },
  ],
  v_gateway: [
    { id: 's_gatewaypy', name: 'gateway.py', type: 'code', cites: ['LLM Gateway','Routing','Failover'] },
    { id: 's_openapi', name: 'openapi.yaml', type: 'code', cites: ['LLM Gateway','Auth & keys','Python SDK'] },
    { id: 's_grafana', name: 'grafana.json', type: 'data', cites: ['Observability','Rate limiting'] },
  ],
  v_fin: [
    { id: 's_actuals', name: 'Q2-actuals.xlsx', type: 'data', cites: ['P&L summary','Burn & runway'] },
    { id: 's_board', name: 'board-deck.pdf', type: 'pdf', cites: ['Revenue model','P&L summary'] },
    { id: 's_msa', name: 'vendor-MSA.pdf', type: 'pdf', cites: ['Vendor contracts'] },
  ],
  v_launch: [
    { id: 's_gtm', name: 'gtm-brief.docx', type: 'doc', cites: ['Launch plan','Timeline'] },
    { id: 's_press', name: 'press-release.docx', type: 'doc', cites: ['Press kit','FAQ'] },
  ],
  v_runbooks: [
    { id: 's_pager', name: 'pagerduty.json', type: 'data', cites: ['Incident response','On-call rotation'] },
    { id: 's_postmortem', name: 'postmortem-2025.pdf', type: 'pdf', cites: ['Postgres failover','Backups','Incident response'] },
  ],
  v_notes: [
    { id: 's_bookmarks', name: 'bookmarks.html', type: 'doc', cites: ['Reading list','Ideas'] },
  ],
};
export const orgVaultSources = (vid: string): OrgSource[] => ORG_VAULT_SOURCES[vid] ?? [];
export const orgPageSources = (vid: string, title: string): OrgSource[] => orgVaultSources(vid).filter((s) => s.cites.includes(title));
export const ORG_SRC_GLYPH: Record<string, string> = { pdf: 'file', img: 'image', data: 'hash', code: 'code', doc: 'clipboard' };

// ── people ────────────────────────────────────────────────────────────────────
export const ORG_DIR: Record<string, OrgDirEntry> = {
  alice: { name: 'Alice Chen', email: 'alice@brain2.dev' },
  bob:   { name: 'Bob Ng',     email: 'bob@brain2.dev' },
  carol: { name: 'Carol Diaz', email: 'carol@brain2.dev' },
  dan:   { name: 'Dan Park',   email: 'dan@brain2.dev' },
  eve:   { name: 'Eve Liu',    email: 'eve@brain2.dev' },
  frank: { name: 'Frank Oyelaran', email: 'frank@brain2.dev' },
  grace: { name: 'Grace Kim',  email: 'grace@brain2.dev' },
  henry: { name: 'Henry Voss', email: 'henry@brain2.dev' },
  mia:   { name: 'Mia Tran',   email: 'mia@partner.io' },
  leo:   { name: 'Leo Marsh',  email: 'leo@contractor.dev' },
};

export const ORG_MEMBERS: OrgMember[] = [
  { u: 'alice', owner: true, ws: [{ w: 'default', role: 'Owner' },{ w: 'research-q3', role: 'Admin' },{ w: 'engineering', role: 'Viewer' },{ w: 'personal', role: 'Owner' }] },
  { u: 'bob',   ws: [{ w: 'engineering', role: 'Admin' },{ w: 'default', role: 'Member' },{ w: 'research-q3', role: 'Member' }] },
  { u: 'grace', ws: [{ w: 'engineering', role: 'Admin' }] },
  { u: 'carol', ws: [{ w: 'default', role: 'Member' }] },
  { u: 'eve',   ws: [] },
  { u: 'frank', ws: [{ w: 'engineering', role: 'Member' }] },
  { u: 'henry', ws: [{ w: 'engineering', role: 'Member' }] },
  { u: 'dan',   invited: true, ws: [{ w: 'default', role: 'Member' }] },
];

export const ORG_GROUPS: OrgGroup[] = [
  { id: 'research-team', name: 'Research team', color: { dark: '#4CC3E8', light: '#0E87A8' },
    ws: [{ w: 'research-q3', role: 'Member' },{ w: 'default', role: 'Member' }], members: ['carol','eve','frank'] },
  { id: 'eng-leads', name: 'Engineering leads', color: { dark: '#B58CFA', light: '#7C3AED' },
    ws: [{ w: 'engineering', role: 'Admin' },{ w: 'default', role: 'Member' }], members: ['grace','henry'] },
];

export const ORG_GUESTS: OrgGuest[] = [
  { u: 'mia', vaults: [{ v: 'v_research', level: 'Viewer' }] },
  { u: 'leo', vaults: [{ v: 'v_runbooks', level: 'Editor' },{ v: 'v_general', level: 'Viewer' }] },
];

export const ORG_ROLE_RANK: Record<string, number> = { Owner: 4, Admin: 3, Editor: 2, Member: 2, Viewer: 1 };

// ── access resolution ─────────────────────────────────────────────────────────
export interface PersonAccessRow { w: string; role: string; via: string | null; viaId: string | null; }
export interface PersonAccess {
  wsRows: PersonAccessRow[];
  groups: OrgGroup[];
  vaults: string[];
  guestVaults: OrgGuestVault[];
}

export function orgPersonAccess(u: string): PersonAccess {
  const m = ORG_MEMBERS.find((x) => x.u === u);
  const rows: Record<string, { role: string; via: string | null; viaId: string | null }> = {};
  if (m) for (const r of m.ws) rows[r.w] = { role: r.role, via: null, viaId: null };
  const groups = ORG_GROUPS.filter((g) => g.members.includes(u));
  for (const g of groups) for (const r of g.ws) {
    const cur = rows[r.w];
    if (!cur || ORG_ROLE_RANK[r.role] > ORG_ROLE_RANK[cur.role]) rows[r.w] = { role: r.role, via: g.name, viaId: g.id };
  }
  const wsRows = ORG_WS.filter((w) => rows[w.id]).map((w) => ({ w: w.id, ...rows[w.id] }));
  const vaults = wsRows.flatMap((r) => (ORG_WS.find((x) => x.id === r.w) ?? { vaults: [] }).vaults.map((v) => v.id));
  const guest = ORG_GUESTS.find((g) => g.u === u);
  return { wsRows, groups, vaults, guestVaults: guest ? guest.vaults : [] };
}

export interface WsMemberRow { u: string; role: string; via: string | null; viaId: string | null; invited?: boolean; }
export function orgWsMembers(wsId: string): WsMemberRow[] {
  const rows: WsMemberRow[] = ORG_MEMBERS.flatMap((m) => {
    const row = orgPersonAccess(m.u).wsRows.find((r) => r.w === wsId);
    return row ? [{ u: m.u, role: row.role, via: row.via, viaId: row.viaId, invited: m.invited }] : [];
  });
  return rows.sort((a, b) => ORG_ROLE_RANK[b.role] - ORG_ROLE_RANK[a.role]);
}

export interface VaultPeople { members: WsMemberRow[]; guests: { u: string; level: string }[]; }
export function orgVaultPeople(vaultId: string): VaultPeople {
  const ws = vaultWsOf(vaultId);
  return {
    members: orgWsMembers(ws),
    guests: ORG_GUESTS.map((g) => { const s = g.vaults.find((x) => x.v === vaultId); return s ? { u: g.u, level: s.level } : null; }).filter((x): x is { u: string; level: string } => x !== null),
  };
}
