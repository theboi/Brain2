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
export const ORG_WS: OrgWs[] = [];

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
export const ORG_VAULT_PAGES: Record<string, OrgVaultPages> = {};

// ── sources ───────────────────────────────────────────────────────────────────
export const ORG_VAULT_SOURCES: Record<string, OrgSource[]> = {};
export const orgVaultSources = (vid: string): OrgSource[] => ORG_VAULT_SOURCES[vid] ?? [];
export const orgPageSources = (vid: string, title: string): OrgSource[] => orgVaultSources(vid).filter((s) => s.cites.includes(title));
export const ORG_SRC_GLYPH: Record<string, string> = { pdf: 'file', img: 'image', data: 'hash', code: 'code', doc: 'clipboard' };

// ── people ────────────────────────────────────────────────────────────────────
export const ORG_DIR: Record<string, OrgDirEntry> = {};

export const ORG_MEMBERS: OrgMember[] = [];

export const ORG_GROUPS: OrgGroup[] = [];

export const ORG_GUESTS: OrgGuest[] = [];

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
