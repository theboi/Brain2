import type { OrgGraphResponse, VaultGraphResponse } from '@/lib/types';
import {
  ORG_DIR,
  ORG_GUESTS,
  ORG_GROUPS,
  ORG_MEMBERS,
  ORG_VAULT_INDEX,
  ORG_VAULT_PAGES,
  ORG_VAULT_SOURCES,
  ORG_WS,
  type OrgSource,
} from './mockData';

const COLORS = [
  ['#7C8CFF', '#5466E5'],
  ['#34D399', '#0E9F6E'],
  ['#E8A33D', '#B26E0E'],
  ['#F07EA8', '#C23D6B'],
  ['#4CC3E8', '#0E87A8'],
  ['#B58CFA', '#7C3AED'],
] as const;

function titleRole(role: string): string {
  return role ? role[0].toUpperCase() + role.slice(1) : role;
}

function sourceType(src: { mime: string | null; kind: string | null; name: string }): OrgSource['type'] {
  if (src.mime?.startsWith('image/')) return 'img';
  if (src.mime?.includes('pdf')) return 'pdf';
  if (src.name.match(/\.(csv|tsv|xlsx?|json)$/i)) return 'data';
  if (src.name.match(/\.(py|ts|tsx|js|jsx|sql|yaml|yml)$/i)) return 'code';
  return 'doc';
}

function resetRecord<T>(target: Record<string, T>, next: Record<string, T>) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, next);
}

export function installOrgGraphData(resp: OrgGraphResponse): void {
  ORG_WS.splice(0, ORG_WS.length, ...resp.workspaces.map((ws, idx) => {
    const [dark, light] = COLORS[idx % COLORS.length];
    return {
      id: ws.id,
      name: ws.name,
      color: { dark, light },
      vaults: ws.vaults.map((v) => ({
        id: v.id,
        name: v.name,
        mode: v.mode,
        items: v.items,
      })),
    };
  }));
  const vaultIndex: typeof ORG_VAULT_INDEX = {};
  ORG_WS.forEach((ws) => ws.vaults.forEach((v) => {
    vaultIndex[v.id] = { ...v, ws: ws.id, wsName: ws.name };
  }));
  resetRecord(ORG_VAULT_INDEX, vaultIndex);
  resetRecord(ORG_VAULT_PAGES, resp.vault_pages);
  resetRecord(ORG_DIR, resp.people);
  resetRecord(ORG_VAULT_SOURCES, Object.fromEntries(
    Object.entries(resp.vault_sources).map(([vaultId, rows]) => [vaultId, rows.map((src) => ({
      id: src.id,
      name: src.name,
      type: sourceType(src),
      cites: src.cites,
    }))]),
  ));
  ORG_MEMBERS.splice(0, ORG_MEMBERS.length, ...resp.members.map((m) => ({
    u: m.u,
    owner: m.owner,
    invited: m.invited,
    ws: m.ws.map((r) => ({ w: r.w, role: titleRole(r.role) })),
  })));
  ORG_GROUPS.splice(0, ORG_GROUPS.length, ...resp.groups.map((g, idx) => {
    const [dark, light] = COLORS[(idx + 4) % COLORS.length];
    return {
      id: g.id,
      name: g.name,
      color: { dark, light },
      ws: g.ws.map((r) => ({ w: r.w, role: titleRole(r.role) })),
      members: g.members,
    };
  }));
  ORG_GUESTS.splice(0, ORG_GUESTS.length, ...resp.guests.map((g) => ({
    u: g.u,
    vaults: g.vaults.map((v) => ({ v: v.v, level: titleRole(v.level) })),
  })));
}

export function installVaultGraphData(resp: VaultGraphResponse): void {
  const wsId = 'vault-scope';
  const existingWs = ORG_WS.find((ws) => ws.id === wsId);
  const vault = {
    id: resp.vault.id,
    name: resp.vault.name,
    mode: resp.vault.mode,
    items: resp.pages.length,
  };
  if (existingWs) existingWs.vaults = [vault];
  else ORG_WS.push({
    id: wsId,
    name: 'Current vault',
    color: { dark: '#7C8CFF', light: '#5466E5' },
    vaults: [vault],
  });
  ORG_VAULT_INDEX[resp.vault.id] = { ...vault, ws: wsId, wsName: 'Current vault' };
  ORG_VAULT_PAGES[resp.vault.id] = { pages: resp.pages, links: resp.links };
  ORG_VAULT_SOURCES[resp.vault.id] = resp.sources.map((src) => ({
    id: src.id,
    name: src.name,
    type: sourceType(src),
    cites: src.cites,
  }));
}
