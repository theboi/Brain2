/* Brain2 Console — Wiki graph view.
   An Obsidian-style force-directed graph of a vault's wiki-links.
   • Nodes = wiki pages, sized by number of connections (degree).
   • Edges = [[wiki-links]] between pages within the same vault.
   • Live physics sim (repulsion + link springs + gravity) painted straight to
     the DOM each frame for smoothness; React only re-renders on hover / vault /
     pan / zoom changes.
   • Hover a node → it and its neighbours light up, everything else dims and the
     cluster gently re-settles, exactly like Obsidian's graph. */

// ── data → graph model ───────────────────────────────────────────────────────
function buildVaultGraph(project) {
  const group = WIKI_TREE.find((g) => g.project === project) || WIKI_TREE[0];
  const pages = group.pages;
  const raw = WIKI_GRAPH_LINKS[project] || [];
  const ids = new Set(pages.map((p) => p.topic));
  const links = raw.filter(([s, t]) => ids.has(s) && ids.has(t)).map(([s, t]) => ({ s, t }));
  const deg = {}; const adj = {};
  pages.forEach((p) => { deg[p.topic] = 0; adj[p.topic] = new Set(); });
  links.forEach(({ s, t }) => { deg[s]++; deg[t]++; adj[s].add(t); adj[t].add(s); });
  const nodes = pages.map((p) => ({ id: p.topic, v: p.v, isNew: p.isNew, deg: deg[p.topic] }));
  return { project: group.project, nodes, links, adj, deg };
}

const nodeRadius = (deg) => 5.5 + Math.sqrt(deg) * 3.4;

