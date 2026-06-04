/* Brain2 Console — Wiki page (tree + page view + history/diff). */

function useStored(key, init) {
  const [v, setV] = React.useState(() => { try { return localStorage.getItem(key) || init; } catch { return init; } });
  React.useEffect(() => { try { localStorage.setItem(key, v); } catch {} }, [v]);
  return [v, setV];
}

function useIsMobile(bp = 820) {
  const [m, setM] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= bp : false));
  React.useEffect(() => {
    const on = () => setM(window.innerWidth <= bp);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [bp]);
  return m;
}

const WTONE = { accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', destructive: 'var(--destructive)', muted: 'var(--fg-muted)' };

// ── Diff view ────────────────────────────────────────────────────────────────
function DiffView({ hunks, compact = false }) {
  const fs = compact ? 12 : 12.5;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', fontFamily: 'var(--mono-font)', fontSize: fs, lineHeight: 1.7 }}>
      {hunks.map((h, i) => {
        const bg = h.type === 'add' ? 'var(--diff-add-bg)' : h.type === 'del' ? 'var(--diff-del-bg)' : 'transparent';
        const gut = h.type === 'add' ? 'var(--diff-add-gutter)' : h.type === 'del' ? 'var(--diff-del-gutter)' : 'transparent';
        const sign = h.type === 'add' ? '+' : h.type === 'del' ? '−' : ' ';
        const col = h.type === 'add' ? 'var(--success)' : h.type === 'del' ? 'var(--destructive)' : 'var(--fg-muted)';
        return (
          <div key={i} style={{ display: 'flex', background: bg }}>
            <span style={{ width: 26, flexShrink: 0, textAlign: 'center', color: col, background: gut, userSelect: 'none' }}>{sign}</span>
            <span style={{ padding: '0 12px', color: h.type === 'ctx' ? 'var(--fg-muted)' : 'var(--fg)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{h.text || '\u00A0'}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Filter dropdown defs + helpers (shared by sidebar + mobile picker) ───────
const WIKI_PAGES_FLAT = WIKI_TREE.flatMap((g) => g.pages.map((p) => ({ ...p, project: g.project })));
function wikiChipDefs(wf, setWf) {
  const projOpts = [{ value: 'all', label: 'All projects', icon: 'layers', count: WIKI_PAGES_FLAT.length }, ...WIKI_TREE.map((g) => ({ value: g.project, label: g.project, icon: 'folder', count: g.pages.length }))];
  const filterOpts = [
    { value: 'all', label: 'All pages', icon: 'layers' },
    { value: 'audit', label: 'Has open audit', icon: 'alert', tone: 'warning', count: WIKI_PAGES_FLAT.filter((p) => p.audits).length },
    { value: 'recent', label: 'Edited last 7d', icon: 'clock', count: WIKI_PAGES_FLAT.filter((p) => p.isNew || p.v >= 4).length },
  ];
  const proj = WIKI_TREE.find((g) => g.project === wf.project);
  const fil = filterOpts.find((o) => o.value === wf.filter);
  return [
    { key: 'project', icon: 'folder', label: proj ? proj.project : 'All projects', active: wf.project !== 'all', title: 'Project', options: projOpts, value: wf.project, onPick: (v) => setWf({ ...wf, project: v }) },
    { key: 'filter', icon: 'sliders', label: wf.filter === 'all' ? 'Filters' : fil.label, tone: fil && fil.tone, active: wf.filter !== 'all', title: 'Filter', options: filterOpts, value: wf.filter, onPick: (v) => setWf({ ...wf, filter: v }), menuWidth: 200 },
  ];
}
function wikiPageMatches(p, wf, q) {
  if (wf.filter === 'audit' && !p.audits) return false;
  if (wf.filter === 'recent' && !(p.isNew || p.v >= 4)) return false;
  if (q && !p.topic.toLowerCase().includes(q.toLowerCase())) return false;
  return true;
}

// ── Desktop sidebar: filter chip · search · collapsible project folders ──────
function WikiSidebar({ wf, setWf, selected, onSelect, width = 264 }) {
  const [q, setQ] = React.useState('');
  const [openF, setOpenF] = React.useState({ default: true, 'research-q3': true, 'launch-docs': true });
  const defs = wikiChipDefs(wf, setWf).filter((d) => d.key !== 'project'); // project = folder tree
  const groups = WIKI_TREE.filter((g) => wf.project === 'all' || wf.project === g.project);
  return (
    <div style={{ width, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <FilterChips defs={defs} size="s" />
        <SidebarSearch value={q} onChange={setQ} placeholder="Search wiki…" />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {groups.map((g) => {
          const rows = g.pages.filter((p) => wikiPageMatches(p, wf, q));
          return (
            <Folder key={g.project} label={g.project} count={rows.length} open={openF[g.project]} onToggle={() => setOpenF((o) => ({ ...o, [g.project]: !o[g.project] }))}>
              {rows.map((p) => <NestRow key={p.topic} icon="wiki" label={p.topic} active={p.topic === selected} badge={p.isNew ? 'NEW' : null} meta={'v' + p.v} onClick={() => onSelect(p.topic)} />)}
              {!rows.length && <div style={{ padding: '4px 10px 8px 27px', fontSize: 11.5, color: 'var(--fg-faint)' }}>No matching pages</div>}
            </Folder>
          );
        })}
      </div>
    </div>
  );
}

// ── Mobile picker: the FIRST screen on the wiki tab — choose a page ───────────
function WikiPageRow({ p, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', padding: '11px 16px', fontFamily: 'var(--ui-font)' }}>
      <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-muted)' }}><Icon name="wiki" size={15} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.topic}</span>
          {p.isNew && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 5, padding: '1px 5px', letterSpacing: '0.04em', flexShrink: 0 }}>NEW</span>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
          {p.project} · v{p.v}{p.audits ? <span style={{ color: 'var(--warning)' }}> · {p.audits} audits</span> : null}
        </span>
      </span>
      <Icon name="chevRight" size={15} color="var(--fg-faint)" />
    </button>
  );
}
function WikiPicker({ wf, setWf, onSelect }) {
  const [q, setQ] = React.useState('');
  const groups = WIKI_TREE.filter((g) => wf.project === 'all' || wf.project === g.project);
  const rows = WIKI_PAGES_FLAT.filter((p) => (wf.project === 'all' || p.project === wf.project) && wikiPageMatches(p, wf, q));
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <FilterChips defs={wikiChipDefs(wf, setWf)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 34, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <Icon name="search" size={15} color="var(--fg-muted)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search wiki…" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{rows.length} pages</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}>
        {rows.map((p) => <WikiPageRow key={p.topic} p={p} onClick={() => onSelect(p.topic)} />)}
        {!rows.length && <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13 }}>No pages match these filters.</div>}
      </div>
    </div>
  );
}

// ── Page view ────────────────────────────────────────────────────────────────
function WikiTabBtn({ label, active, onClick, badge }) {
  return (
    <button onClick={onClick} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 7, height: 42, padding: '0 2px', border: 'none', background: 'transparent', cursor: 'pointer',
      color: active ? 'var(--fg)' : 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13.5, fontWeight: active ? 600 : 500 }}>
      {label}
      {badge != null && <span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', background: active ? 'var(--accent)' : 'var(--surface-2)', color: active ? '#fff' : 'var(--fg-muted)', borderRadius: 6, padding: '1px 6px' }}>{badge}</span>}
      {active && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: 'var(--accent)', borderRadius: 2 }} />}
    </button>
  );
}

function ReadTab({ page, onAudit, onAsk }) {
  const ref = React.useRef(null);
  const [pop, setPop] = React.useState(null);
  React.useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      const text = sel && sel.toString().trim();
      if (!text || text.length < 2 || !ref.current || !sel.rangeCount || !ref.current.contains(sel.anchorNode)) { setPop(null); return; }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setPop({ x: r.left + r.width / 2, y: r.top, text });
    };
    const onSelChange = () => { const s = window.getSelection(); if (!s || !s.toString().trim()) setPop(null); };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('selectionchange', onSelChange);
    return () => { document.removeEventListener('mouseup', onUp); document.removeEventListener('selectionchange', onSelChange); };
  }, []);
  return (
    <div ref={ref} style={{ maxWidth: 720, margin: '0 auto' }}>
      <MiniMD text={page.content} onCite={() => {}} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--fg-muted)' }}>
        <span>Sources: {page.sources}</span><span>·</span><span>Linked concepts: {page.concepts}</span>
        <button onClick={onAudit} style={{ marginLeft: 'auto', ...wbtnGhost() }}><Icon name="chats" size={14} /> Open in chat</button>
      </div>
      {pop && (
        <div style={{ position: 'fixed', left: pop.x, top: pop.y - 48, transform: 'translateX(-50%)', zIndex: 120 }}>
          <div style={{ display: 'flex', gap: 2, padding: 4, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border-strong)', boxShadow: '0 8px 28px rgba(0,0,0,0.35)' }}>
            <button onMouseDown={(e) => { e.preventDefault(); onAsk && onAsk(pop.text); setPop(null); window.getSelection().removeAllRanges(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 12px', border: 'none', borderRadius: 7, background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <Icon name="sparkles" size={14} color="#fff" /> Ask an Agent
            </button>
            <button onMouseDown={(e) => { e.preventDefault(); onAudit && onAudit(); setPop(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 11px', border: 'none', borderRadius: 7, background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              Audit passage
            </button>
          </div>
          <div style={{ position: 'absolute', left: '50%', bottom: -5, transform: 'translateX(-50%) rotate(45deg)', width: 9, height: 9, background: 'var(--surface)', borderRight: '1px solid var(--border-strong)', borderBottom: '1px solid var(--border-strong)' }} />
        </div>
      )}
    </div>
  );
}

function EditTab({ page, mobile }) {
  const [text, setText] = React.useState(page.content);
  const editor = (h) => (
    <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
      style={{ width: '100%', height: h, resize: 'none', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 12.5, lineHeight: 1.7, padding: 14, outline: 'none' }} />
  );
  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>markdown · CodeMirror</div>
        {editor(300)}
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 4 }}>Live preview</div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--bg)' }}><MiniMD text={text} /></div>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 8, fontFamily: 'var(--mono-font)' }}>markdown · CodeMirror</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
          style={{ flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 12.5, lineHeight: 1.7, padding: 14, outline: 'none' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 8 }}>Live preview</div>
        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--bg)' }}><MiniMD text={text} /></div>
      </div>
    </div>
  );
}

