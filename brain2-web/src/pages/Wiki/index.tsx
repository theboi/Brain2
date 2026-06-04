/*
 * Brain2 Console — Wiki page. Two-pane browse: sidebar (Filters chip + search +
 * collapsible project folders with topic rows) ▸ page view (breadcrumb, header
 * actions, tabs Read / Edit / History / Sources / Graph) plus a right-side Audit
 * drawer. Mobile lands on a page picker first. Faithful port of docs/design/v1
 * wiki.jsx + app-wiki.jsx.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useMedia, MOBILE_QUERY } from '@/hooks/useMedia';
import {
  WIKI_TREE, WIKI_PAGE, WIKI_REVISIONS, WIKI_DIFFS, WIKI_PAGE_SOURCES, WIKI_PAGES_FLAT,
  type WikiTreePage,
} from '@/lib/wiki';
import {
  FilterChips, Folder, NestRow, SidebarSearch, BTONE, btnGhost as wbtnGhost, btnPrimary as wbtnPrimary,
  type ChipDef,
} from '@/components/browse/Browse';
import { MiniMD } from '@/components/browse/MiniMD';
import { DiffView } from '@/components/browse/DiffView';
import { GraphView } from './GraphView';
import { AuditDrawer } from './AuditDrawer';

interface WikiFilter { project: string; filter: string; }

// ── Filter chip defs + match helper (shared by sidebar + mobile picker) ───────
function wikiChipDefs(wf: WikiFilter, setWf: (f: WikiFilter) => void): ChipDef[] {
  const projOpts = [{ value: 'all', label: 'All projects', icon: 'layers' as const, count: WIKI_PAGES_FLAT.length }, ...WIKI_TREE.map((g) => ({ value: g.project, label: g.project, icon: 'folder' as const, count: g.pages.length }))];
  const filterOpts = [
    { value: 'all', label: 'All pages', icon: 'layers' as const },
    { value: 'audit', label: 'Has open audit', icon: 'alert' as const, tone: 'warning' as const, count: WIKI_PAGES_FLAT.filter((p) => p.audits).length },
    { value: 'recent', label: 'Edited last 7d', icon: 'clock' as const, count: WIKI_PAGES_FLAT.filter((p) => p.isNew || p.v >= 4).length },
  ];
  const proj = WIKI_TREE.find((g) => g.project === wf.project);
  const fil = filterOpts.find((o) => o.value === wf.filter);
  return [
    { key: 'project', icon: 'folder', label: proj ? proj.project : 'All projects', active: wf.project !== 'all', title: 'Project', options: projOpts, value: wf.project, onPick: (v) => setWf({ ...wf, project: v }) },
    { key: 'filter', icon: 'sliders', label: wf.filter === 'all' ? 'Filters' : (fil ? fil.label : 'Filters'), tone: fil && fil.tone, active: wf.filter !== 'all', title: 'Filter', options: filterOpts, value: wf.filter, onPick: (v) => setWf({ ...wf, filter: v }), menuWidth: 200 },
  ];
}
function wikiPageMatches(p: WikiTreePage, wf: WikiFilter, q: string): boolean {
  if (wf.filter === 'audit' && !p.audits) return false;
  if (wf.filter === 'recent' && !(p.isNew || p.v >= 4)) return false;
  if (q && !p.topic.toLowerCase().includes(q.toLowerCase())) return false;
  return true;
}

// ── Desktop sidebar ────────────────────────────────────────────────────────────
function WikiSidebar({ wf, setWf, selected, onSelect, width = 264 }: {
  wf: WikiFilter; setWf: (f: WikiFilter) => void; selected: string; onSelect: (t: string) => void; width?: number;
}) {
  const [q, setQ] = useState('');
  const [openF, setOpenF] = useState<Record<string, boolean>>({ default: true, 'research-q3': true, 'launch-docs': true });
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
            <Folder key={g.project} label={g.project} count={rows.length} open={!!openF[g.project]} onToggle={() => setOpenF((o) => ({ ...o, [g.project]: !o[g.project] }))}>
              {rows.map((p) => <NestRow key={p.topic} icon="wiki" label={p.topic} active={p.topic === selected} badge={p.isNew ? 'NEW' : null} meta={'v' + p.v} onClick={() => onSelect(p.topic)} />)}
              {!rows.length && <div style={{ padding: '4px 10px 8px 27px', fontSize: 11.5, color: 'var(--fg-faint)' }}>No matching pages</div>}
            </Folder>
          );
        })}
      </div>
    </div>
  );
}

// ── Mobile picker ────────────────────────────────────────────────────────────
function WikiPageRow({ p, onClick }: { p: WikiTreePage & { project: string }; onClick: () => void }) {
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
function WikiPicker({ wf, setWf, onSelect }: { wf: WikiFilter; setWf: (f: WikiFilter) => void; onSelect: (t: string) => void }) {
  const [q, setQ] = useState('');
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

// ── Tabs ───────────────────────────────────────────────────────────────────────
function WikiTabBtn({ label, active, onClick, badge }: { label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 7, height: 42, padding: '0 2px', border: 'none', background: 'transparent', cursor: 'pointer',
      color: active ? 'var(--fg)' : 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13.5, fontWeight: active ? 600 : 500 }}>
      {label}
      {badge != null && <span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', background: active ? 'var(--accent)' : 'var(--surface-2)', color: active ? '#fff' : 'var(--fg-muted)', borderRadius: 6, padding: '1px 6px' }}>{badge}</span>}
      {active && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: 'var(--accent)', borderRadius: 2 }} />}
    </button>
  );
}

function ReadTab({ onAudit, onAsk }: { onAudit: () => void; onAsk: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<{ x: number; y: number; text: string } | null>(null);
  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      const text = sel && sel.toString().trim();
      if (!text || text.length < 2 || !ref.current || !sel!.rangeCount || !ref.current.contains(sel!.anchorNode)) { setPop(null); return; }
      const r = sel!.getRangeAt(0).getBoundingClientRect();
      setPop({ x: r.left + r.width / 2, y: r.top, text });
    };
    const onSelChange = () => { const s = window.getSelection(); if (!s || !s.toString().trim()) setPop(null); };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('selectionchange', onSelChange);
    return () => { document.removeEventListener('mouseup', onUp); document.removeEventListener('selectionchange', onSelChange); };
  }, []);
  return (
    <div ref={ref} style={{ maxWidth: 720, margin: '0 auto' }}>
      <MiniMD text={WIKI_PAGE.content} onCite={() => {}} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--fg-muted)' }}>
        <span>Sources: {WIKI_PAGE.sources}</span><span>·</span><span>Linked concepts: {WIKI_PAGE.concepts}</span>
        <button onClick={onAudit} style={{ marginLeft: 'auto', ...wbtnGhost() }}><Icon name="chats" size={14} /> Open in chat</button>
      </div>
      {pop && (
        <div style={{ position: 'fixed', left: pop.x, top: pop.y - 48, transform: 'translateX(-50%)', zIndex: 120 }}>
          <div style={{ display: 'flex', gap: 2, padding: 4, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border-strong)', boxShadow: '0 8px 28px rgba(0,0,0,0.35)' }}>
            <button onMouseDown={(e) => { e.preventDefault(); onAsk(pop.text); setPop(null); window.getSelection()?.removeAllRanges(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 12px', border: 'none', borderRadius: 7, background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <Icon name="sparkles" size={14} color="#fff" /> Ask an Agent
            </button>
            <button onMouseDown={(e) => { e.preventDefault(); onAudit(); setPop(null); }}
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

function EditTab({ mobile }: { mobile?: boolean }) {
  const [text, setText] = useState(WIKI_PAGE.content);
  const editorStyle = (flex: boolean): CSSProperties => ({ ...(flex ? { flex: 1 } : { height: 300 }), width: '100%', resize: 'none', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 12.5, lineHeight: 1.7, padding: 14, outline: 'none' });
  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>markdown · CodeMirror</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} style={editorStyle(false)} />
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 4 }}>Live preview</div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--bg)' }}><MiniMD text={text} /></div>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 8, fontFamily: 'var(--mono-font)' }}>markdown · CodeMirror</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} style={editorStyle(true)} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 8 }}>Live preview</div>
        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--bg)' }}><MiniMD text={text} /></div>
      </div>
    </div>
  );
}

const SRC_ICON = { user: 'pencil', llm_audit: 'sparkles', ingest: 'download' } as const;
const SRC_TONE = { user: 'muted', llm_audit: 'accent', ingest: 'success' } as const;

function HistoryTab({ mobile }: { mobile?: boolean }) {
  const [sel, setSel] = useState(7);
  const diff = WIKI_DIFFS['6-7'];
  const cur = WIKI_REVISIONS.find((r) => r.v === sel) || WIKI_REVISIONS[0];
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
                  <Icon name={SRC_ICON[r.source]} size={12} color={BTONE[SRC_TONE[r.source]]} />
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
          <a key={s.id} href="/sources" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: 13, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', cursor: 'pointer' }}>
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

// ── Page ───────────────────────────────────────────────────────────────────────
const WIKI_TABS = ['Read', 'Edit', 'History', 'Sources', 'Graph'] as const;
type WikiTab = typeof WIKI_TABS[number];

export function WikiPage() {
  const isMobile = useMedia(MOBILE_QUERY);
  const [topic, setTopic] = useState('Cell theory');
  const [tab, setTab] = useState<WikiTab>('Read');
  const [audit, setAudit] = useState(false);
  const [wf, setWf] = useState<WikiFilter>({ project: 'all', filter: 'all' });
  const [mobilePage, setMobilePage] = useState<string | null>(null);
  const page = WIKI_PAGE;
  const curProj = (WIKI_PAGES_FLAT.find((p) => p.topic === topic) || {}).project || page.project;
  const pad = isMobile ? '12px 16px 0' : '16px 28px 0';
  const bodyPad = isMobile ? '18px 16px 48px' : '22px 28px 40px';
  const editH = isMobile ? 'calc(100vh - 330px)' : 'calc(100vh - 260px)';
  const openPage = (t: string) => { setTopic(t); setTab('Read'); setMobilePage(t); };

  const pageView: ReactNode = (
    <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* header */}
      <div style={{ padding: pad, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--fg-muted)' }}>
          {isMobile && <button onClick={() => setMobilePage(null)} aria-label="Back to wiki pages" style={{ ...wbtnGhost(), width: 30, padding: 0, justifyContent: 'center', marginRight: 2 }}><Icon name="chevLeft" size={16} /></button>}
          <a href="#" onClick={(e) => { e.preventDefault(); if (isMobile) setMobilePage(null); }} style={{ color: 'var(--fg-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Wiki</a>
          <span>›</span><span>{curProj}</span><span>›</span><span style={{ color: 'var(--fg)' }}>{topic}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontSize: isMobile ? 22 : 26, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>{topic}</h1>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {!isMobile && <button style={wbtnGhost()}><Icon name="chats" size={14} /> Open in chat</button>}
            <button onClick={() => setAudit(true)} style={{ ...wbtnGhost(), color: 'var(--accent)', borderColor: 'var(--accent-line)' }}><Icon name="sparkles" size={14} color="var(--accent)" /> Audit <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11, background: 'var(--accent)', color: '#fff', borderRadius: 6, padding: '1px 6px' }}>{page.audits}</span></button>
            <button onClick={() => setTab('Edit')} style={wbtnPrimary()}><Icon name="pencil" size={14} color="#fff" /> Edit</button>
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 6, fontFamily: 'var(--mono-font)' }}>v{page.version} · updated {page.updated} by {page.updatedBy} · {page.sources} sources</div>
        <div className="b2-tabscroll" style={{ display: 'flex', gap: 20, marginTop: 8, overflowX: 'auto' }}>
          {WIKI_TABS.map((t) => <WikiTabBtn key={t} label={t} active={tab === t} onClick={() => setTab(t)} />)}
          <WikiTabBtn label="Audit" active={false} badge={page.audits} onClick={() => setAudit(true)} />
        </div>
      </div>
      {/* body */}
      {tab === 'Graph' ? (
        <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          <GraphView project={curProj} selected={topic} onSelect={setTopic} isMobile={isMobile} />
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: bodyPad, paddingBottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom, 0px))' : undefined }}>
          {tab === 'Read' && <ReadTab onAudit={() => setAudit(true)} onAsk={() => setAudit(true)} />}
          {tab === 'Edit' && (isMobile ? <EditTab mobile /> : <div style={{ height: editH }}><EditTab /></div>)}
          {tab === 'History' && (isMobile ? <HistoryTab mobile /> : <div style={{ height: editH }}><HistoryTab /></div>)}
          {tab === 'Sources' && <SourcesTab />}
        </div>
      )}
    </main>
  );

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
      {!isMobile && <WikiSidebar wf={wf} setWf={setWf} selected={topic} onSelect={setTopic} />}
      {isMobile && !mobilePage ? <WikiPicker wf={wf} setWf={setWf} onSelect={openPage} /> : pageView}
      <AuditDrawer open={audit} onClose={() => setAudit(false)} topic={topic} />
    </div>
  );
}