// deterministic per-vault PRNG so a vault always seeds the same layout
function makeRand(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
const hashStr = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// ── the graph ────────────────────────────────────────────────────────────────
function GraphView({ project, selected, onSelect, isMobile }) {
  const vaults = WIKI_TREE.map((g) => g.project);
  const [vault, setVault] = React.useState(project);
  const [hover, setHover] = React.useState(null);
  React.useEffect(() => { setVault(project); setHover(null); }, [project]);

  const graph = React.useMemo(() => buildVaultGraph(vault), [vault]);
  // a hover id is only valid if it still exists in the current vault's graph —
  // guards against a stale hover (from a prior vault/page) crashing the render.
  React.useEffect(() => { setHover(null); }, [vault]);
  const [view, setView] = React.useState({ x: 0, y: 0, k: 1 });
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  const wrapRef = React.useRef(null);
  const svgRef = React.useRef(null);
  const nodeEls = React.useRef({});
  const lineEls = React.useRef([]);

  // refs the rAF loop reads (so we start the loop only once)
  const sim = React.useRef({ vault: null, nodes: [], byId: {} });
  const graphRef = React.useRef(graph); graphRef.current = graph;
  const vaultRef = React.useRef(vault); vaultRef.current = vault;
  const sizeRef = React.useRef(size); sizeRef.current = size;
  const viewRef = React.useRef(view); viewRef.current = view;
  const alpha = React.useRef(1);
  const drag = React.useRef(null);
  const pan = React.useRef(null);

  // measure
  React.useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // seed positions when the vault changes (or first real size)
  const ensureSeed = () => {
    const s = sim.current; const v = vaultRef.current; const g = graphRef.current;
    const { w, h } = sizeRef.current;
    if (s.vault === v && s.nodes.length) return;
    if (!w || !h) return;
    const rand = makeRand(hashStr(v));
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.32;
    s.nodes = g.nodes.map((n, i) => {
      const ang = (i / g.nodes.length) * Math.PI * 2 + rand() * 0.6;
      const rr = R * (0.45 + rand() * 0.6);
      return { id: n.id, deg: n.deg, r: nodeRadius(n.deg), x: cx + Math.cos(ang) * rr, y: cy + Math.sin(ang) * rr, vx: 0, vy: 0, fx: null, fy: null };
    });
    s.byId = {}; s.nodes.forEach((n) => { s.byId[n.id] = n; });
    s.vault = v; alpha.current = 1;
  };

  // physics
  const step = () => {
    const { w, h } = sizeRef.current; if (!w) return;
    const s = sim.current; const nodes = s.nodes; const links = graphRef.current.links;
    let a = alpha.current; if (a < 0.02) a = 0.02; // gentle perpetual life, Obsidian-style
    const cx = w / 2, cy = h / 2;
    const REPEL = 6000, LINK_LEN = 118, LINK_K = 0.05, GRAVITY = 0.03, DAMP = 0.84;
    // repulsion
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j];
        let dx = p.x - q.x, dy = p.y - q.y; let d2 = dx * dx + dy * dy; if (d2 < 0.01) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
        const d = Math.sqrt(d2); const f = Math.min(REPEL / d2, 55) * a;
        const ux = dx / d, uy = dy / d;
        p.vx += ux * f; p.vy += uy * f; q.vx -= ux * f; q.vy -= uy * f;
      }
    }
    // link springs
    for (const lk of links) {
      const p = s.byId[lk.s], q = s.byId[lk.t]; if (!p || !q) continue;
      let dx = q.x - p.x, dy = q.y - p.y; let d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (d - LINK_LEN) * LINK_K * a; const ux = dx / d, uy = dy / d;
      p.vx += ux * force; p.vy += uy * force; q.vx -= ux * force; q.vy -= uy * force;
    }
    // gravity + integrate
    for (const p of nodes) {
      p.vx += (cx - p.x) * GRAVITY * a; p.vy += (cy - p.y) * GRAVITY * a;
      if (p.fx != null) { p.x = p.fx; p.y = p.fy; p.vx = 0; p.vy = 0; }
      else {
        // clamp velocity so an exact overlap can never explode into NaN/Infinity
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
      const el = lineEls.current[i]; if (!el) continue;
      const p = s.byId[links[i].s], q = s.byId[links[i].t]; if (!p || !q) continue;
      el.setAttribute('x1', p.x.toFixed(2)); el.setAttribute('y1', p.y.toFixed(2));
      el.setAttribute('x2', q.x.toFixed(2)); el.setAttribute('y2', q.y.toFixed(2));
    }
  };

  // single rAF loop for the component's life
  React.useEffect(() => {
    let raf;
    const frame = () => { ensureSeed(); step(); paint(); raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── pointer: drag nodes, pan background, wheel zoom ─────────────────────────
  const toWorld = (clientX, clientY) => {
    const el = svgRef.current; if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect(); const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  };
  React.useEffect(() => {
    const move = (e) => {
      if (drag.current) {
        const w = toWorld(e.clientX, e.clientY); const n = sim.current.byId[drag.current.id];
        if (n) { n.fx = w.x; n.fy = w.y; }
        if (Math.abs(e.clientX - drag.current.sx) + Math.abs(e.clientY - drag.current.sy) > 4) drag.current.moved = true;
        alpha.current = Math.max(alpha.current, 0.5);
      } else if (pan.current) {
        setView((vw) => ({ ...vw, x: pan.current.ox + (e.clientX - pan.current.sx), y: pan.current.oy + (e.clientY - pan.current.sy) }));
      }
    };
    const up = (e) => {
      if (drag.current) {
        const n = sim.current.byId[drag.current.id]; if (n) { n.fx = null; n.fy = null; }
        if (!drag.current.moved && onSelect) onSelect(drag.current.id);
        drag.current = null;
      }
      pan.current = null;
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [onSelect]);

  const onNodeDown = (e, id) => { e.stopPropagation(); drag.current = { id, sx: e.clientX, sy: e.clientY, moved: false }; alpha.current = Math.max(alpha.current, 0.6); };
  const onBgDown = (e) => { pan.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }; };
  // wheel-zoom must be a NON-passive native listener, otherwise preventDefault()
  // is ignored and the wheel scrolls the page instead of zooming the graph.
  React.useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(2.6, Math.max(0.4, v.k * (e.deltaY < 0 ? 1.12 : 0.893)));
        const wx = (mx - v.x) / v.k, wy = (my - v.y) / v.k;
        return { k, x: mx - wx * k, y: my - wy * k };
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);
  const zoomBy = (f) => setView((v) => {
    const k = Math.min(2.6, Math.max(0.4, v.k * f)); const cx = size.w / 2, cy = size.h / 2;
    const wx = (cx - v.x) / v.k, wy = (cy - v.y) / v.k; return { k, x: cx - wx * k, y: cy - wy * k };
  });
  const reset = () => { setView({ x: 0, y: 0, k: 1 }); alpha.current = 1; };
  const replay = () => { sim.current.vault = null; alpha.current = 1; setHover(null); };

  // ── highlight model ─────────────────────────────────────────────────────────
  const adj = graph.adj;
  // validate hover against the CURRENT graph so a stale id can never be deref'd
  const hov = hover && adj[hover] ? hover : null;
  const hovSet = hov ? adj[hov] : null;
  const lit = (id) => hov && (id === hov || hovSet.has(id));
  const nodeFill = (id) => {
    if (hov) { if (id === hov) return 'var(--accent)'; if (hovSet.has(id)) return 'var(--fg)'; return 'var(--fg-faint)'; }
    if (id === selected) return 'var(--accent)'; return 'var(--fg-muted)';
  };
  const nodeOpacity = (id) => (hov && !lit(id) ? 0.22 : 1);
  const labelFill = (id) => { if (hov) return lit(id) ? 'var(--fg)' : 'var(--fg-faint)'; return id === selected ? 'var(--fg)' : 'var(--fg-muted)'; };

  const cnt = `${graph.nodes.length} pages · ${graph.links.length} links`;

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '10px 14px' : '12px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <Icon name="graph" size={16} color="var(--accent)" />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Vault graph</span>
        {!isMobile && <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)' }}>{cnt}</span>}
        <div style={{ display: 'flex', gap: 4, marginLeft: isMobile ? 0 : 8, padding: 3, borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          {vaults.map((vn) => (
            <button key={vn} onClick={() => { setVault(vn); setHover(null); }} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 600,
              background: vault === vn ? 'var(--surface)' : 'transparent', color: vault === vn ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: vault === vn ? 'var(--shadow-card)' : 'none' }}>
              <Icon name="folder" size={12} color={vault === vn ? 'var(--accent)' : 'var(--fg-faint)'} /> {vn}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {!isMobile && <span style={{ fontSize: 11, color: 'var(--fg-faint)', marginRight: 4 }}>drag nodes · scroll to zoom</span>}
          <button onClick={() => zoomBy(0.83)} title="Zoom out" style={gIconBtn()}><span style={{ fontSize: 17, lineHeight: 1, marginTop: -2 }}>−</span></button>
          <button onClick={() => zoomBy(1.2)} title="Zoom in" style={gIconBtn()}><Icon name="plus" size={14} /></button>
          <button onClick={reset} title="Reset view" style={gIconBtn()}><Icon name="refresh" size={13} /></button>
          <button onClick={replay} title="Re-run layout" style={gIconBtn()}><Icon name="loader" size={13} /></button>
        </div>
      </div>

      {/* canvas */}
      <div ref={wrapRef} style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <svg ref={svgRef} width="100%" height="100%" onMouseDown={onBgDown}
          style={{ display: 'block', cursor: pan.current ? 'grabbing' : 'grab', touchAction: 'none' }}>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {/* edges */}
            <g>
              {graph.links.map((lk, i) => {
                const on = hov && (lk.s === hov || lk.t === hov);
                const stroke = on ? 'var(--accent)' : 'var(--border-strong)';
                const op = hov ? (on ? 0.9 : 0.07) : 0.5;
                return <line key={i} ref={(el) => { lineEls.current[i] = el; }} stroke={stroke} strokeWidth={(on ? 1.8 : 1.2) / view.k} strokeOpacity={op}
                  style={{ transition: 'stroke 0.18s, stroke-opacity 0.18s, stroke-width 0.18s' }} />;
              })}
            </g>
            {/* nodes */}
            <g>
              {graph.nodes.map((n) => {
                const hovered = n.id === hov;
                const isSel = n.id === selected;
                const r = nodeRadius(n.deg) + (hovered ? 3 : 0);
                const showHalo = hovered || (isSel && !hov);
                return (
                  <g key={n.id} ref={(el) => { if (el) nodeEls.current[n.id] = el; else delete nodeEls.current[n.id]; }}
                    style={{ cursor: 'pointer' }} onMouseEnter={() => { setHover(n.id); alpha.current = Math.max(alpha.current, 0.16); }} onMouseLeave={() => setHover(null)}
                    onMouseDown={(e) => onNodeDown(e, n.id)}>
                    {showHalo && <circle r={r + 9} fill="var(--accent)" opacity={0.16} style={{ transition: 'opacity 0.18s' }} />}
                    <circle r={r} fill={nodeFill(n.id)} fillOpacity={nodeOpacity(n.id)}
                      stroke={isSel ? 'var(--accent)' : 'var(--bg)'} strokeWidth={isSel ? 2 / view.k : 1.5 / view.k}
                      style={{ transition: 'fill 0.18s, fill-opacity 0.18s, r 0.18s' }} />
                    <text textAnchor="middle" y={r + 12} fill={labelFill(n.id)} fillOpacity={nodeOpacity(n.id)}
                      style={{ fontFamily: 'var(--ui-font)', fontSize: Math.max(9.5, 11.5 / Math.max(1, view.k * 0.86)), fontWeight: hovered || isSel ? 600 : 500, pointerEvents: 'none', userSelect: 'none', transition: 'fill 0.18s, fill-opacity 0.18s' }}>{n.id}</text>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {/* legend */}
        <div style={{ position: 'absolute', left: 16, bottom: 14, display: 'flex', flexDirection: 'column', gap: 7, padding: '10px 12px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-muted)' }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--accent)' }} /> Current page</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-muted)' }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--fg-muted)' }} /> Wiki page</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-muted)' }}><span style={{ width: 13, height: 2, borderRadius: 2, background: 'var(--border-strong)' }} /> Wiki-link · larger = more links</div>
        </div>
      </div>
    </div>
  );
}

function gIconBtn() { return { width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }; }

Object.assign(window, { GraphView, buildVaultGraph });
