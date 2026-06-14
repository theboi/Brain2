/*
 * Brain2 Console — Organization graph view.
 * Faithful TypeScript port of docs/design/v1/project/org-graph.jsx +
 * org-inspector.jsx. Renders for two scopes:
 *   scope='org'     → full org: workspaces, vaults, pages, people, groups
 *   scope=<vaultId> → vault-scoped wiki-link graph (used by Wiki Graph tab)
 */
import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import {
  ORG_WS, ORG_VAULT_INDEX, ORG_VAULT_PAGES, ORG_VAULT_SOURCES,
  ORG_DIR, ORG_MEMBERS, ORG_GROUPS, ORG_GUESTS, ORG_ROLE_RANK,
  ORG_SRC_GLYPH,
  vaultWsOf, ogWsColor, orgVaultSources, orgPageSources,
  orgPersonAccess, orgWsMembers, orgVaultPeople,
} from './mockData';

// ── helpers ──────────────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  if (!hex || !hex.startsWith('#')) return `rgba(128,128,128,${alpha})`;
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function ogRand(seed: number) { let s = (seed >>> 0) || 1; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function ogHash(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const clampK = (k: number) => Math.min(2.6, Math.max(0.32, k));

// ── graph model ───────────────────────────────────────────────────────────────
type NodeKind = 'ws' | 'vault' | 'page' | 'source' | 'person' | 'guest' | 'group';
type LinkKind = 'tether' | 'wikilink' | 'vw' | 'access' | 'gaccess' | 'member' | 'guest' | 'cites' | 'stether';

interface OrgNode {
  id: string; kind: NodeKind; label: string; r: number;
  ws?: string; vault?: string; mode?: string; deg?: number;
  u?: string; group?: string; private?: boolean;
  invited?: boolean; owner?: boolean; hub?: boolean; items?: number;
  wsAll?: string[]; srcType?: string; srcId?: string;
}
interface OrgLink { s: string; t: string; kind: LinkKind; ws?: string; role?: string; group?: string; level?: string; }
interface OrgGraph {
  scope: string; nodes: OrgNode[]; links: OrgLink[];
  adj: Record<string, Set<string>>; byId: Record<string, OrgNode>;
}

const OG_LINK_PARAMS: Record<string, { len: number; k: number }> = {
  tether:   { len: 62,  k: 0.055 }, wikilink: { len: 74,  k: 0.038 },
  vw:       { len: 112, k: 0.06  }, access:   { len: 215, k: 0.014 },
  gaccess:  { len: 200, k: 0.02  }, member:   { len: 85,  k: 0.05  },
  guest:    { len: 150, k: 0.02  }, cites:    { len: 50,  k: 0.05  },
  stether:  { len: 78,  k: 0.02  },
};
const OG_VAULT_PARAMS: Record<string, { len: number; k: number }> = {
  tether: { len: 96, k: 0.04 }, wikilink: { len: 110, k: 0.04 },
  cites: { len: 66, k: 0.05 }, stether: { len: 104, k: 0.03 },
};

function buildOrgGraph(scope: string): OrgGraph {
  const nodes: OrgNode[] = [];
  const links: OrgLink[] = [];
  const addPages = (v: typeof ORG_WS[0]['vaults'][0] & { ws?: string }, wsId: string, big: boolean) => {
    const pg = ORG_VAULT_PAGES[v.id] ?? { pages: [], links: [] };
    const mode = (ORG_VAULT_INDEX[v.id]?.mode) || 'wiki';
    const deg: Record<string, number> = {};
    pg.links.forEach(([a, b]) => { deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1; });
    for (const p of pg.pages) {
      nodes.push({ id: 'page:' + v.id + ':' + p, kind: 'page', mode, label: p, ws: wsId, vault: v.id, deg: deg[p] || 0,
        r: big ? 5 + Math.sqrt(deg[p] || 0) * 2.6 : 3.6 + Math.sqrt(deg[p] || 0) * 1.5 });
      links.push({ s: 'page:' + v.id + ':' + p, t: 'vault:' + v.id, kind: 'tether', ws: wsId });
    }
    for (const [a, b] of pg.links) links.push({ s: 'page:' + v.id + ':' + a, t: 'page:' + v.id + ':' + b, kind: 'wikilink', ws: wsId });
    for (const sc of orgVaultSources(v.id)) {
      nodes.push({ id: 'src:' + v.id + ':' + sc.id, kind: 'source', label: sc.name, srcType: sc.type, srcId: sc.id, ws: wsId, vault: v.id, r: big ? 6 : 4.6 });
      links.push({ s: 'src:' + v.id + ':' + sc.id, t: 'vault:' + v.id, kind: 'stether', ws: wsId });
      for (const t of sc.cites) if (pg.pages.includes(t)) links.push({ s: 'src:' + v.id + ':' + sc.id, t: 'page:' + v.id + ':' + t, kind: 'cites', ws: wsId });
    }
  };
  if (scope === 'org') {
    for (const ws of ORG_WS) {
      nodes.push({ id: 'ws:' + ws.id, kind: 'ws', label: ws.name, ws: ws.id, private: ws.private, r: 24 });
      for (const v of ws.vaults) {
        nodes.push({ id: 'vault:' + v.id, kind: 'vault', label: v.name, ws: ws.id, vault: v.id, mode: v.mode, items: v.items, r: 12 });
        links.push({ s: 'vault:' + v.id, t: 'ws:' + ws.id, kind: 'vw', ws: ws.id });
        addPages(v, ws.id, false);
      }
    }
    for (const g of ORG_GROUPS) {
      nodes.push({ id: 'g:' + g.id, kind: 'group', label: g.name, group: g.id, r: 14, wsAll: g.ws.map((r) => r.w) });
      for (const r of g.ws) links.push({ s: 'g:' + g.id, t: 'ws:' + r.w, kind: 'gaccess', role: r.role, group: g.id, ws: r.w });
    }
    for (const m of ORG_MEMBERS) {
      const acc = orgPersonAccess(m.u);
      nodes.push({ id: 'p:' + m.u, kind: 'person', label: ORG_DIR[m.u].name.split(' ')[0], u: m.u, invited: m.invited, owner: m.owner, r: 12, wsAll: acc.wsRows.map((r) => r.w) });
      for (const r of m.ws) links.push({ s: 'p:' + m.u, t: 'ws:' + r.w, kind: 'access', role: r.role, ws: r.w, ...(m.invited ? { level: 'invited' } : {}) });
      for (const gr of acc.groups) links.push({ s: 'p:' + m.u, t: 'g:' + gr.id, kind: 'member', group: gr.id });
    }
    for (const gu of ORG_GUESTS) {
      nodes.push({ id: 'p:' + gu.u, kind: 'guest', label: ORG_DIR[gu.u].name.split(' ')[0], u: gu.u, r: 11, wsAll: gu.vaults.map((s) => vaultWsOf(s.v)) });
      for (const s of gu.vaults) links.push({ s: 'p:' + gu.u, t: 'vault:' + s.v, kind: 'guest', level: s.level, ws: vaultWsOf(s.v) });
    }
  } else {
    const v = ORG_VAULT_INDEX[scope];
    if (v) {
      nodes.push({ id: 'vault:' + v.id, kind: 'vault', label: v.name, ws: v.ws, vault: v.id, mode: v.mode, items: v.items, r: 17, hub: true });
      addPages(v, v.ws, true);
    }
  }
  const byId: Record<string, OrgNode> = {};
  nodes.forEach((n) => { byId[n.id] = n; });
  const adj: Record<string, Set<string>> = {};
  nodes.forEach((n) => { adj[n.id] = new Set(); });
  links.forEach((l) => { if (adj[l.s] && adj[l.t]) { adj[l.s].add(l.t); adj[l.t].add(l.s); } });
  return { scope, nodes, links, adj, byId };
}

// ── semantic closure ──────────────────────────────────────────────────────────
function ogClosure(id: string, graph: OrgGraph): Set<string> {
  const set = new Set([id]);
  const n = graph.byId[id]; if (!n) return set;
  const wsVaults = (wsId: string) => { for (const nd of graph.nodes) if (nd.kind === 'vault' && nd.ws === wsId) set.add(nd.id); };
  if (n.kind === 'person') {
    const wsIds = new Set<string>();
    for (const l of graph.links) {
      if (l.kind === 'member' && l.s === id) { set.add(l.t); for (const l2 of graph.links) if (l2.kind === 'gaccess' && l2.s === l.t) { set.add(l2.t); if (l2.ws) wsIds.add(l2.ws); } }
      if (l.kind === 'access' && l.s === id) { set.add(l.t); if (l.ws) wsIds.add(l.ws); }
    }
    wsIds.forEach((w) => wsVaults(w));
  } else if (n.kind === 'guest') {
    for (const l of graph.links) if (l.kind === 'guest' && l.s === id) set.add(l.t);
  } else if (n.kind === 'group') {
    for (const l of graph.links) {
      if (l.kind === 'member' && l.t === id) set.add(l.s);
      if (l.kind === 'gaccess' && l.s === id) { set.add(l.t); if (l.ws) wsVaults(l.ws); }
    }
  } else if (n.kind === 'ws') {
    for (const nd of graph.nodes) if ((nd.kind === 'vault' || nd.kind === 'page' || nd.kind === 'source') && nd.ws === n.ws) set.add(nd.id);
    for (const l of graph.links) if ((l.kind === 'access' || l.kind === 'gaccess') && l.t === id) set.add(l.s);
    for (const l of graph.links) if (l.kind === 'member' && set.has(l.t)) set.add(l.s);
  } else if (n.kind === 'vault') {
    if (graph.byId['ws:' + n.ws]) set.add('ws:' + n.ws);
    for (const nd of graph.nodes) if ((nd.kind === 'page' || nd.kind === 'source') && nd.vault === n.vault) set.add(nd.id);
    for (const l of graph.links) {
      if (l.kind === 'guest' && l.t === id) set.add(l.s);
      if ((l.kind === 'access' || l.kind === 'gaccess') && l.t === 'ws:' + n.ws) set.add(l.s);
    }
  } else if (n.kind === 'page' || n.kind === 'source') {
    set.add('vault:' + n.vault);
    graph.adj[id]?.forEach((x) => set.add(x));
  }
  return set;
}

// ── focus layout ──────────────────────────────────────────────────────────────
type PosMap = Map<string, { x: number; y: number }>;

function ogFocusLayout(id: string, graph: OrgGraph, vis: Record<string, boolean>): PosMap {
  const sel = graph.byId[id]; if (!sel) return new Map();
  const inC = ogClosure(id, graph);
  const ok = (x: string) => x !== id && inC.has(x) && (!vis || vis[x]);
  const ids = [...inC].filter(ok);
  const kindOf = (x: string) => (graph.byId[x] || {}).kind;
  const byKind = (kinds: string[]) => ids.filter((x) => kinds.includes(kindOf(x)));
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const pos: PosMap = new Map(); pos.set(id, { x: 0, y: 0 });
  const jitA = (x: string) => (ogRand(ogHash(x + ':a'))() - 0.5);
  const jitR = (x: string) => (ogRand(ogHash(x + ':r'))() - 0.5);
  const ring = (arr: string[], radius: number, phase?: number) => {
    const m = arr.length; if (!m) return;
    arr.forEach((x, i) => {
      const a = (phase || 0) + (i / m) * Math.PI * 2 + jitA(x) * 0.6;
      const rr = radius * (1 + jitR(x) * 0.16);
      pos.set(x, { x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    });
  };
  const cluster = (arr: string[], satR: number) => {
    const byV: Record<string, string[]> = {};
    arr.forEach((x) => { const v = graph.byId[x]?.vault ?? ''; (byV[v] = byV[v] || []).push(x); });
    Object.keys(byV).forEach((v) => {
      const base = pos.get('vault:' + v) || { x: 0, y: 0 };
      byV[v].forEach((x, i) => {
        const a = (i / byV[v].length) * Math.PI * 2 - Math.PI / 2 + jitA(x) * 0.7;
        const rr = satR * (1 + jitR(x) * 0.22);
        pos.set(x, { x: base.x + Math.cos(a) * rr, y: base.y + Math.sin(a) * rr });
      });
    });
  };
  if (sel.kind === 'ws') {
    const inner = byKind(['person','guest','group']);
    const vaults = byKind(['vault']);
    const r1 = clamp(112 + inner.length * 6, 120, 220);
    const r2 = r1 + clamp(120 + vaults.length * 6, 130, 200);
    ring(inner, r1, -Math.PI / 2);
    ring(vaults, r2, Math.PI / Math.max(1, vaults.length));
    cluster(byKind(['page','source']), 46);
  } else if (sel.kind === 'vault') {
    const content = byKind(['page','source']);
    ring(content, clamp(92 + content.length * 4, 104, 230), -Math.PI / 2);
    const wsNode = byKind(['ws'])[0];
    const access = byKind(['person','guest','group']);
    const far = { x: 380, y: 0 };
    if (wsNode) pos.set(wsNode, far);
    access.forEach((x, i) => { const a = (i / Math.max(1, access.length)) * Math.PI * 2; pos.set(x, { x: far.x + Math.cos(a) * 76, y: far.y + Math.sin(a) * 76 }); });
  } else if (sel.kind === 'person' || sel.kind === 'guest' || sel.kind === 'group') {
    const inner = byKind(sel.kind === 'group' ? ['person','ws'] : ['group','ws']);
    const vaults = byKind(['vault']);
    const r1 = clamp(112 + inner.length * 6, 120, 220);
    const r2 = r1 + clamp(116 + vaults.length * 6, 126, 196);
    ring(inner, r1, -Math.PI / 2);
    ring(vaults, r2, Math.PI / Math.max(1, vaults.length));
    cluster(byKind(['page','source']), 44);
  } else {
    ring(byKind(['vault','page','source']), clamp(78 + ids.length * 5, 88, 190), -Math.PI / 2);
  }
  return pos;
}

// ── shared button styles ──────────────────────────────────────────────────────
const ogIconBtn = (): CSSProperties => ({ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' });
function ogChip(on: boolean | 'temp', color?: string): CSSProperties {
  const isTemp = on === 'temp', isOn = on === true;
  return { display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 600,
    border: `1px ${isTemp ? 'dashed' : 'solid'} ${(isOn || isTemp) ? (color || 'var(--accent-line)') : 'var(--border)'}`,
    background: isOn ? (color ? hexToRgba(color, 0.1) : 'var(--accent-soft)') : isTemp ? 'var(--accent-soft)' : 'transparent',
    color: (isOn || isTemp) ? (color ? 'var(--fg)' : 'var(--accent)') : 'var(--fg-faint)',
    opacity: isTemp ? 0.72 : 1 };
}

// ── search ────────────────────────────────────────────────────────────────────
function OgSearch({ graph, theme, onPick }: { graph: OrgGraph; theme: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const KIND_LABEL: Record<string, string> = { ws: 'Workspace', vault: 'Vault', page: 'Page', source: 'Source', person: 'Person', guest: 'Guest', group: 'Group' };
  const fullName = (n: OrgNode) => ((n.kind === 'person' || n.kind === 'guest') && n.u && ORG_DIR[n.u]) ? ORG_DIR[n.u].name : n.label;
  const results = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!t) return [];
    return graph.nodes.filter((n) => {
      const lbl = (n.label || '').toLowerCase();
      const extra = ((n.kind === 'person' || n.kind === 'guest') && n.u && ORG_DIR[n.u]) ? ORG_DIR[n.u].name.toLowerCase() : '';
      return lbl.includes(t) || extra.includes(t);
    }).slice(0, 14);
  }, [q, graph]);
  const swatch = (n: OrgNode) => {
    const c = n.kind === 'group' ? 'var(--fg-muted)' : (n.kind === 'person' || n.kind === 'guest') ? 'var(--accent)' : ogWsColor(n.ws ?? '', theme);
    if (n.kind === 'person' || n.kind === 'guest') return <span style={{ width: 8, height: 8, borderRadius: '50%', border: `1.6px solid ${c}`, flexShrink: 0 }} />;
    if (n.kind === 'source') return <span style={{ width: 8, height: 8, borderRadius: 1.5, background: hexToRgba(c, 0.4), transform: 'rotate(45deg)', flexShrink: 0 }} />;
    return <span style={{ width: 8, height: 8, borderRadius: (n.kind === 'page' && n.mode === 'static') ? 2 : '50%', background: c, flexShrink: 0 }} />;
  };
  const pick = (n: OrgNode) => { onPick(n.id); setQ(''); setOpen(false); };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px', borderRadius: 8, border: `1px solid ${open && q ? 'var(--accent-line)' : 'var(--border)'}`, background: 'var(--surface)', width: 188 }}>
        <Icon name="search" size={13} color="var(--fg-faint)" />
        <input value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) pick(results[0]); if (e.key === 'Escape') { setQ(''); setOpen(false); } }}
          placeholder="Search the graph…"
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5 }} />
        {q && <button onClick={() => { setQ(''); setOpen(false); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--fg-faint)', display: 'flex', padding: 0 }}><Icon name="x" size={12} /></button>}
      </div>
      {open && q && (
        <div style={{ position: 'absolute', top: 34, left: 0, width: 264, zIndex: 60, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, boxShadow: 'var(--shadow-card)', padding: 6, maxHeight: 340, overflowY: 'auto' }}>
          {results.length ? results.map((n) => (
            <button key={n.id} onClick={() => pick(n)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 8px', border: 'none', borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)', fontSize: 12.5, background: 'transparent', color: 'var(--fg)' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}>
              {swatch(n)}
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName(n)}</span>
              <span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{KIND_LABEL[n.kind]}</span>
            </button>
          )) : <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '8px' }}>No matches.</div>}
        </div>
      )}
    </div>
  );
}