function HistoryTab({ mobile }) {
  const [sel, setSel] = React.useState(7);
  const diff = WIKI_DIFFS['6-7'];
  const cur = WIKI_REVISIONS.find((r) => r.v === sel) || WIKI_REVISIONS[0];
  const SRC_ICON = { user: 'pencil', llm_audit: 'sparkles', ingest: 'download' };
  const SRC_TONE = { user: 'muted', llm_audit: 'accent', ingest: 'success' };
  const timeline = (
    <div style={{ overflowY: mobile ? 'visible' : 'auto', paddingRight: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 12 }}>Timeline</div>
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', left: 5, top: 6, bottom: 6, width: 2, background: 'var(--border)' }} />
        {WIKI_REVISIONS.map((r) => {
          const on = r.v === sel;
          return (
            <button key={r.v} onClick={() => setSel(r.v)} style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', padding: '8px 8px 8px 0', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', borderRadius: 8 }}>
              <span style={{ position: 'relative', zIndex: 1, marginTop: 3, width: 12, height: 12, borderRadius: '50%', flexShrink: 0, background: on ? 'var(--accent)' : 'var(--surface)', border: `2px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}` }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <b style={{ fontFamily: 'var(--mono-font)', fontSize: 12.5, fontWeight: 500, color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>v{r.v}</b>
                  <Icon name={SRC_ICON[r.source]} size={12} color={WTONE[SRC_TONE[r.source]]} />
                  <span style={{ fontSize: 11.5, color: 'var(--fg-faint)' }}>{r.t}</span>
                </span>
                <span style={{ display: 'block', fontSize: 12, color: on ? 'var(--fg)' : 'var(--fg-muted)', marginTop: 2 }}>{r.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
  const diffPanel = (
    <div style={{ overflowY: mobile ? 'visible' : 'auto', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>diff: v6 ↔ v7</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button style={wbtnGhost()}>Unified <Icon name="chevDown" size={12} /></button>
        </span>
      </div>
      <DiffView hunks={diff} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: '12px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>Author: <b style={{ color: 'var(--fg)' }}>{cur.who}</b> · {cur.t}<br /><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4 }}>Source of change: <span style={{ color: 'var(--accent)' }}>{cur.label}</span></span></div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button style={wbtnGhost()}><Icon name="history" size={13} /> Restore v{sel}</button>
          <button style={{ ...wbtnGhost(), opacity: 0.5 }}>Branch from here</button>
        </span>
      </div>
    </div>
  );
  if (mobile) return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>{timeline}{diffPanel}</div>;
  return <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, height: '100%' }}>{timeline}{diffPanel}</div>;
}

function SourcesTab() {
  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{WIKI_PAGE_SOURCES.length} sources contributed to this page, derived from provenance.</span>
        <button style={wbtnGhost()}><Icon name="refresh" size={13} /> Re-ingest all</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {WIKI_PAGE_SOURCES.map((s) => (
          <a key={s.id} href="Sources.html" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: 13, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', cursor: 'pointer' }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}><Icon name={s.type === 'img' ? 'image' : 'file'} size={15} /></span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{s.name}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{s.detail}</span>
            </span>
            <Icon name="arrowRight" size={15} color="var(--fg-faint)" />
          </a>
        ))}
      </div>
    </div>
  );
}

function wbtnGhost() { return { display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }; }
function wbtnPrimary() { return { display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }; }

Object.assign(window, { DiffView, WikiSidebar, WikiPicker, wikiChipDefs, wikiPageMatches, WIKI_PAGES_FLAT, WikiTabBtn, ReadTab, EditTab, HistoryTab, SourcesTab, wbtnGhost, wbtnPrimary, WTONE, useStored, useIsMobile });
