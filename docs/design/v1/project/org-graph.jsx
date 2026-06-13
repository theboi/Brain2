/* Brain2 Console — Organization graph view.
   One force-directed canvas for the whole org:
     workspace hubs ← vaults ← wiki pages, plus people / groups / guests
     hanging off the workspaces they can access.
   • Color = workspace (vaults + pages inherit it); groups get their own hues.
   • Edge weight/dash encodes role: thick = Owner/Admin, solid = Member,
     dashed = Viewer / guest / invited, dotted = group membership.
   • scope: 'org' (everything) or a vault id (that vault's wiki-link graph only).
   • Click a node → semantic highlight (a person lights up everything they can
     reach) + inspector (side panel or floating card — user-switchable). */

function useStored(key, init) {
  const [v, setV] = React.useState(() => { try { return localStorage.getItem(key) || init; } catch { return init; } });
  React.useEffect(() => { try { localStorage.setItem(key, v); } catch {} }, [v]);
  return [v, setV];
}

function useIsMobile(bp = 820) {
  const [m, setM] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= bp : false));
  React.useEffect(() => {
    const h = () => setM(window.innerWidth <= bp);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, [bp]);
  return m;
}

const OG_LINK_PARAMS = {
  tether:   { len: 62, k: 0.055 },
  wikilink: { len: 74, k: 0.038 },
  vw:       { len: 112, k: 0.06 },
  access:   { len: 215, k: 0.014 },
  gaccess:  { len: 200, k: 0.02 },
  member:   { len: 85, k: 0.05 },
  guest:    { len: 150, k: 0.02 },
  cites:    { len: 50, k: 0.05 },
  stether:  { len: 78, k: 0.02 },
};
const OG_VAULT_PARAMS = { tether: { len: 96, k: 0.04 }, wikilink: { len: 110, k: 0.04 }, cites: { len: 66, k: 0.05 }, stether: { len: 104, k: 0.03 } };