// ── inspector ─────────────────────────────────────────────────────────────────
interface InspectorHelpers { onGo: (id: string) => void; onFocusVault: (vid: string) => void; openGraphHref?: string; }

function GiRoleBadge({ role, via }: { role: string; via?: boolean }) {
  const tone = role === 'Owner' || role === 'Admin' ? 'var(--accent)' : role === 'Viewer' ? 'var(--fg-faint)' : 'var(--fg-muted)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, fontFamily: 'var(--ui-font)', color: tone, padding: '2px 8px', borderRadius: 999, border: `1px solid ${role === 'Owner' || role === 'Admin' ? 'var(--accent-line)' : 'var(--border)'}`, background: role === 'Owner' || role === 'Admin' ? 'var(--accent-soft)' : 'transparent', whiteSpace: 'nowrap' }}>
      {role}{via && <Icon name="users" size={10} color={tone} />}
    </span>
  );
}

function GiRow({ icon, iconColor, title, sub, badge, onClick }: { icon: IconName; iconColor: string; title: string; sub?: string; badge?: ReactNode; onClick?: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 8px', borderRadius: 8, border: 'none', cursor: onClick ? 'pointer' : 'default', textAlign: 'left', fontFamily: 'var(--ui-font)', background: hov && onClick ? 'var(--surface-2)' : 'transparent' }}>
      <span style={{ width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: hexToRgba(iconColor.startsWith('#') ? iconColor : '#8888ff', 0.12), flexShrink: 0 }}>
        <Icon name={icon} size={13} color={iconColor} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {sub && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
      </span>
      {badge}
    </button>
  );
}

function GiSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '0 8px', marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}

function giContent(nodeId: string, graph: OrgGraph, theme: string, h: InspectorHelpers): { icon?: IconName | null; title: string; color: string; tag: string; sub?: string; avatar?: string; dashed?: boolean; body: ReactNode; cta?: { label: string; icon?: IconName; onClick: () => void } | null } | null {
  const { onGo, onFocusVault, openGraphHref } = h;
  const n = graph.byId[nodeId]; if (!n) return null;
  const wsName = (id: string) => ORG_WS.find((w) => w.id === id)?.name ?? id;
  const wsCol = (id: string) => ogWsColor(id, theme);
  const groupTone = theme === 'light' ? '#5B6472' : '#9AA6B8';

  if (n.kind === 'person' || n.kind === 'guest') {
    const acc = orgPersonAccess(n.u!); const d = ORG_DIR[n.u!];
    const m = ORG_MEMBERS.find((x) => x.u === n.u);
    return {
      icon: null, title: d.name, color: 'var(--accent)',
      tag: n.kind === 'guest' ? 'External guest' : m?.invited ? 'Invited · pending' : m?.owner ? 'Org owner' : 'Member',
      sub: d.email, avatar: d.name[0], dashed: n.kind === 'guest' || m?.invited,
      body: (
        <>
          {acc.wsRows.length > 0 && (
            <GiSection label={`Workspace access · ${acc.wsRows.length}`}>
              {acc.wsRows.map((r) => (
                <GiRow key={r.w} icon="layers" iconColor={wsCol(r.w)} title={wsName(r.w)}
                  sub={r.via ? `via ${r.via}` : 'direct'} badge={<GiRoleBadge role={r.role} via={!!r.via} />} onClick={() => onGo('ws:' + r.w)} />
              ))}
            </GiSection>
          )}
          {acc.guestVaults.length > 0 && (
            <GiSection label={`Vault shares · ${acc.guestVaults.length}`}>
              {acc.guestVaults.map((s) => (
                <GiRow key={s.v} icon="folder" iconColor={wsCol(vaultWsOf(s.v))} title={ORG_VAULT_INDEX[s.v]?.name ?? s.v}
                  sub={`in ${wsName(vaultWsOf(s.v))}`} badge={<GiRoleBadge role={s.level} />} onClick={() => onGo('vault:' + s.v)} />
              ))}
            </GiSection>
          )}
          {acc.groups.length > 0 && (
            <GiSection label={`Groups · ${acc.groups.length}`}>
              {acc.groups.map((g) => (
                <GiRow key={g.id} icon="users" iconColor={groupTone} title={g.name}
                  sub={g.ws.map((r) => `${wsName(r.w)} · ${r.role}`).join('  ·  ')} onClick={() => onGo('g:' + g.id)} />
              ))}
            </GiSection>
          )}
          {acc.wsRows.length === 0 && acc.guestVaults.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '4px 8px' }}>No workspace access yet.</div>
          )}
        </>
      ),
    };
  }
  if (n.kind === 'group') {
    const g = ORG_GROUPS.find((x) => x.id === n.group)!;
    return {
      icon: 'users', title: g.name, color: groupTone, tag: `${g.members.length} members`, sub: 'Group — members inherit its access',
      body: (
        <>
          <GiSection label={`Grants · ${g.ws.length}`}>
            {g.ws.map((r) => (
              <GiRow key={r.w} icon="layers" iconColor={wsCol(r.w)} title={wsName(r.w)} badge={<GiRoleBadge role={r.role} />} onClick={() => onGo('ws:' + r.w)} />
            ))}
          </GiSection>
          <GiSection label={`Members · ${g.members.length}`}>
            {g.members.map((u) => (
              <GiRow key={u} icon="user" iconColor="var(--accent)" title={ORG_DIR[u].name} sub={ORG_DIR[u].email} onClick={() => onGo('p:' + u)} />
            ))}
          </GiSection>
        </>
      ),
    };
  }
  if (n.kind === 'ws') {
    const ws = ORG_WS.find((w) => w.id === n.ws)!;
    const members = orgWsMembers(ws.id);
    const col = wsCol(ws.id);
    return {
      icon: ws.private ? 'lock' : 'layers', title: ws.name, color: col,
      tag: ws.private ? 'Private workspace' : 'Workspace', sub: `${ws.vaults.length} vaults · ${members.length} people`,
      body: (
        <>
          <GiSection label={`Vaults · ${ws.vaults.length}`}>
            {ws.vaults.map((v) => (
              <GiRow key={v.id} icon="folder" iconColor={col} title={v.name}
                sub={`${(ORG_VAULT_PAGES[v.id] ?? { pages: [] }).pages.length} pages · ${v.mode}`} onClick={() => onGo('vault:' + v.id)} />
            ))}
          </GiSection>
          <GiSection label={`People with access · ${members.length}`}>
            {members.map((mm) => (
              <GiRow key={mm.u} icon="user" iconColor="var(--accent)" title={ORG_DIR[mm.u].name}
                sub={mm.via ? `via ${mm.via}` : mm.invited ? 'invited' : 'direct'} badge={<GiRoleBadge role={mm.role} via={!!mm.via} />} onClick={() => onGo('p:' + mm.u)} />
            ))}
          </GiSection>
        </>
      ),
    };
  }
  if (n.kind === 'vault') {
    const v = ORG_VAULT_INDEX[n.vault!]!;
    const ppl = orgVaultPeople(v.id);
    const col = wsCol(v.ws);
    const pages = ORG_VAULT_PAGES[v.id] ?? { pages: [], links: [] };
    return {
      icon: 'folder', title: v.name, color: col, tag: `Vault · ${v.mode}`, sub: `${wsName(v.ws)} · ${pages.pages.length} pages · ${pages.links.length} links`,
      cta: { label: 'Open vault graph', onClick: () => onFocusVault(v.id) },
      body: (
        <>
          {ppl.guests.length > 0 && (
            <GiSection label={`Guest shares · ${ppl.guests.length}`}>
              {ppl.guests.map((g) => (
                <GiRow key={g.u} icon="user" iconColor="var(--fg-muted)" title={ORG_DIR[g.u].name} sub="external guest" badge={<GiRoleBadge role={g.level} />} onClick={() => onGo('p:' + g.u)} />
              ))}
            </GiSection>
          )}
          <GiSection label={`Access via ${wsName(v.ws)} · ${ppl.members.length}`}>
            {ppl.members.map((mm) => (
              <GiRow key={mm.u} icon="user" iconColor="var(--accent)" title={ORG_DIR[mm.u].name}
                sub={mm.via ? `via ${mm.via}` : 'direct'} badge={<GiRoleBadge role={mm.role} via={!!mm.via} />} onClick={() => onGo('p:' + mm.u)} />
            ))}
          </GiSection>
        </>
      ),
    };
  }
  if (n.kind === 'source') {
    const v = ORG_VAULT_INDEX[n.vault!] ?? {};
    const srcCol = theme === 'light' ? '#A9762E' : '#D9A441';
    const cited: OrgNode[] = [];
    graph.links.forEach((l) => { if (l.kind === 'cites' && l.s === n.id) { const nd = graph.byId[l.t]; if (nd) cited.push(nd); } });
    return {
      icon: (ORG_SRC_GLYPH[n.srcType ?? ''] ?? 'file') as IconName, title: n.label, color: srcCol,
      tag: 'Source · ' + (n.srcType ?? 'file').toUpperCase(), sub: `${'name' in v ? (v as any).name : ''} · ${wsName(n.ws ?? '')}`,
      body: (
        <GiSection label={`Cited by · ${cited.length}`}>
          {cited.length ? cited.map((p) => (
            <GiRow key={p.id} icon="file" iconColor={wsCol(p.ws ?? '')} title={p.label} onClick={() => onGo(p.id)} />
          )) : <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '4px 8px' }}>Not cited by any page yet.</div>}
        </GiSection>
      ),
    };
  }
  // page
  const v = ORG_VAULT_INDEX[n.vault!] ?? {};
  const srcCol = theme === 'light' ? '#A9762E' : '#D9A441';
  const mode = n.mode ?? 'wiki';
  const modeTag = mode === 'static' ? 'Static page' : mode === 'dynamic' ? 'Dynamic page' : 'Wiki page';
  const neighbors: OrgNode[] = [];
  graph.links.forEach((l) => {
    if (l.kind !== 'wikilink') return;
    if (l.s === n.id) { const nd = graph.byId[l.t]; if (nd) neighbors.push(nd); }
    if (l.t === n.id) { const nd = graph.byId[l.s]; if (nd) neighbors.push(nd); }
  });
  const sources = n.vault && n.label ? orgPageSources(n.vault, n.label) : [];
  return {
    icon: (mode === 'static' ? 'file' : mode === 'dynamic' ? 'zap' : 'wiki') as IconName,
    title: n.label, color: wsCol(n.ws ?? ''), tag: modeTag, sub: `${'name' in v ? (v as any).name : ''} · ${wsName(n.ws ?? '')}`,
    cta: mode === 'wiki' ? {
      label: 'Open page', icon: 'arrowRight' as IconName,
      onClick: () => openGraphHref && window.open(`/wiki/${encodeURIComponent(n.label)}`, '_blank'),
    } : null,
    body: (
      <>
        {neighbors.length > 0 && (
          <GiSection label={`Linked pages · ${neighbors.length}`}>
            {neighbors.map((p) => (
              <GiRow key={p.id} icon="file" iconColor={wsCol(p.ws ?? '')} title={p.label} onClick={() => onGo(p.id)} />
            ))}
          </GiSection>
        )}
        {sources.length > 0 && (
          <GiSection label={`Sources · ${sources.length}`}>
            {sources.map((s) => (
              <GiRow key={s.id} icon={(ORG_SRC_GLYPH[s.type] ?? 'file') as IconName} iconColor={srcCol} title={s.name} sub={(s.type ?? 'file').toUpperCase()} onClick={() => n.vault && onGo('src:' + n.vault + ':' + s.id)} />
            ))}
          </GiSection>
        )}
        {!neighbors.length && !sources.length && (
          <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '4px 8px' }}>No links or sources yet.</div>
        )}
      </>
    ),
  };
}