function ogRand(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function ogHash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ── data → graph model ───────────────────────────────────────────────────────
function buildOrgGraph(scope) {
  const nodes = []; const links = [];
  const addPages = (v, wsId, big) => {
    const pg = ORG_VAULT_PAGES[v.id] || { pages: [], links: [] };
    const mode = v.mode || 'wiki';
    const deg = {};
    pg.links.forEach(([a, b]) => { deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1; });
    for (const p of pg.pages) {
      nodes.push({ id: 'page:' + v.id + ':' + p, kind: 'page', mode, label: p, ws: wsId, vault: v.id, deg: deg[p] || 0,
        r: big ? 5 + Math.sqrt(deg[p] || 0) * 2.6 : 3.6 + Math.sqrt(deg[p] || 0) * 1.5 });
      links.push({ s: 'page:' + v.id + ':' + p, t: 'vault:' + v.id, kind: 'tether', ws: wsId });
    }
    for (const [a, b] of pg.links) links.push({ s: 'page:' + v.id + ':' + a, t: 'page:' + v.id + ':' + b, kind: 'wikilink', ws: wsId });
    // sources — file a page is grounded in; shared sources weave clusters together
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
      for (const r of m.ws) links.push({ s: 'p:' + m.u, t: 'ws:' + r.w, kind: 'access', role: r.role, ws: r.w, invited: m.invited });
      for (const g of acc.groups) links.push({ s: 'p:' + m.u, t: 'g:' + g.id, kind: 'member', group: g.id });
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
  const byId = {}; nodes.forEach((n) => { byId[n.id] = n; });
  const adj = {}; nodes.forEach((n) => { adj[n.id] = new Set(); });
  links.forEach((l) => { if (adj[l.s] && adj[l.t]) { adj[l.s].add(l.t); adj[l.t].add(l.s); } });
  return { scope, nodes, links, adj, byId };
}

// semantic highlight: what does this node "reach"?
function ogClosure(id, graph) {
  const set = new Set([id]); const n = graph.byId[id]; if (!n) return set;
  const wsVaults = (wsId) => { for (const nd of graph.nodes) if (nd.kind === 'vault' && nd.ws === wsId) set.add(nd.id); };
  if (n.kind === 'person') {
    const wsIds = new Set();
    for (const l of graph.links) {
      if (l.kind === 'member' && l.s === id) { set.add(l.t); for (const l2 of graph.links) if (l2.kind === 'gaccess' && l2.s === l.t) { set.add(l2.t); wsIds.add(l2.ws); } }
      if (l.kind === 'access' && l.s === id) { set.add(l.t); wsIds.add(l.ws); }
    }
    wsIds.forEach((w) => wsVaults(w));
  } else if (n.kind === 'guest') {
    for (const l of graph.links) if (l.kind === 'guest' && l.s === id) set.add(l.t);
  } else if (n.kind === 'group') {
    for (const l of graph.links) {
      if (l.kind === 'member' && l.t === id) set.add(l.s);
      if (l.kind === 'gaccess' && l.s === id) { set.add(l.t); wsVaults(l.ws); }
    }
  } else if (n.kind === 'ws') {
    for (const nd of graph.nodes) if ((nd.kind === 'vault' || nd.kind === 'page' || nd.kind === 'source') && nd.ws === n.ws) set.add(nd.id);
    for (const l of graph.links) if ((l.kind === 'access' || l.kind === 'gaccess') && l.t === id) set.add(l.s);
    for (const l of graph.links) if (l.kind === 'member' && set.has(l.t)) set.add(l.s); // group members inherit access
  } else if (n.kind === 'vault') {
    if (graph.byId['ws:' + n.ws]) set.add('ws:' + n.ws);
    for (const nd of graph.nodes) if ((nd.kind === 'page' || nd.kind === 'source') && nd.vault === n.vault) set.add(nd.id);
    for (const l of graph.links) {
      if (l.kind === 'guest' && l.t === id) set.add(l.s);
      if ((l.kind === 'access' || l.kind === 'gaccess') && l.t === 'ws:' + n.ws) set.add(l.s);
    }
  } else if (n.kind === 'page' || n.kind === 'source') {
    set.add('vault:' + n.vault);
    graph.adj[id].forEach((x) => set.add(x));
  }
  return set;
}

// ── shared chrome ────────────────────────────────────────────────────────────
// strategic radial layout when a node is focused: selected node at centre, its
// closure arranged in meaningful rings around it (see per-kind rules below).
function ogFocusLayout(id, graph, vis) {
  const sel = graph.byId[id]; if (!sel) return null;
  const inC = ogClosure(id, graph);
  const ok = (x) => x !== id && inC.has(x) && (!vis || vis[x]);
  const ids = [...inC].filter(ok);
  const kindOf = (x) => (graph.byId[x] || {}).kind;
  const byKind = (kinds) => ids.filter((x) => kinds.includes(kindOf(x)));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pos = new Map(); pos.set(id, { x: 0, y: 0 });
  // deterministic per-node jitter so rings aren't perfectly regular — small
  // angle + radius wobble keeps connector lines from stacking up parallel
  const jitA = (x) => (ogRand(ogHash(x + ':a'))() - 0.5);
  const jitR = (x) => (ogRand(ogHash(x + ':r'))() - 0.5);
  const ring = (arr, radius, phase) => {
    const m = arr.length; if (!m) return;
    arr.forEach((x, i) => {
      const a = (phase || 0) + (i / m) * Math.PI * 2 + jitA(x) * 0.6;
      const rr = radius * (1 + jitR(x) * 0.16);
      pos.set(x, { x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    });
  };
  // pages/sources orbit their already-placed vault
  const cluster = (arr, satR) => {
    const byV = {};
    arr.forEach((x) => { const v = graph.byId[x].vault; (byV[v] = byV[v] || []).push(x); });
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
    // ring 1 (closest) = people + groups with access · ring 2 = the vaults
    const inner = byKind(['person', 'guest', 'group']);
    const vaults = byKind(['vault']);
    const r1 = clamp(112 + inner.length * 6, 120, 220);
    const r2 = r1 + clamp(120 + vaults.length * 6, 130, 200);
    ring(inner, r1, -Math.PI / 2);
    ring(vaults, r2, Math.PI / Math.max(1, vaults.length));
    cluster(byKind(['page', 'source']), 46);
  } else if (sel.kind === 'vault') {
    // vault content hugs the centre; parent workspace + its access pushed FAR away
    const content = byKind(['page', 'source']);
    ring(content, clamp(92 + content.length * 4, 104, 230), -Math.PI / 2);
    const wsNode = byKind(['ws'])[0];
    const access = byKind(['person', 'guest', 'group']);
    const far = { x: 380, y: 0 };
    if (wsNode) pos.set(wsNode, far);
    access.forEach((x, i) => { const a = (i / Math.max(1, access.length)) * Math.PI * 2; pos.set(x, { x: far.x + Math.cos(a) * 76, y: far.y + Math.sin(a) * 76 }); });
  } else if (sel.kind === 'person' || sel.kind === 'guest' || sel.kind === 'group') {
    const inner = byKind(sel.kind === 'group' ? ['person', 'ws'] : ['group', 'ws']);
    const vaults = byKind(['vault']);
    const r1 = clamp(112 + inner.length * 6, 120, 220);
    const r2 = r1 + clamp(116 + vaults.length * 6, 126, 196);
    ring(inner, r1, -Math.PI / 2);
    ring(vaults, r2, Math.PI / Math.max(1, vaults.length));
    cluster(byKind(['page', 'source']), 44);
  } else { // page / source
    ring(byKind(['vault', 'page', 'source']), clamp(78 + ids.length * 5, 88, 190), -Math.PI / 2);
  }
  return pos;
}

function OgSeg({ value, options, onPick }) {
  return (
    <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      {options.map((o) => (
        <button key={o.id} onClick={() => onPick(o.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 600,
          background: value === o.id ? 'var(--surface)' : 'transparent', color: value === o.id ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: value === o.id ? 'var(--shadow-card)' : 'none' }}>
          {o.icon && <Icon name={o.icon} size={12} color={value === o.id ? 'var(--accent)' : 'var(--fg-faint)'} />}{o.label}
        </button>
      ))}
    </div>
  );
}

function OgVaultPicker({ value, theme, onPick }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const cur = ORG_VAULT_INDEX[value] || {};
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: ogWsColor(cur.ws, theme) }}></span>{cur.name || 'Pick a vault'}<Icon name="chevDown" size={12} color="var(--fg-faint)" />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 34, left: 0, width: 234, zIndex: 60, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, boxShadow: 'var(--shadow-card)', padding: 6, maxHeight: 340, overflowY: 'auto' }}>
          {ORG_WS.map((ws) => (
            <div key={ws.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 8px 3px' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: ogWsColor(ws.id, theme) }}></span>{ws.name}
              </div>
              {ws.vaults.map((v) => (
                <button key={v.id} onClick={() => { onPick(v.id); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', border: 'none', borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)', fontSize: 12.5,
                  background: v.id === value ? 'var(--accent-soft)' : 'transparent', color: v.id === value ? 'var(--accent)' : 'var(--fg)' }}>
                  <Icon name="folder" size={13} color={v.id === value ? 'var(--accent)' : 'var(--fg-muted)'} />{v.name}
                  <span style={{ marginLeft: 'auto', fontSize: 10.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{(ORG_VAULT_PAGES[v.id] || { pages: [] }).pages.length} pages</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// search across every node in the graph — workspaces, vaults, pages, sources, people, groups
function OgSearch({ graph, theme, onPick }) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const KIND_LABEL = { ws: 'Workspace', vault: 'Vault', page: 'Page', source: 'Source', person: 'Person', guest: 'Guest', group: 'Group' };
  const fullName = (n) => ((n.kind === 'person' || n.kind === 'guest') && ORG_DIR[n.u]) ? ORG_DIR[n.u].name : n.label;
  const results = React.useMemo(() => {
    const t = q.trim().toLowerCase(); if (!t) return [];
    return graph.nodes.filter((n) => {
      const lbl = (n.label || '').toLowerCase();
      const extra = ((n.kind === 'person' || n.kind === 'guest') && ORG_DIR[n.u]) ? ORG_DIR[n.u].name.toLowerCase() : '';
      return lbl.includes(t) || extra.includes(t);
    }).slice(0, 14);
  }, [q, graph]);
  const swatch = (n) => {
    const c = n.kind === 'group' ? ogGroupColor(n.group, theme) : (n.kind === 'person' || n.kind === 'guest') ? 'var(--accent)' : ogWsColor(n.ws, theme);
    if (n.kind === 'person' || n.kind === 'guest') return <span style={{ width: 8, height: 8, borderRadius: '50%', border: `1.6px solid ${c}`, flexShrink: 0 }}></span>;
    if (n.kind === 'source') return <span style={{ width: 8, height: 8, borderRadius: 1.5, background: hexToRgba(c, 0.4), transform: 'rotate(45deg)', flexShrink: 0 }}></span>;
    return <span style={{ width: 8, height: 8, borderRadius: (n.kind === 'page' && n.mode === 'static') ? 2 : '50%', background: c, flexShrink: 0 }}></span>;
  };
  const pick = (n) => { onPick(n.id); setQ(''); setOpen(false); };
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
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
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

function ogChip(on, color) {
  // on: true = permanently on, 'temp' = temporarily on (vault focus), false = off
  const isTemp = on === 'temp';
  const isOn = on === true;
  return { display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 600,
    border: `1px ${isTemp ? 'dashed' : 'solid'} ${(isOn || isTemp) ? (color || 'var(--accent-line)') : 'var(--border)'}`,
    background: isOn ? (color ? hexToRgba(color, 0.1) : 'var(--accent-soft)') : isTemp ? 'var(--accent-soft)' : 'transparent',
    color: (isOn || isTemp) ? (color ? 'var(--fg)' : 'var(--accent)') : 'var(--fg-faint)',
    opacity: isTemp ? 0.72 : 1 };
}
function ogIconBtn() { return { width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }; }
function ogModeSwatch(mode, color) {
  if (mode === 'static') return <span style={{ width: 11, height: 11, borderRadius: 2.5, background: color, flexShrink: 0 }}></span>;
  if (mode === 'dynamic') return <span style={{ width: 9, height: 9, borderRadius: 1.5, background: color, transform: 'rotate(45deg)', flexShrink: 0 }}></span>;
  return <span style={{ width: 11, height: 11, borderRadius: '50%', background: color, flexShrink: 0 }}></span>;
}
function ogShapeSwatch() {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--fg-muted)' }}></span>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--fg-muted)' }}></span>
      <span style={{ width: 7.5, height: 7.5, borderRadius: 1, background: 'var(--fg-muted)', transform: 'rotate(45deg)' }}></span>
    </span>
  );
}

// ── the view ────────────────────────────────────────────────────────────────
function OrgGraphView({ theme, isMobile, scope = 'org', openGraphHref }) {
  const [layers, setLayers] = React.useState({ people: true, groups: true, pages: false, sources: false });
  const [wsOff, setWsOff] = React.useState({});
  const [selected, setSelected] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [future, setFuture] = React.useState([]);
  const prevSelRef = React.useRef(null);
  const navRef = React.useRef(null); // 'back' | 'forward' when navigating via the buttons
  const skipHistRef = React.useRef(false);
  const [hover, setHover] = React.useState(null);
  const [hoverEdge, setHoverEdge] = React.useState(null);
  const [view, setView] = React.useState({ x: 0, y: 0, k: 1 });
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [inspVariant, setInspVariant] = useStored('b2-graph-inspector', 'panel');

  const graph = React.useMemo(() => buildOrgGraph(scope), [scope]);
  React.useEffect(() => { setHover(null); setSelected(null); }, [scope]);

  // selection history — back/forward walk through previously-focused nodes
  React.useEffect(() => {
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
  // pressing a workspace isolates it (others hidden); pressing the lone workspace restores all
  const isolateWs = (id) => setWsOff((m) => {
    const onIds = ORG_WS.filter((w) => !m[w.id]).map((w) => w.id);
    if (onIds.length === 1 && onIds[0] === id) return {};
    const next = {}; ORG_WS.forEach((w) => { if (w.id !== id) next[w.id] = true; });
    return next;
  });

  // visibility (layer toggles + workspace filter)
  // selecting a vault / page / source temporarily forces pages visible, even if the layer is off
  const selNode = selected && graph.byId[selected];
  const vaultFocused = !!(selNode && (selNode.kind === 'vault' || selNode.kind === 'page' || selNode.kind === 'source'));
  // when a vault is (re)selected while pages were suppressed, lift the suppression → temp ON
  React.useEffect(() => {
    if (vaultFocused && layers.pages === 'suppressed') setLayers((l) => ({ ...l, pages: false }));
  }, [vaultFocused]);
  const pagesTemp = layers.pages === false && vaultFocused;
  // in vault scope, pages are always visible (no toggle exposed)
  const pagesOn = scope !== 'org' || layers.pages === true || pagesTemp;
  const sourcesOn = layers.sources;
  const vis = React.useMemo(() => {
    const m = {};
    for (const n of graph.nodes) {
      let v = true;
      if (n.kind === 'ws' || n.kind === 'vault') v = !wsOff[n.ws];
      else if (n.kind === 'page') v = pagesOn && !wsOff[n.ws];
      else if (n.kind === 'source') v = sourcesOn && !wsOff[n.ws];
      else if (n.kind === 'group') v = layers.groups && n.wsAll.some((w) => !wsOff[w]);
      else if (n.kind === 'person' || n.kind === 'guest') v = layers.people && (!n.wsAll.length || n.wsAll.some((w) => !wsOff[w]));
      m[n.id] = v;
    }
    return m;
  }, [graph, layers, wsOff, pagesOn, sourcesOn]);

  const wrapRef = React.useRef(null);
  const svgRef = React.useRef(null);
  const nodeEls = React.useRef({});
  const lineEls = React.useRef([]);
  const hitEls = React.useRef([]);
  const sim = React.useRef({ scope: null, nodes: [], byId: {} });
  const graphRef = React.useRef(graph); graphRef.current = graph;
  const scopeRef = React.useRef(scope); scopeRef.current = scope;
  const visRef = React.useRef(vis); visRef.current = vis;
  const sizeRef = React.useRef(size); sizeRef.current = size;
  const viewRef = React.useRef(view); viewRef.current = view;
  const inspVariantRef = React.useRef(inspVariant); inspVariantRef.current = inspVariant;
  const isMobileRef = React.useRef(isMobile); isMobileRef.current = isMobile;
  const alpha = React.useRef(1);
  const drag = React.useRef(null);
  const pan = React.useRef(null);
  // smooth view: all zoom goes through viewTarget; the RAF loop eases view → target.
  const viewTarget = React.useRef({ x: 0, y: 0, k: 1 });
  const focusRef = React.useRef(null);   // node id currently pulled to center
  const focusSetRef = React.useRef(null); // its closure (kept central while others drift out)
  const focusPosRef = React.useRef(null); // explicit per-node ring targets (ogFocusLayout)
  const fitReq = React.useRef(null);      // { type:'focus', id } | { type:'reset' }
  const clampK = (k) => Math.min(2.6, Math.max(0.32, k));
  const setViewNow = (nv) => { viewTarget.current = nv; setView(nv); };
  const setViewSmooth = (nv) => { viewTarget.current = nv; };

  React.useEffect(() => { alpha.current = Math.max(alpha.current, 0.5); }, [vis]);

  React.useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    let t = null, first = true;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
      if (first) { first = false; return; }
      // re-run the layout (and re-fit) when the canvas size actually changes
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

  // fit-to-viewport zoom once the canvas is measured (and on reset)
  const fitK = (w, h) => Math.min(1.15, Math.max(0.4, Math.min(w / 1040, h / 660)));
  const fitted = React.useRef(false);
  React.useEffect(() => {
    if (!fitted.current && size.w > 0 && size.h > 0) { fitted.current = true; setViewNow({ x: 0, y: 0, k: fitK(size.w, size.h) }); }
  }, [size]);
  React.useEffect(() => { if (fitted.current) setViewNow({ x: 0, y: 0, k: scope === 'org' ? fitK(size.w, size.h) : 1 }); }, [scope]);

  // focus-on-select: pull the picked node to center, let neighbors ring around it,
  // then ease the view to frame the selection once the layout settles
  React.useEffect(() => {
    const id = selected && graph.byId[selected] ? selected : null;
    focusRef.current = id;
    focusSetRef.current = id ? ogClosure(id, graph) : null;
    focusPosRef.current = id ? ogFocusLayout(id, graph, vis) : null;
    fitReq.current = id ? { type: 'focus', id, t0: performance.now() } : { type: 'reset' };
    alpha.current = 1;
  }, [selected, scope, vis]);

  // seed positions in WORLD coords centered at (0,0) — independent of any
  // transient size measurement (the view transform handles centering):
  // ws hubs on a ring, vaults near their hub, pages near their vault,
  // people/groups/guests near the centroid of what they can reach
  const ensureSeed = () => {
    const s = sim.current; const sc = scopeRef.current; const g = graphRef.current;
    if (s.scope === sc && s.nodes.length) return;
    const rand = ogRand(ogHash(sc));
    const cx = 0, cy = 0;
    const R = 230;
    const wsPos = {}; const vPos = {};
    ORG_WS.forEach((ws, i) => { const a = (i / ORG_WS.length) * Math.PI * 2 - Math.PI / 2; wsPos[ws.id] = { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }; });
    ORG_WS.forEach((ws) => ws.vaults.forEach((v, i) => {
      const base = wsPos[ws.id]; const a = (i / Math.max(1, ws.vaults.length)) * Math.PI * 2 + rand() * 1.2;
      vPos[v.id] = { x: base.x + Math.cos(a) * 78, y: base.y + Math.sin(a) * 78 };
    }));
    s.nodes = g.nodes.map((n) => {
      let p;
      if (n.kind === 'ws') p = wsPos[n.ws];
      else if (n.kind === 'vault') p = (sc === 'org' ? vPos[n.vault] : { x: cx, y: cy });
      else if (n.kind === 'page' || n.kind === 'source') { const b = (sc === 'org' ? vPos[n.vault] : { x: cx, y: cy }); const a = rand() * Math.PI * 2; const rr = (sc === 'org' ? 30 : 90) + rand() * (sc === 'org' ? 28 : 110); p = { x: b.x + Math.cos(a) * rr, y: b.y + Math.sin(a) * rr }; }
      else { // person / group / guest → centroid of reachable workspaces
        const pts = (n.wsAll || []).map((wid) => wsPos[wid]).filter(Boolean);
        const b = pts.length ? { x: pts.reduce((q, t) => q + t.x, 0) / pts.length, y: pts.reduce((q, t) => q + t.y, 0) / pts.length } : { x: cx, y: cy };
        p = { x: b.x + (rand() - 0.5) * 90, y: b.y + (rand() - 0.5) * 90 };
      }
      return { id: n.id, kind: n.kind, r: n.r, x: p.x, y: p.y, vx: 0, vy: 0, fx: null, fy: null };
    });
    s.byId = {}; s.nodes.forEach((n) => { s.byId[n.id] = n; });
    s.scope = sc; alpha.current = 1;
  };

  const ogMass = (n) => n.kind === 'ws' ? 3.1 : n.kind === 'vault' ? (scopeRef.current !== 'org' ? 2.6 : 1.7) : n.kind === 'group' ? 1.6 : (n.kind === 'person' || n.kind === 'guest') ? 1.5 : 0.6;
  const ogGravity = (n) => n.kind === 'ws' ? 0.035 : n.kind === 'vault' ? (scopeRef.current !== 'org' ? 0.08 : 0.018) : (n.kind === 'page' || n.kind === 'source') ? 0.012 : 0.014;

  const step = () => {
    const s = sim.current; const nodes = s.nodes; const links = graphRef.current.links; const vv = visRef.current;
    let a = alpha.current; if (a < 0.02) a = 0.02;
    const cx = 0, cy = 0; const DAMP = 0.84;
    const params = scopeRef.current === 'org' ? OG_LINK_PARAMS : { ...OG_LINK_PARAMS, ...OG_VAULT_PARAMS };
    const fpos = focusPosRef.current; const focusing = !!fpos;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i]; if (!vv[p.id]) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j]; if (!vv[q.id]) continue;
        let dx = p.x - q.x, dy = p.y - q.y; let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
        const d = Math.sqrt(d2);
        const f = Math.min(2100 * ogMass(p) * ogMass(q) / d2, 75) * a * (focusing ? 0.5 : 1);
        const ux = dx / d, uy = dy / d;
        p.vx += ux * f; p.vy += uy * f; q.vx -= ux * f; q.vy -= uy * f;
      }
    }
    for (const lk of links) {
      if (!vv[lk.s] || !vv[lk.t]) continue;
      const p = s.byId[lk.s], q = s.byId[lk.t]; if (!p || !q) continue;
      const pr = params[lk.kind] || OG_LINK_PARAMS.wikilink;
      let dx = q.x - p.x, dy = q.y - p.y; let d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (d - pr.len) * pr.k * a * (focusing ? 0.22 : 1); const ux = dx / d, uy = dy / d;
      p.vx += ux * force; p.vy += uy * force; q.vx -= ux * force; q.vy -= uy * force;
    }
    const fs = focusSetRef.current; const fid = focusRef.current;
    for (const p of nodes) {
      if (!vv[p.id]) continue;
      const tgt = fpos && fpos.get(p.id);
      if (tgt) { const ks = (p.id === fid ? 0.3 : 0.16); p.vx += (tgt.x - p.x) * ks * a; p.vy += (tgt.y - p.y) * ks * a; }
      else if (fs) { const d = Math.hypot(p.x, p.y) || 0.01; const s2 = (560 - d) * 0.012 * a; p.vx += (p.x / d) * s2; p.vy += (p.y / d) * s2; } // clear non-focused nodes to an outer ring
      else { const gv = ogGravity(p) * a; p.vx += (cx - p.x) * gv; p.vy += (cy - p.y) * gv; }
      if (p.fx != null) { p.x = p.fx; p.y = p.fy; p.vx = 0; p.vy = 0; }
      else {
        const sp = Math.hypot(p.vx, p.vy); const MAX = 120;
        if (sp > MAX) { p.vx = p.vx / sp * MAX; p.vy = p.vy / sp * MAX; }
        p.x += p.vx; p.y += p.vy; p.vx *= DAMP; p.vy *= DAMP;
        if (!isFinite(p.x) || !isFinite(p.y)) { p.x = cx + (Math.random() - 0.5) * 40; p.y = cy + (Math.random() - 0.5) * 40; p.vx = 0; p.vy = 0; }
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
      const el = lineEls.current[i];
      if (el) { el.setAttribute('x1', x1); el.setAttribute('y1', y1); el.setAttribute('x2', x2); el.setAttribute('y2', y2); }
      const hel = hitEls.current[i];
      if (hel) { hel.setAttribute('x1', x1); hel.setAttribute('y1', y1); hel.setAttribute('x2', x2); hel.setAttribute('y2', y2); }
    }
  };

  React.useEffect(() => {
    let raf;
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
      if (alpha.current > 0.42 && performance.now() - req.t0 < 1400) return; // wait for settle
      // frame set: for a vault, frame only its content (parent ws is pushed off-screen);
      // otherwise frame the whole closure
      const selNode = graphRef.current.byId[req.id];
      let frameSet;
      if (selNode && selNode.kind === 'vault') {
        frameSet = new Set([req.id]);
        for (const n of graphRef.current.nodes) if ((n.kind === 'page' || n.kind === 'source') && n.vault === selNode.vault) frameSet.add(n.id);
      } else frameSet = ogClosure(req.id, graphRef.current);
      const vv = visRef.current;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
      for (const n of sim.current.nodes) {
        if (!frameSet.has(n.id) || !vv[n.id]) continue; any = true;
        if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
      }
      if (!any) { fitReq.current = null; return; }
      // centre the selection in the area NOT covered by the docked inspector panel (desktop)
      // or by the floating bottom card (mobile) — reserve that space so it isn't clipped
      const panelW = (inspVariantRef.current === 'panel' && !isMobileRef.current) ? 312 : 0;
      const bottomH = isMobileRef.current ? Math.round(h * 0.56) : 0;
      const availW = w - panelW;
      const availH = h - bottomH;
      const bw = Math.max(70, maxX - minX), bh = Math.max(70, maxY - minY);
      const k = clampK(Math.min((availW - 130) / bw, (availH - 110) / bh, 1.85));
      const ccx = (minX + maxX) / 2, ccy = (minY + maxY) / 2;
      viewTarget.current = { k, x: availW / 2 - w / 2 - ccx * k, y: availH / 2 - h / 2 - ccy * k };
      fitReq.current = null;
    };
    const frame = () => { ensureSeed(); step(); paint(); animateView(); maybeFit(); raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── pointer ────────────────────────────────────────────────────────────────
  const toWorld = (clientX, clientY) => {
    const el = svgRef.current; if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect(); const v = viewRef.current;
    return { x: (clientX - r.left - r.width / 2 - v.x) / v.k, y: (clientY - r.top - r.height / 2 - v.y) / v.k };
  };
  React.useEffect(() => {
    const move = (e) => {
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
  }, []);

  const onNodeDown = (e, id) => { e.stopPropagation(); drag.current = { id, sx: e.clientX, sy: e.clientY, moved: false }; alpha.current = Math.max(alpha.current, 0.6); };
  const onBgDown = (e) => { pan.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false }; };
  React.useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const rectC = () => el.getBoundingClientRect();
    const handler = (e) => {
      e.preventDefault();
      fitReq.current = null;
      const r = rectC(); const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
      const t = viewTarget.current;
      const k = clampK(t.k * (e.deltaY < 0 ? 1.16 : 0.862));
      const wx = (mx - t.x) / t.k, wy = (my - t.y) / t.k;
      viewTarget.current = { k, x: mx - wx * k, y: my - wy * k };
    };
    // touch: 1 finger pans, 2 fingers pinch-zoom toward the midpoint
    let pinch = null, panT = null;
    const ts = (e) => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches; const r = rectC();
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          mx: (a.clientX + b.clientX) / 2 - r.left - r.width / 2, my: (a.clientY + b.clientY) / 2 - r.top - r.height / 2,
          base: { ...viewTarget.current } };
        panT = null;
      } else if (e.touches.length === 1) {
        panT = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, ox: viewRef.current.x, oy: viewRef.current.y };
      }
    };
    const tm = (e) => {
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
    const te = (e) => {
      if (e.touches.length === 0) { pinch = null; panT = null; }
      else if (e.touches.length === 1) { pinch = null; panT = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, ox: viewRef.current.x, oy: viewRef.current.y }; }
    };
    el.addEventListener('wheel', handler, { passive: false });
    el.addEventListener('touchstart', ts, { passive: false });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    return () => { el.removeEventListener('wheel', handler); el.removeEventListener('touchstart', ts); el.removeEventListener('touchmove', tm); el.removeEventListener('touchend', te); };
  }, []);
  const zoomBy = (f) => { fitReq.current = null; const t = viewTarget.current; const k = clampK(t.k * f); const wx = -t.x / t.k, wy = -t.y / t.k; setViewSmooth({ k, x: -wx * k, y: -wy * k }); };
  const resetView = () => { fitReq.current = null; skipHistRef.current = true; setHistory([]); setFuture([]); setSelected(null); setViewSmooth({ x: 0, y: 0, k: scope === 'org' ? fitK(size.w, size.h) : 1 }); alpha.current = Math.max(alpha.current, 0.4); };
  const replay = () => { sim.current.scope = null; alpha.current = 1; setHover(null); };
  // merged control: re-seed the layout AND reset the view in one press
  const rerunReset = () => { replay(); resetView(); };

  // ── highlight model ────────────────────────────────────────────────────────
  const hov = hover && graph.byId[hover] && vis[hover] ? hover : null;
  const sel = selected && graph.byId[selected] ? selected : null;
  const activeSet = React.useMemo(() => {
    if (hov) { const s = new Set([hov]); graph.adj[hov].forEach((x) => s.add(x)); return s; }
    if (sel) return ogClosure(sel, graph);
    return null;
  }, [hov, sel, graph]);
  const dimmed = (id) => activeSet && !activeSet.has(id);

  const wsCol = (id) => ogWsColor(id, theme);
  const ogSrcCol = theme === 'light' ? '#A9762E' : '#D9A441';
  const ogGroupTone = theme === 'light' ? '#5B6472' : '#9AA6B8';
  const nodeColor = (n) => n.kind === 'group' ? ogGroupTone : (n.kind === 'person' || n.kind === 'guest') ? 'var(--accent)' : wsCol(n.ws);

  // edges are deliberately uniform — role / guest / membership detail lives in the
  // inspector, not in line weight or dashes (keeps the canvas legible without a legend)
  const edgeStyle = (l) => {
    const wc = wsCol(l.ws);
    switch (l.kind) {
      case 'tether': return { stroke: wc, w: 1, op: 0.18 };
      case 'wikilink': return { stroke: wc, w: 1.1, op: 0.34 };
      case 'vw': return { stroke: wc, w: 1.7, op: 0.6 };
      case 'access': return { stroke: wc, w: 1.6, op: 0.5 };
      case 'gaccess': return { stroke: ogGroupTone, w: 1.6, op: 0.5 };
      case 'member': return { stroke: ogGroupTone, w: 1.3, op: 0.5 };
      case 'guest': return { stroke: wc, w: 1.5, op: 0.5 };
      case 'cites': return { stroke: wc, w: 1.1, op: 0.34, dash: '4 3' };
      case 'stether': return { stroke: wc, w: 1, op: 0.12 };
      default: return { stroke: 'var(--border-strong)', w: 1, op: 0.4 };
    }
  };

  const showPageLabel = (n) => scope !== 'org' || view.k > 1.02 || (activeSet && activeSet.has(n.id)) || hov === n.id;

  // ── node renderers ─────────────────────────────────────────────────────────
  const labelStyle = (n, lit) => ({ fontFamily: 'var(--ui-font)', pointerEvents: 'none', userSelect: 'none', transition: 'fill 0.18s',
    fontSize: n.kind === 'ws' ? 12.5 : (n.kind === 'page' || n.kind === 'source') ? Math.max(9, 10.5 / Math.max(1, view.k * 0.9)) : 10.5,
    fontWeight: n.kind === 'ws' ? 700 : lit ? 600 : 500 });

  const renderNode = (n) => {
    const col = nodeColor(n);
    const lit = hov === n.id || sel === n.id;
    const dim = dimmed(n.id);
    const r = n.r + (hov === n.id ? 2 : 0);
    const common = {
      ref: (el) => { if (el) nodeEls.current[n.id] = el; else delete nodeEls.current[n.id]; },
      style: { cursor: 'pointer', opacity: dim ? 0.13 : 1, transition: 'opacity 0.18s' },
      onMouseEnter: () => { setHover(n.id); alpha.current = Math.max(alpha.current, 0.12); },
      onMouseLeave: () => setHover(null),
      onMouseDown: (e) => onNodeDown(e, n.id),
    };
    const halo = lit && <circle r={r + 9} fill={col} opacity={0.15}></circle>;
    const ring = sel === n.id ? 'var(--accent)' : null;
    if (n.kind === 'ws') return (
      <g key={n.id} {...common}>
        {halo}
        <circle r={r} fill={hexToRgba(col, theme === 'light' ? 0.08 : 0.1)} stroke={ring || col} strokeWidth={(sel === n.id ? 2.4 : 1.7) / view.k}></circle>
        <g transform="translate(-8,-8)"><Icon name={n.private ? 'lock' : 'layers'} size={16} color={col} /></g>
        <text textAnchor="middle" y={r + 17} fill={col} style={labelStyle(n, lit)}>{n.label}</text>
      </g>
    );
    if (n.kind === 'vault') return (
      <g key={n.id} {...common}>
        {halo}
        <circle r={r} fill={col} stroke={ring || 'var(--bg)'} strokeWidth={(sel === n.id ? 2.4 : 1.5) / view.k}></circle>
        <g transform={`translate(${-r * 0.5},${-r * 0.5})`}><Icon name="folder" size={r} color={theme === 'light' ? '#FFFFFF' : '#0B0D10'} /></g>
        <text textAnchor="middle" y={r + 14} fill={lit ? 'var(--fg)' : 'var(--fg-muted)'} style={labelStyle(n, lit)}>{n.label}</text>
      </g>
    );
    if (n.kind === 'group') return (
      <g key={n.id} {...common}>
        {halo}
        <circle r={r} fill={hexToRgba(col, 0.12)} stroke={ring || col} strokeWidth={(sel === n.id ? 2.4 : 1.5) / view.k} strokeDasharray="4 3"></circle>
        <g transform="translate(-6.5,-6.5)"><Icon name="users" size={13} color={col} /></g>
        <text textAnchor="middle" y={r + 14} fill={col} style={labelStyle(n, lit)}>{n.label}</text>
      </g>
    );
    if (n.kind === 'person' || n.kind === 'guest') {
      return (
        <g key={n.id} {...common}>
          {halo}
          <circle r={r} fill="var(--surface)" stroke={ring || (lit ? 'var(--accent)' : 'var(--border-strong)')} strokeWidth={(sel === n.id ? 2.4 : 1.5) / view.k}></circle>
          <text textAnchor="middle" dy="3.5" fill={lit ? 'var(--accent)' : 'var(--fg)'} style={{ fontFamily: 'var(--ui-font)', fontSize: 10, fontWeight: 700, pointerEvents: 'none', userSelect: 'none' }}>{ORG_DIR[n.u].name[0]}</text>
          <text textAnchor="middle" y={r + 14} fill={lit ? 'var(--fg)' : 'var(--fg-muted)'} style={labelStyle(n, lit)}>{n.label}{n.kind === 'guest' ? ' ⊞' : ''}</text>
        </g>
      );
    }
    if (n.kind === 'source') {
      const sr = r;
      // sources inherit the vault's colour, just rendered faint — the label stays full opacity
      const vcol = wsCol(n.ws);
      const showGlyph = view.k > 1.05 || lit || scope !== 'org';
      return (
        <g key={n.id} {...common}>
          {lit && <circle r={sr + 9} fill={vcol} opacity={0.16}></circle>}
          <rect x={-sr} y={-sr} width={sr * 2} height={sr * 2} rx={2} transform="rotate(45)" fill={hexToRgba(vcol, theme === 'light' ? 0.09 : 0.12)} stroke={hexToRgba(vcol, lit ? 0.6 : 0.4)} strokeWidth={(sel === n.id ? 2 : 1.3) / view.k}></rect>
          {showGlyph && <g transform="translate(-5.5,-5.5)"><Icon name={ORG_SRC_GLYPH[n.srcType] || 'file'} size={11} color={hexToRgba(vcol, 0.72)} /></g>}
          {showPageLabel(n) && <text textAnchor="middle" y={sr + 13} fill={lit ? 'var(--fg)' : 'var(--fg-muted)'} style={labelStyle(n, lit)}>{n.label}</text>}
        </g>
      );
    }
    // page — node shape encodes the vault's mode: wiki = dot · static = square · dynamic = diamond
    const sw = (sel === n.id ? 2 : 1) / view.k;
    const pageShape = n.mode === 'static'
      ? <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2.5} fill={col} fillOpacity={0.82} stroke={ring || 'var(--bg)'} strokeWidth={sw}></rect>
      : n.mode === 'dynamic'
      ? <rect x={-r * 0.82} y={-r * 0.82} width={r * 1.64} height={r * 1.64} rx={1.5} transform="rotate(45)" fill={col} fillOpacity={0.82} stroke={ring || 'var(--bg)'} strokeWidth={sw}></rect>
      : <circle r={r} fill={col} fillOpacity={0.78} stroke={ring || 'var(--bg)'} strokeWidth={sw}></circle>;
    return ( // page
      <g key={n.id} {...common}>
        {halo}
        {pageShape}
        {showPageLabel(n) && <text textAnchor="middle" y={r + 11} fill={lit ? 'var(--fg)' : 'var(--fg-muted)'} style={labelStyle(n, lit)}>{n.label}</text>}
      </g>
    );
  };

  // ── chrome data ────────────────────────────────────────────────────────────
  const counts = scope === 'org'
    ? `${ORG_WS.length} workspaces · ${Object.keys(ORG_VAULT_INDEX).length} vaults · ${ORG_MEMBERS.length + ORG_GUESTS.length} people`
    : `${graph.nodes.filter((n) => n.kind === 'page').length} pages · ${graph.links.filter((l) => l.kind === 'wikilink').length} links${layers.sources ? ` · ${graph.nodes.filter((n) => n.kind === 'source').length} sources` : ''}`;

  const go = (id) => {
    if (!graph.byId[id]) return;
    const n = graph.byId[id];
    if (n.kind === 'source') setLayers((l) => ({ ...l, sources: true }));
    setSelected(id);
  };
  const focusVault = (vid) => setSelected('vault:' + vid);
  // clicking an edge touching the selected node walks to the node at the other end
  const onEdgeClick = (lk) => {
    const other = lk.s === selected ? lk.t : lk.s;
    if (graph.byId[other]) go(other);
  };

  const order = { source: 0, page: 1, vault: 2, ws: 3, group: 4, guest: 5, person: 6 };
  const sortedNodes = React.useMemo(() => [...graph.nodes].sort((a, b) => order[a.kind] - order[b.kind]), [graph]);

  const legendRow = (swatch, text) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--fg-muted)' }}>{swatch}{text}</div>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '10px 14px' : '12px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', rowGap: 8 }}>
        <Icon name={scope === 'org' ? 'graph' : 'folder'} size={16} color="var(--accent)" />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{scope === 'org' ? 'Organization' : ((ORG_VAULT_INDEX[scope] || {}).name || 'Vault graph')}</span>
        {!isMobile && <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)' }}>{counts}</span>}
        {scope === 'org' && (
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <button onClick={() => setLayers((l) => ({ ...l, people: !l.people }))} style={ogChip(layers.people)}><Icon name="user" size={12} /> People</button>
            <button onClick={() => setLayers((l) => ({ ...l, groups: !l.groups }))} style={ogChip(layers.groups)}><Icon name="users" size={12} /> Groups</button>
            <button
              onClick={() => setLayers((l) => {
                const showing = l.pages === true || (l.pages === false && vaultFocused);
                return { ...l, pages: showing ? (vaultFocused ? 'suppressed' : false) : true };
              })}
              style={ogChip(layers.pages === true ? true : pagesTemp ? 'temp' : false)}>
              <Icon name="file" size={12} /> Pages
            </button>
            <button onClick={() => setLayers((l) => ({ ...l, sources: !l.sources }))} style={ogChip(layers.sources)}><Icon name="link" size={12} /> Sources</button>
          </div>
        )}
        {scope !== 'org' && (
          <button onClick={() => setLayers((l) => ({ ...l, sources: !l.sources }))} style={ogChip(layers.sources)}><Icon name="link" size={12} /> Sources</button>
        )}
        {scope === 'org' && !isMobile && (
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            {ORG_WS.map((ws) => {
              const on = !wsOff[ws.id]; const col = wsCol(ws.id);
              return (
                <button key={ws.id} onClick={() => isolateWs(ws.id)} style={ogChip(on, on ? hexToRgba(col, 0.55) : null)}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? col : 'var(--fg-faint)' }}></span>{ws.name}
                </button>
              );
            })}
          </div>
        )}
        <OgSearch graph={graph} theme={theme} onPick={go} />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {(history.length > 0 || future.length > 0) && (
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
          {openGraphHref && <a href={openGraphHref} title="Open full graph" style={{ ...ogIconBtn(), textDecoration: 'none' }}><Icon name="graph" size={14} /></a>}
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
                const litEdge = activeSet && activeSet.has(lk.s) && activeSet.has(lk.t);
                const op = activeSet ? (litEdge ? Math.min(1, st.op + 0.3) : 0.05) : st.op;
                const clickable = !!(sel && (lk.s === sel || lk.t === sel));
                const hovered = clickable && hoverEdge === i;
                const vOp = hovered ? Math.min(1, op + 0.5) : op;
                const vW = (hovered ? st.w + 1.4 : (litEdge ? st.w + 0.6 : st.w)) / view.k;
                return (
                  <g key={i}>
                    <line ref={(el) => { lineEls.current[i] = el; }} stroke={hovered ? 'var(--accent)' : st.stroke} strokeWidth={vW}
                      strokeOpacity={vOp} strokeDasharray={st.dash || null} style={{ transition: 'stroke-opacity 0.15s, stroke-width 0.15s' }}></line>
                    <line ref={(el) => { hitEls.current[i] = el; }} stroke="transparent" strokeWidth={14 / view.k}
                      style={{ pointerEvents: clickable ? 'stroke' : 'none', cursor: clickable ? 'pointer' : 'default' }}
                      onMouseDown={clickable ? (e) => e.stopPropagation() : undefined}
                      onMouseEnter={clickable ? () => setHoverEdge(i) : undefined}
                      onMouseLeave={clickable ? () => setHoverEdge((p) => (p === i ? null : p)) : undefined}
                      onClick={clickable ? () => onEdgeClick(lk) : undefined}></line>
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
            variant={inspVariant} setVariant={setInspVariant}
            onClose={() => setSelected(null)} onGo={go} onFocusVault={focusVault}
            pagesOn={pagesOn} onShowPages={() => setLayers((l) => ({ ...l, pages: true }))} scope={scope} />
        )}
      </div>
    </div>
  );
}

Object.assign(window, { OrgGraphView, buildOrgGraph, ogClosure, useStored, useIsMobile });