function GraphInspector({ nodeId, graph, theme, isMobile, onClose, onGo, onFocusVault, openGraphHref }: {
  nodeId: string; graph: OrgGraph; theme: string; isMobile?: boolean;
  onClose: () => void; onGo: (id: string) => void; onFocusVault: (vid: string) => void;
  openGraphHref?: string;
}) {
  const c = giContent(nodeId, graph, theme, { onGo, onFocusVault, openGraphHref });
  if (!c) return null;
  const asCard = isMobile;
  const iconColor = c.color;
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: iconColor.startsWith('#') ? hexToRgba(iconColor, 0.13) : 'var(--surface-2)',
        border: `1.5px ${c.dashed ? 'dashed' : 'solid'} ${iconColor}` }}>
        {c.avatar
          ? <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--ui-font)', color: iconColor }}>{c.avatar}</span>
          : c.icon ? <Icon name={c.icon} size={15} color={iconColor} /> : null}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--fg-faint)', padding: '1.5px 7px', borderRadius: 999, border: '1px solid var(--border)', whiteSpace: 'nowrap', flexShrink: 0 }}>{c.tag}</span>
        </div>
        {c.sub && <div style={{ fontSize: 11.5, color: 'var(--fg-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{c.sub}</div>}
      </div>
      <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent', color: 'var(--fg-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
  const body = (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {c.body}
      {c.cta && (
        <button onClick={c.cta.onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 32, margin: '0 8px', borderRadius: 8, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)', color: 'var(--accent)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          <Icon name={c.cta.icon ?? 'graph'} size={13} color="var(--accent)" />{c.cta.label}
        </button>
      )}
    </div>
  );
  const shell: CSSProperties = { display: 'flex', flexDirection: 'column', background: 'var(--surface)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' };
  if (asCard) return (
    <div style={{ ...shell, border: '1px solid var(--border-strong)', position: 'absolute', right: 14, bottom: 14, width: 'calc(100% - 28px)', maxHeight: '56%', borderRadius: 13 }}>
      <style>{'@keyframes giIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'}</style>
      {header}{body}
    </div>
  );
  return (
    <div style={{ ...shell, borderLeft: '1px solid var(--border-strong)', position: 'absolute', right: 0, top: 0, bottom: 0, width: 312 }}>
      <style>{'@keyframes giSlide{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}'}</style>
      {header}{body}
    </div>
  );
}

// ── sim node ──────────────────────────────────────────────────────────────────
interface SimNode { id: string; kind: string; r: number; x: number; y: number; vx: number; vy: number; fx: number | null; fy: number | null; }

// ── main component ────────────────────────────────────────────────────────────
export interface OrgGraphViewProps {
  theme: string;
  isMobile?: boolean;
  scope?: string;        // 'org' or a vault id; defaults to 'org'
  openGraphHref?: string; // adds a graph icon link in the toolbar
  wikiScope?: boolean;   // pages always on, only Sources toggle
}

export function OrgGraphView({ theme, isMobile = false, scope = 'org', openGraphHref, wikiScope = false }: OrgGraphViewProps) {
  const [layers, setLayers] = useState<{ people: boolean; groups: boolean; pages: boolean | 'suppressed'; sources: boolean }>({ people: true, groups: true, pages: false, sources: false });
  const [wsOff, setWsOff] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const prevSelRef = useRef<string | null>(null);
  const navRef = useRef<'back' | 'forward' | null>(null);
  const skipHistRef = useRef(false);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });

  const graph = useMemo(() => buildOrgGraph(scope), [scope]);
  useEffect(() => { setHover(null); setSelected(null); }, [scope]);

  useEffect(() => {
    const prev = prevSelRef.current;
    if (skipHistRef.current) { skipHistRef.current = false; }
    else if (navRef.current) { navRef.current = null; }
    else if (prev && prev !== selected) { setHistory((h) => [...h, prev]); setFuture([]); }
    prevSelRef.current = selected;
  }, [selected]);

  const goBack = () => {
    if (!history.length) return;
    navRef.current = 'back';
    setFuture((f) => (selected ? [selected, ...f] : f));
    setHistory((h) => { setSelected(h[h.length - 1]); return h.slice(0, -1); });
  };
  const goForward = () => {
    if (!future.length) return;
    navRef.current = 'forward';
    setHistory((h) => (selected ? [...h, selected] : h));
    setFuture((f) => { setSelected(f[0]); return f.slice(1); });
  };

  const isolateWs = (id: string) => setWsOff((m) => {
    const onIds = ORG_WS.filter((w) => !m[w.id]).map((w) => w.id);
    if (onIds.length === 1 && onIds[0] === id) return {};
    const next: Record<string, boolean> = {};
    ORG_WS.forEach((w) => { if (w.id !== id) next[w.id] = true; });
    return next;
  });

  const selNode = selected ? graph.byId[selected] : null;
  const vaultFocused = !!(selNode && (selNode.kind === 'vault' || selNode.kind === 'page' || selNode.kind === 'source'));

  useEffect(() => {
    if (vaultFocused && layers.pages === 'suppressed') setLayers((l) => ({ ...l, pages: false }));
  }, [vaultFocused]); // eslint-disable-line react-hooks/exhaustive-deps

  const pagesTemp = layers.pages === false && vaultFocused;
  const pagesOn = wikiScope || scope !== 'org' || layers.pages === true || pagesTemp;
  const sourcesOn = layers.sources;

  const vis = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const n of graph.nodes) {
      let v = true;
      if (n.kind === 'ws' || n.kind === 'vault') v = !wsOff[n.ws!];
      else if (n.kind === 'page') v = pagesOn && !wsOff[n.ws!];
      else if (n.kind === 'source') v = sourcesOn && !wsOff[n.ws!];
      else if (n.kind === 'group') v = layers.groups && !!(n.wsAll?.some((w) => !wsOff[w]));
      else if (n.kind === 'person' || n.kind === 'guest') v = layers.people && (!n.wsAll?.length || !!(n.wsAll.some((w) => !wsOff[w])));
      m[n.id] = v;
    }
    return m;
  }, [graph, layers, wsOff, pagesOn, sourcesOn]);

  // refs
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeEls = useRef<Record<string, SVGGElement | null>>({});
  const lineEls = useRef<(SVGLineElement | null)[]>([]);
  const hitEls = useRef<(SVGLineElement | null)[]>([]);
  const sim = useRef<{ scope: string | null; nodes: SimNode[]; byId: Record<string, SimNode> }>({ scope: null, nodes: [], byId: {} });
  const graphRef = useRef(graph); graphRef.current = graph;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const visRef = useRef(vis); visRef.current = vis;
  const sizeRef = useRef(size); sizeRef.current = size;
  const viewRef = useRef(view); viewRef.current = view;
  const isMobileRef = useRef(isMobile); isMobileRef.current = isMobile;
  const alpha = useRef(1);
  const drag = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null);
  const pan = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const viewTarget = useRef({ x: 0, y: 0, k: 1 });
  const focusRef = useRef<string | null>(null);
  const focusSetRef = useRef<Set<string> | null>(null);
  const focusPosRef = useRef<PosMap | null>(null);
  const fitReq = useRef<{ type: 'focus' | 'reset' | 'sel'; id?: string; t0?: number } | null>(null);

  const setViewNow = (nv: typeof view) => { viewTarget.current = nv; setView(nv); };
  const setViewSmooth = (nv: typeof view) => { viewTarget.current = nv; };
  const fitK = (w: number, h: number) => Math.min(1.15, Math.max(0.4, Math.min(w / 1040, h / 660)));

  useEffect(() => { alpha.current = Math.max(alpha.current, 0.5); }, [vis]);

  useLayoutEffect(() => {
    const el = wrapRef.current; if (!el) return;
    let t: ReturnType<typeof setTimeout>;
    let first = true;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
      if (first) { first = false; return; }
      clearTimeout(t);
      t = setTimeout(() => {
        sim.current.scope = null; alpha.current = 1; setHover(null);
        const cur = prevSelRef.current;
        fitReq.current = cur ? { type: 'sel', id: cur, t0: performance.now() } : { type: 'reset' };
      }, 180);
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => { clearTimeout(t); ro.disconnect(); };
  }, []);

  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && size.w > 0 && size.h > 0) { fitted.current = true; setViewNow({ x: 0, y: 0, k: fitK(size.w, size.h) }); }
  }, [size]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fitted.current) setViewNow({ x: 0, y: 0, k: scope === 'org' ? fitK(size.w, size.h) : 1 }); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = selected && graph.byId[selected] ? selected : null;
    focusRef.current = id;
    focusSetRef.current = id ? ogClosure(id, graph) : null;
    focusPosRef.current = id ? ogFocusLayout(id, graph, vis) : null;
    fitReq.current = id ? { type: 'focus', id, t0: performance.now() } : { type: 'reset' };
    alpha.current = 1;
  }, [selected, scope, vis]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureSeed = () => {
    const s = sim.current; const sc = scopeRef.current; const g = graphRef.current;
    if (s.scope === sc && s.nodes.length) return;
    const rand = ogRand(ogHash(sc));
    const R = 230;
    const wsPos: Record<string, { x: number; y: number }> = {};
    const vPos: Record<string, { x: number; y: number }> = {};
    ORG_WS.forEach((ws, i) => { const a = (i / ORG_WS.length) * Math.PI * 2 - Math.PI / 2; wsPos[ws.id] = { x: Math.cos(a) * R, y: Math.sin(a) * R }; });
    ORG_WS.forEach((ws) => ws.vaults.forEach((v, i) => {
      const base = wsPos[ws.id] ?? { x: 0, y: 0 }; const a = (i / Math.max(1, ws.vaults.length)) * Math.PI * 2 + rand() * 1.2;
      vPos[v.id] = { x: base.x + Math.cos(a) * 78, y: base.y + Math.sin(a) * 78 };
    }));
    s.nodes = g.nodes.map((n) => {
      let p: { x: number; y: number };
      if (n.kind === 'ws') p = wsPos[n.ws!] ?? { x: 0, y: 0 };
      else if (n.kind === 'vault') p = sc === 'org' ? (vPos[n.vault!] ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
      else if (n.kind === 'page' || n.kind === 'source') { const b = sc === 'org' ? (vPos[n.vault!] ?? { x: 0, y: 0 }) : { x: 0, y: 0 }; const a = rand() * Math.PI * 2; const rr = (sc === 'org' ? 30 : 90) + rand() * (sc === 'org' ? 28 : 110); p = { x: b.x + Math.cos(a) * rr, y: b.y + Math.sin(a) * rr }; }
      else { const pts = (n.wsAll ?? []).map((wid) => wsPos[wid]).filter(Boolean); const b = pts.length ? { x: pts.reduce((q, t) => q + t.x, 0) / pts.length, y: pts.reduce((q, t) => q + t.y, 0) / pts.length } : { x: 0, y: 0 }; p = { x: b.x + (rand() - 0.5) * 90, y: b.y + (rand() - 0.5) * 90 }; }
      return { id: n.id, kind: n.kind, r: n.r, x: p.x, y: p.y, vx: 0, vy: 0, fx: null, fy: null };
    });
    s.byId = {}; s.nodes.forEach((n) => { s.byId[n.id] = n; });
    s.scope = sc; alpha.current = 1;
  };

  const ogMass = (n: SimNode) => n.kind === 'ws' ? 3.1 : n.kind === 'vault' ? (scopeRef.current !== 'org' ? 2.6 : 1.7) : n.kind === 'group' ? 1.6 : (n.kind === 'person' || n.kind === 'guest') ? 1.5 : 0.6;
  const ogGravity = (n: SimNode) => n.kind === 'ws' ? 0.035 : n.kind === 'vault' ? (scopeRef.current !== 'org' ? 0.08 : 0.018) : (n.kind === 'page' || n.kind === 'source') ? 0.012 : 0.014;

  const step = () => {
    const s = sim.current; const nodes = s.nodes; const links = graphRef.current.links; const vv = visRef.current;
    let a = alpha.current; if (a < 0.02) a = 0.02;
    const DAMP = 0.84;
    const params: Record<string, { len: number; k: number }> = scopeRef.current === 'org' ? OG_LINK_PARAMS : { ...OG_LINK_PARAMS, ...OG_VAULT_PARAMS };
    const fpos = focusPosRef.current; const focusing = !!fpos;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i]; if (!vv[p.id]) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j]; if (!vv[q.id]) continue;
        let dx = p.x - q.x, dy = p.y - q.y; let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const d = Math.sqrt(d2);
        const f = Math.min(2100 * ogMass(p) * ogMass(q) / d2, 75) * a * (focusing ? 0.5 : 1);
        const ux = dx / d, uy = dy / d;
        p.vx += ux * f; p.vy += uy * f; q.vx -= ux * f; q.vy -= uy * f;
      }
    }
    for (const lk of links) {
      if (!vv[lk.s] || !vv[lk.t]) continue;
      const p = s.byId[lk.s], q = s.byId[lk.t]; if (!p || !q) continue;
      const pr = params[lk.kind] ?? OG_LINK_PARAMS.wikilink;
      const dx = q.x - p.x, dy = q.y - p.y; const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (d - pr.len) * pr.k * a * (focusing ? 0.22 : 1); const ux = dx / d, uy = dy / d;
      p.vx += ux * force; p.vy += uy * force; q.vx -= ux * force; q.vy -= uy * force;
    }
    const fs = focusSetRef.current; const fid = focusRef.current;
    for (const p of nodes) {
      if (!vv[p.id]) continue;
      const tgt = fpos?.get(p.id);
      if (tgt) { const ks = (p.id === fid ? 0.3 : 0.16); p.vx += (tgt.x - p.x) * ks * a; p.vy += (tgt.y - p.y) * ks * a; }
      else if (fs) { const dd = Math.hypot(p.x, p.y) || 0.01; const s2 = (560 - dd) * 0.012 * a; p.vx += (p.x / dd) * s2; p.vy += (p.y / dd) * s2; }
      else { const gv = ogGravity(p) * a; p.vx += (0 - p.x) * gv; p.vy += (0 - p.y) * gv; }
      if (p.fx != null) { p.x = p.fx; p.y = p.fy as number; p.vx = 0; p.vy = 0; }
      else {
        const sp = Math.hypot(p.vx, p.vy); const MAX = 120;
        if (sp > MAX) { p.vx = p.vx / sp * MAX; p.vy = p.vy / sp * MAX; }
        p.x += p.vx; p.y += p.vy; p.vx *= DAMP; p.vy *= DAMP;
        if (!isFinite(p.x) || !isFinite(p.y)) { p.x = (Math.random() - 0.5) * 40; p.y = (Math.random() - 0.5) * 40; p.vx = 0; p.vy = 0; }
      }
    }
    alpha.current = Math.max(0.02, alpha.current * 0.985);
  };

  const paint = () => {
    const s = sim.current;
    for (const n of s.nodes) { const el = nodeEls.current[n.id]; if (el) el.setAttribute('transform', `translate(${n.x.toFixed(2)},${n.y.toFixed(2)})`); }
    const links = graphRef.current.links;
    for (let i = 0; i < links.length; i++) {
      const p = s.byId[links[i].s], q = s.byId[links[i].t]; if (!p || !q) continue;
      const x1 = p.x.toFixed(2), y1 = p.y.toFixed(2), x2 = q.x.toFixed(2), y2 = q.y.toFixed(2);
      const el = lineEls.current[i]; if (el) { el.setAttribute('x1', x1); el.setAttribute('y1', y1); el.setAttribute('x2', x2); el.setAttribute('y2', y2); }
      const hel = hitEls.current[i]; if (hel) { hel.setAttribute('x1', x1); hel.setAttribute('y1', y1); hel.setAttribute('x2', x2); hel.setAttribute('y2', y2); }
    }
  };

  useEffect(() => {
    let raf: number;
    const animateView = () => {
      const v = viewRef.current, t = viewTarget.current;
      const dx = t.x - v.x, dy = t.y - v.y, dk = t.k - v.k;
      if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4 && Math.abs(dk) < 0.0015) {
        if (v.x !== t.x || v.y !== t.y || v.k !== t.k) setView({ x: t.x, y: t.y, k: t.k });
        return;
      }
      setView({ x: v.x + dx * 0.2, y: v.y + dy * 0.2, k: v.k + dk * 0.2 });
    };
    const maybeFit = () => {
      const req = fitReq.current; if (!req) return;
      const { w, h } = sizeRef.current; if (!w) return;
      if (req.type === 'reset') { viewTarget.current = { x: 0, y: 0, k: scopeRef.current === 'org' ? fitK(w, h) : 1 }; fitReq.current = null; return; }
      if (alpha.current > 0.42 && performance.now() - (req.t0 ?? 0) < 1400) return;
      const selN = req.id ? graphRef.current.byId[req.id] : null;
      let frameSet: Set<string>;
      if (selN?.kind === 'vault') {
        frameSet = new Set([req.id!]);
        for (const n of graphRef.current.nodes) if ((n.kind === 'page' || n.kind === 'source') && n.vault === selN.vault) frameSet.add(n.id);
      } else if (req.id) {
        frameSet = ogClosure(req.id, graphRef.current);
      } else { fitReq.current = null; return; }
      const vv = visRef.current;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
      for (const n of sim.current.nodes) {
        if (!frameSet.has(n.id) || !vv[n.id]) continue; any = true;
        if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
      }
      if (!any) { fitReq.current = null; return; }
      const panelW = isMobileRef.current ? 0 : 312;
      const bottomH = isMobileRef.current ? Math.round(h * 0.56) : 0;
      const availW = w - panelW, availH = h - bottomH;
      const bw = Math.max(70, maxX - minX), bh = Math.max(70, maxY - minY);
      const k = clampK(Math.min((availW - 130) / bw, (availH - 110) / bh, 1.85));
      const ccx = (minX + maxX) / 2, ccy = (minY + maxY) / 2;
      viewTarget.current = { k, x: availW / 2 - w / 2 - ccx * k, y: availH / 2 - h / 2 - ccy * k };
      fitReq.current = null;
    };
    const frame = () => { ensureSeed(); step(); paint(); animateView(); maybeFit(); raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // pointer
  const toWorld = (clientX: number, clientY: number) => {
    const el = svgRef.current; if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect(); const v = viewRef.current;
    return { x: (clientX - r.left - r.width / 2 - v.x) / v.k, y: (clientY - r.top - r.height / 2 - v.y) / v.k };
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (drag.current) {
        const w = toWorld(e.clientX, e.clientY); const n = sim.current.byId[drag.current.id];
        if (n) { n.fx = w.x; n.fy = w.y; }
        if (Math.abs(e.clientX - drag.current.sx) + Math.abs(e.clientY - drag.current.sy) > 4) drag.current.moved = true;
        alpha.current = Math.max(alpha.current, 0.5);
      } else if (pan.current) {
        if (Math.abs(e.clientX - pan.current.sx) + Math.abs(e.clientY - pan.current.sy) > 4) pan.current.moved = true;
        fitReq.current = null;
        const nv = { ...viewRef.current, x: pan.current.ox + (e.clientX - pan.current.sx), y: pan.current.oy + (e.clientY - pan.current.sy) };
        viewTarget.current = nv; setView(nv);
      }
    };
    const up = () => {
      if (drag.current) {
        const { id, moved } = drag.current;
        const n = sim.current.byId[id]; if (n) { n.fx = null; n.fy = null; }
        if (!moved) setSelected((cur) => (cur === id ? null : id));
        drag.current = null;
      } else if (pan.current) {
        if (!pan.current.moved) setSelected(null);
        pan.current = null;
      }
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodeDown = (e: React.MouseEvent, id: string) => { e.stopPropagation(); drag.current = { id, sx: e.clientX, sy: e.clientY, moved: false }; alpha.current = Math.max(alpha.current, 0.6); };
  const onBgDown = (e: React.MouseEvent) => { pan.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false }; };

  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault(); fitReq.current = null;
      const r = el.getBoundingClientRect(); const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
      const t = viewTarget.current;
      const k = clampK(t.k * (e.deltaY < 0 ? 1.16 : 0.862));
      const wx = (mx - t.x) / t.k, wy = (my - t.y) / t.k;
      viewTarget.current = { k, x: mx - wx * k, y: my - wy * k };
    };
    let pinch: { d: number; mx: number; my: number; base: typeof view } | null = null;
    let panT: { sx: number; sy: number; ox: number; oy: number } | null = null;
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches; const r = el.getBoundingClientRect();
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mx: (a.clientX + b.clientX) / 2 - r.left - r.width / 2, my: (a.clientY + b.clientY) / 2 - r.top - r.height / 2, base: { ...viewTarget.current } };
        panT = null;
      } else if (e.touches.length === 1) {
        panT = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, ox: viewRef.current.x, oy: viewRef.current.y };
      }
    };
    const tm = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault(); fitReq.current = null;
        const [a, b] = e.touches;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const base = pinch.base; const k = clampK(base.k * (d / pinch.d));
        const wx = (pinch.mx - base.x) / base.k, wy = (pinch.my - base.y) / base.k;
        viewTarget.current = { k, x: pinch.mx - wx * k, y: pinch.my - wy * k };
      } else if (panT && e.touches.length === 1) {
        e.preventDefault(); fitReq.current = null;
        const nv = { ...viewRef.current, x: panT.ox + (e.touches[0].clientX - panT.sx), y: panT.oy + (e.touches[0].clientY - panT.sy) };
        viewTarget.current = nv; setView(nv);
      }
    };
    const te = (e: TouchEvent) => {
      if (e.touches.length === 0) { pinch = null; panT = null; }
      else if (e.touches.length === 1) { pinch = null; panT = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, ox: viewRef.current.x, oy: viewRef.current.y }; }
    };
    el.addEventListener('wheel', handler, { passive: false });
    el.addEventListener('touchstart', ts, { passive: false });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    return () => { el.removeEventListener('wheel', handler); el.removeEventListener('touchstart', ts); el.removeEventListener('touchmove', tm); el.removeEventListener('touchend', te); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomBy = (f: number) => { fitReq.current = null; const t = viewTarget.current; const k = clampK(t.k * f); const wx = -t.x / t.k, wy = -t.y / t.k; setViewSmooth({ k, x: -wx * k, y: -wy * k }); };
  const resetView = () => { fitReq.current = null; skipHistRef.current = true; setHistory([]); setFuture([]); setSelected(null); setViewSmooth({ x: 0, y: 0, k: scope === 'org' ? fitK(size.w, size.h) : 1 }); alpha.current = Math.max(alpha.current, 0.4); };
  const rerunReset = () => { sim.current.scope = null; alpha.current = 1; setHover(null); resetView(); };

  // highlight model
  const hov = hover && graph.byId[hover] && vis[hover] ? hover : null;
  const sel = selected && graph.byId[selected] ? selected : null;
  const activeSet = useMemo(() => {
    if (hov) { const s = new Set([hov]); graph.adj[hov]?.forEach((x) => s.add(x)); return s; }
    if (sel) return ogClosure(sel, graph);
    return null;
  }, [hov, sel, graph]);
  const dimmed = (id: string) => !!(activeSet && !activeSet.has(id));

  const wsCol = (id: string) => ogWsColor(id, theme);
  const ogGroupTone = theme === 'light' ? '#5B6472' : '#9AA6B8';

  const nodeColor = (n: OrgNode) => n.kind === 'group' ? ogGroupTone : (n.kind === 'person' || n.kind === 'guest') ? 'var(--accent)' : wsCol(n.ws ?? '');

  const edgeStyle = (l: OrgLink) => {
    const wc = wsCol(l.ws ?? '');
    switch (l.kind) {
      case 'tether':   return { stroke: wc, w: 1,   op: 0.18 };
      case 'wikilink': return { stroke: wc, w: 1.1, op: 0.34 };
      case 'vw':       return { stroke: wc, w: 1.7, op: 0.6  };
      case 'access':   return { stroke: wc, w: 1.6, op: 0.5  };
      case 'gaccess':  return { stroke: ogGroupTone, w: 1.6, op: 0.5 };
      case 'member':   return { stroke: ogGroupTone, w: 1.3, op: 0.5 };
      case 'guest':    return { stroke: wc, w: 1.5, op: 0.5  };
      case 'cites':    return { stroke: wc, w: 1.1, op: 0.34, dash: '4 3' };
      case 'stether':  return { stroke: wc, w: 1,   op: 0.12 };
      default:         return { stroke: 'var(--border-strong)', w: 1, op: 0.4 };
    }
  };

  const showPageLabel = (n: OrgNode) => scope !== 'org' || view.k > 1.02 || !!(activeSet?.has(n.id)) || hov === n.id;

  const labelStyle = (n: OrgNode, lit: boolean): CSSProperties => ({
    fontFamily: 'var(--ui-font)', pointerEvents: 'none', userSelect: 'none', transition: 'fill 0.18s',
    fontSize: n.kind === 'ws' ? 12.5 : (n.kind === 'page' || n.kind === 'source') ? Math.max(9, 10.5 / Math.max(1, view.k * 0.9)) : 10.5,
    fontWeight: n.kind === 'ws' ? 700 : lit ? 600 : 500,
  });

  const renderNode = (n: OrgNode) => {
    const col = nodeColor(n);
    const litNode = hov === n.id || sel === n.id;
    const dim = dimmed(n.id);
    const r = n.r + (hov === n.id ? 2 : 0);
    const common = {
      ref: (el: SVGGElement | null) => { if (el) nodeEls.current[n.id] = el; else delete nodeEls.current[n.id]; },
      style: { cursor: 'pointer', opacity: dim ? 0.13 : 1, transition: 'opacity 0.18s' } as CSSProperties,
      onMouseEnter: () => { setHover(n.id); alpha.current = Math.max(alpha.current, 0.12); },
      onMouseLeave: () => setHover(null),
      onMouseDown: (e: React.MouseEvent) => onNodeDown(e, n.id),
    };
    const halo = litNode && <circle r={r + 9} fill={col} opacity={0.15} />;
    const ring = sel === n.id ? 'var(--accent)' : null;
    if (n.kind === 'ws') return (
      <g key={n.id} {...common}>
        {halo}
        <circle r={r} fill={hexToRgba(col, theme === 'light' ? 0.08 : 0.1)} stroke={ring ?? col} strokeWidth={(sel === n.id ? 2.4 : 1.7) / view.k} />
        <g transform="translate(-8,-8)"><Icon name={n.private ? 'lock' : 'layers'} size={16} color={col} /></g>
        <text textAnchor="middle" y={r + 17} fill={col} style={labelStyle(n, litNode)}>{n.label}</text>
      </g>
    );
    if (n.kind === 'vault') return (
      <g key={n.id} {...common}>
        {halo}
        <circle r={r} fill={col} stroke={ring ?? 'var(--bg)'} strokeWidth={(sel === n.id ? 2.4 : 1.5) / view.k} />
        <g transform={`translate(${-r * 0.5},${-r * 0.5})`}><Icon name="folder" size={r} color={theme === 'light' ? '#FFFFFF' : '#0B0D10'} /></g>
        <text textAnchor="middle" y={r + 14} fill={litNode ? 'var(--fg)' : 'var(--fg-muted)'} style={labelStyle(n, litNode)}>{n.label}</text>
      </g>
    );
    if (n.kind === 'group') return (
      <g key={n.id} {...common}>
        {halo}
        <circle r={r} fill={hexToRgba(col, 0.12)} stroke={ring ?? col} strokeWidth={(sel === n.id ? 2.4 : 1.5) / view.k} strokeDasharray="4 3" />
        <g transform="translate(-6.5,-6.5)"><Icon name="users" size={13} color={col} /></g>
        <text textAnchor="middle" y={r + 14} fill={col} style={labelStyle(n, litNode)}>{n.label}</text>
      </g>
    );
    if (n.kind === 'person' || n.kind === 'guest') return (
      <g key={n.id} {...common}>
        {halo}
        <circle r={r} fill="var(--surface)" stroke={ring ?? (litNode ? 'var(--accent)' : 'var(--border-strong)')} strokeWidth={(sel === n.id ? 2.4 : 1.5) / view.k} />
        <text textAnchor="middle" dy="3.5" fill={litNode ? 'var(--accent)' : 'var(--fg)'} style={{ fontFamily: 'var(--ui-font)', fontSize: 10, fontWeight: 700, pointerEvents: 'none', userSelect: 'none' }}>{n.u ? ORG_DIR[n.u]?.name[0] ?? '?' : '?'}</text>
        <text textAnchor="middle" y={r + 14} fill={litNode ? 'var(--fg)' : 'var(--fg-muted)'} style={labelStyle(n, litNode)}>{n.label}{n.kind === 'guest' ? ' ⊞' : ''}</text>
      </g>
    );
    if (n.kind === 'source') {
      const sr = r;
      const vcol = wsCol(n.ws ?? '');
      const showGlyph = view.k > 1.05 || litNode || scope !== 'org';
      return (
        <g key={n.id} {...common}>
          {litNode && <circle r={sr + 9} fill={vcol} opacity={0.16} />}
          <rect x={-sr} y={-sr} width={sr * 2} height={sr * 2} rx={2} transform="rotate(45)"
            fill={hexToRgba(vcol, theme === 'light' ? 0.09 : 0.12)} stroke={hexToRgba(vcol, litNode ? 0.6 : 0.4)} strokeWidth={(sel === n.id ? 2 : 1.3) / view.k} />
          {showGlyph && <g transform="translate(-5.5,-5.5)"><Icon name={(ORG_SRC_GLYPH[n.srcType ?? ''] ?? 'file') as IconName} size={11} color={hexToRgba(vcol, 0.72)} /></g>}
          {showPageLabel(n) && <text textAnchor="middle" y={sr + 13} fill={litNode ? 'var(--fg)' : 'var(--fg-muted)'} style={labelStyle(n, litNode)}>{n.label}</text>}
        </g>
      );
    }
    // page
    const sw = (sel === n.id ? 2 : 1) / view.k;
    const pageShape = n.mode === 'static'
      ? <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2.5} fill={col} fillOpacity={0.82} stroke={ring ?? 'var(--bg)'} strokeWidth={sw} />
      : n.mode === 'dynamic'
      ? <rect x={-r * 0.82} y={-r * 0.82} width={r * 1.64} height={r * 1.64} rx={1.5} transform="rotate(45)" fill={col} fillOpacity={0.82} stroke={ring ?? 'var(--bg)'} strokeWidth={sw} />
      : <circle r={r} fill={col} fillOpacity={0.78} stroke={ring ?? 'var(--bg)'} strokeWidth={sw} />;
    return (
      <g key={n.id} {...common}>
        {halo}{pageShape}
        {showPageLabel(n) && <text textAnchor="middle" y={r + 11} fill={litNode ? 'var(--fg)' : 'var(--fg-muted)'} style={labelStyle(n, litNode)}>{n.label}</text>}
      </g>
    );
  };

  // counts
  const counts = scope === 'org'
    ? `${ORG_WS.length} workspaces · ${Object.keys(ORG_VAULT_INDEX).length} vaults · ${ORG_MEMBERS.length + ORG_GUESTS.length} people`
    : `${graph.nodes.filter((n) => n.kind === 'page').length} pages · ${graph.links.filter((l) => l.kind === 'wikilink').length} links${sourcesOn ? ` · ${graph.nodes.filter((n) => n.kind === 'source').length} sources` : ''}`;

  const go = (id: string) => {
    if (!graph.byId[id]) return;
    const n = graph.byId[id];
    if (n.kind === 'source') setLayers((l) => ({ ...l, sources: true }));
    setSelected(id);
  };
  const focusVault = (vid: string) => setSelected('vault:' + vid);

  const onEdgeClick = (lk: OrgLink) => {
    const other = lk.s === selected ? lk.t : lk.s;
    if (graph.byId[other]) go(other);
  };

  const order: Record<string, number> = { source: 0, page: 1, vault: 2, ws: 3, group: 4, guest: 5, person: 6 };
  const sortedNodes = useMemo(() => [...graph.nodes].sort((a, b) => order[a.kind] - order[b.kind]), [graph]); // eslint-disable-line react-hooks/exhaustive-deps

  const pagesChipOn = layers.pages === true ? true : pagesTemp ? 'temp' : false;
  const showHistory = history.length > 0 || future.length > 0;

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '10px 14px' : '12px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', rowGap: 8 }}>
        <Icon name={scope === 'org' ? 'graph' : 'folder'} size={16} color="var(--accent)" />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
          {scope === 'org' ? 'Organization' : ((ORG_VAULT_INDEX[scope] || {}).name ?? 'Vault graph')}
        </span>
        {!isMobile && <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)' }}>{counts}</span>}

        {/* layer toggles — org scope */}
        {scope === 'org' && (
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <button onClick={() => setLayers((l) => ({ ...l, people: !l.people }))} style={ogChip(layers.people)}><Icon name="user" size={12} /> People</button>
            <button onClick={() => setLayers((l) => ({ ...l, groups: !l.groups }))} style={ogChip(layers.groups)}><Icon name="users" size={12} /> Groups</button>
            <button
              onClick={() => setLayers((l) => {
                const showing = l.pages === true || (l.pages === false && vaultFocused);
                return { ...l, pages: showing ? (vaultFocused ? 'suppressed' : false) : true };
              })}
              style={ogChip(pagesChipOn)}
              title={pagesTemp ? 'Pages on temporarily (vault selected)' : undefined}>
              <Icon name="file" size={12} /> Pages
            </button>
            <button onClick={() => setLayers((l) => ({ ...l, sources: !l.sources }))} style={ogChip(layers.sources)}><Icon name="link" size={12} /> Sources</button>
          </div>
        )}

        {/* sources only — vault scope (wiki tab) */}
        {scope !== 'org' && !wikiScope && (
          <button onClick={() => setLayers((l) => ({ ...l, sources: !l.sources }))} style={ogChip(layers.sources)}><Icon name="link" size={12} /> Sources</button>
        )}
        {scope !== 'org' && wikiScope && (
          <button onClick={() => setLayers((l) => ({ ...l, sources: !l.sources }))} style={ogChip(layers.sources)}><Icon name="link" size={12} /> Sources</button>
        )}

        {/* workspace filter chips — org scope desktop */}
        {scope === 'org' && !isMobile && (
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            {ORG_WS.map((ws) => {
              const on = !wsOff[ws.id]; const col = wsCol(ws.id);
              return (
                <button key={ws.id} onClick={() => isolateWs(ws.id)} style={ogChip(on, on ? hexToRgba(col, 0.55) : undefined)}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? col : 'var(--fg-faint)' }} />{ws.name}
                </button>
              );
            })}
          </div>
        )}

        {/* search — org scope */}
        {scope === 'org' && <OgSearch graph={graph} theme={theme} onPick={go} />}

        {/* right-side controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {showHistory && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={goBack} disabled={!history.length} title="Back to previous selection"
                style={{ ...ogIconBtn(), opacity: history.length ? 1 : 0.4, cursor: history.length ? 'pointer' : 'default' }}><Icon name="arrowLeft" size={14} /></button>
              <button onClick={goForward} disabled={!future.length} title="Forward to next selection"
                style={{ ...ogIconBtn(), opacity: future.length ? 1 : 0.4, cursor: future.length ? 'pointer' : 'default' }}><Icon name="arrowRight" size={14} /></button>
            </div>
          )}
          <button onClick={() => zoomBy(0.83)} title="Zoom out" style={ogIconBtn()}><span style={{ fontSize: 17, lineHeight: 1, marginTop: -2 }}>−</span></button>
          <button onClick={() => zoomBy(1.2)} title="Zoom in" style={ogIconBtn()}><Icon name="plus" size={14} /></button>
          <button onClick={rerunReset} title="Re-run layout & reset view" style={ogIconBtn()}><Icon name="loader" size={13} /></button>
          {openGraphHref && (
            <Link to={openGraphHref} title="Open full graph" style={{ ...ogIconBtn(), textDecoration: 'none' }}>
              <Icon name="graph" size={14} />
            </Link>
          )}
        </div>
      </div>

      {/* canvas */}
      <div ref={wrapRef} style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <svg ref={svgRef} width="100%" height="100%" onMouseDown={onBgDown}
          style={{ display: 'block', cursor: pan.current ? 'grabbing' : 'grab', touchAction: 'none' }}>
          <g transform={`translate(${view.x + size.w / 2},${view.y + size.h / 2}) scale(${view.k})`}>
            <g>
              {graph.links.map((lk, i) => {
                if (!vis[lk.s] || !vis[lk.t]) return null;
                const st = edgeStyle(lk);
                const litEdge = !!(activeSet?.has(lk.s) && activeSet?.has(lk.t));
                const op = activeSet ? (litEdge ? Math.min(1, st.op + 0.3) : 0.05) : st.op;
                const clickable = !!(sel && (lk.s === sel || lk.t === sel));
                const hovered = clickable && hoverEdge === i;
                const vOp = hovered ? Math.min(1, op + 0.5) : op;
                const vW = (hovered ? st.w + 1.4 : (litEdge ? st.w + 0.6 : st.w)) / view.k;
                return (
                  <g key={i}>
                    <line ref={(el) => { lineEls.current[i] = el; }} stroke={hovered ? 'var(--accent)' : st.stroke} strokeWidth={vW}
                      strokeOpacity={vOp} strokeDasharray={(st as any).dash ?? undefined} style={{ transition: 'stroke-opacity 0.15s, stroke-width 0.15s' }} />
                    <line ref={(el) => { hitEls.current[i] = el; }} stroke="transparent" strokeWidth={14 / view.k}
                      style={{ pointerEvents: clickable ? 'stroke' : 'none', cursor: clickable ? 'pointer' : 'default' }}
                      onMouseDown={clickable ? (e) => e.stopPropagation() : undefined}
                      onMouseEnter={clickable ? () => setHoverEdge(i) : undefined}
                      onMouseLeave={clickable ? () => setHoverEdge((p) => (p === i ? null : p)) : undefined}
                      onClick={clickable ? () => onEdgeClick(lk) : undefined} />
                  </g>
                );
              })}
            </g>
            <g>{sortedNodes.map((n) => (vis[n.id] ? renderNode(n) : null))}</g>
          </g>
        </svg>

        {/* inspector */}
        {sel && (
          <GraphInspector nodeId={sel} graph={graph} theme={theme} isMobile={isMobile}
            onClose={() => setSelected(null)} onGo={go} onFocusVault={focusVault}
            openGraphHref={openGraphHref} />
        )}
      </div>
    </div>
  );
}
