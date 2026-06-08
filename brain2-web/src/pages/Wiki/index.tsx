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
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useProjects } from '@/hooks/useWorkspaces';
import {
  useVaultPages, useVaultPage, useVaultHistory,
  useWritePage, useWikiTopicSources, useRevertCommit, useVaultHistoryDiff,
} from '@/hooks/useVault';
import type { VaultCommit } from '@/lib/types';
import {
  FilterChips, Folder, NestRow, SidebarSearch, btnGhost as wbtnGhost, btnPrimary as wbtnPrimary,
  type ChipDef,
} from '@/components/browse/Browse';
import { MiniMD } from '@/components/browse/MiniMD';
import { HistoryView, type HistoryRevision } from '@/components/browse/HistoryView';
import { GraphView } from './GraphView';
import { AuditDrawer } from './AuditDrawer';

interface WikiFilter { project: string; filter: string; }

// ── Filter chip defs + match helper (shared by sidebar + mobile picker) ───────
interface LivePage { topic: string; zone: string; tldr: string | null; }

function wikiChipDefs(wf: WikiFilter, setWf: (f: WikiFilter) => void, _pages: LivePage[]): ChipDef[] {
  const filterOpts = [
    { value: 'all', label: 'All pages', icon: 'layers' as const },
    { value: 'recent', label: 'Edited last 7d', icon: 'clock' as const },
  ];
  const fil = filterOpts.find((o) => o.value === wf.filter);
  return [
    { key: 'filter', icon: 'sliders', label: wf.filter === 'all' ? 'Filters' : (fil ? fil.label : 'Filters'), tone: fil && (fil as any).tone, active: wf.filter !== 'all', title: 'Filter', options: filterOpts, value: wf.filter, onPick: (v) => setWf({ ...wf, filter: v }), menuWidth: 200 },
  ];
}
function wikiPageMatches(topic: string, _wf: WikiFilter, q: string): boolean {
  if (q && !topic.toLowerCase().includes(q.toLowerCase())) return false;
  return true;
}

// ── Desktop sidebar ────────────────────────────────────────────────────────────
function WikiSidebar({ wf, setWf, selected, onSelect, pages, width = 264 }: {
  wf: WikiFilter; setWf: (f: WikiFilter) => void; selected: string; onSelect: (t: string) => void;
  pages: LivePage[]; width?: number;
}) {
  const [q, setQ] = useState('');
  const defs = wikiChipDefs(wf, setWf, pages);
  const rows = pages.filter((p) => wikiPageMatches(p.topic, wf, q));
  return (
    <div style={{ width, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <FilterChips defs={defs} size="s" />
        <SidebarSearch value={q} onChange={setQ} placeholder="Search wiki…" />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        <Folder label="Pages" count={rows.length} open onToggle={() => {}}>
          {rows.map((p) => <NestRow key={p.topic} icon="wiki" label={p.topic} active={p.topic === selected} badge={null} meta={p.tldr ? p.tldr.slice(0, 20) : ''} onClick={() => onSelect(p.topic)} />)}
          {!rows.length && <div style={{ padding: '4px 10px 8px 27px', fontSize: 11.5, color: 'var(--fg-faint)' }}>No matching pages</div>}
        </Folder>
      </div>
    </div>
  );
}

// ── Mobile picker ────────────────────────────────────────────────────────────
function WikiPageRow({ topic, tldr, onClick }: { topic: string; tldr: string | null; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', padding: '11px 16px', fontFamily: 'var(--ui-font)' }}>
      <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-muted)' }}><Icon name="wiki" size={15} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{topic}</span>
        </span>
        {tldr && <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tldr}</span>}
      </span>
      <Icon name="chevRight" size={15} color="var(--fg-faint)" />
    </button>
  );
}
function WikiPicker({ wf, setWf, pages, onSelect }: { wf: WikiFilter; setWf: (f: WikiFilter) => void; pages: LivePage[]; onSelect: (t: string) => void }) {
  const [q, setQ] = useState('');
  const rows = pages.filter((p) => wikiPageMatches(p.topic, wf, q));
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <FilterChips defs={wikiChipDefs(wf, setWf, pages)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 34, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <Icon name="search" size={15} color="var(--fg-muted)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search wiki…" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{rows.length} pages</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}>
        {rows.map((p) => <WikiPageRow key={p.topic} topic={p.topic} tldr={p.tldr} onClick={() => onSelect(p.topic)} />)}
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

function ReadTab({ content, onAudit, onAsk }: { content: string; onAudit: () => void; onAsk: (text: string) => void }) {
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
      <MiniMD text={content} onCite={() => {}} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--fg-muted)' }}>
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

function EditTab({ initialContent, onSave, saving, mobile }: { initialContent: string; onSave: (text: string) => void; saving?: boolean; mobile?: boolean }) {
  const [text, setText] = useState(initialContent);
  useEffect(() => { setText(initialContent); }, [initialContent]);
  const editorStyle = (flex: boolean): CSSProperties => ({ ...(flex ? { flex: 1 } : { height: 300 }), width: '100%', resize: 'none', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 12.5, lineHeight: 1.7, padding: 14, outline: 'none' });
  const saveBtn = (
    <button onClick={() => onSave(text)} disabled={saving} style={{ ...wbtnPrimary(), opacity: saving ? 0.6 : 1 }}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  );
  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>markdown · CodeMirror</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} style={editorStyle(false)} />
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 4 }}>Live preview</div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--bg)' }}><MiniMD text={text} /></div>
        {saveBtn}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 8, fontFamily: 'var(--mono-font)' }}>markdown · CodeMirror</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} style={editorStyle(true)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 8 }}>Live preview</div>
          <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--bg)' }}><MiniMD text={text} /></div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{saveBtn}</div>
    </div>
  );
}

function HistoryTab({ commits, projectId, onRevert, reverting, mobile }: {
  commits: VaultCommit[];
  projectId: string | null;
  onRevert: (sha: string) => void;
  reverting?: boolean;
  mobile?: boolean;
}) {
  const [selSha, setSelSha] = useState<string | null>(commits[0]?.sha ?? null);
  const selectedSha = commits.some((c) => c.sha === selSha) ? selSha : commits[0]?.sha ?? null;
  const { data: diffData, isFetching } = useVaultHistoryDiff(projectId, selectedSha);
  const revisions: HistoryRevision[] = commits.map((c) => ({
    id: c.sha,
    shortId: c.sha.slice(0, 7),
    date: c.date,
    title: c.message || '',
    subtitle: c.author,
  }));
  return (
    <HistoryView
      revisions={revisions}
      selectedId={selectedSha}
      onSelect={setSelSha}
      hunks={diffData?.hunks}
      diffLoading={isFetching}
      onRevert={onRevert}
      reverting={reverting}
      mobile={mobile}
    />
  );
}

function SourcesTab({ sources }: { sources: any[] }) {
  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{sources.length} sources contributed to this page, derived from provenance.</span>
        <button style={wbtnGhost()}><Icon name="refresh" size={13} /> Re-ingest all</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sources.map((s) => (
          <a key={s.source_id ?? s.id} href="/sources" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: 13, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', cursor: 'pointer' }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}><Icon name={s.mime?.startsWith('image') ? 'image' : 'file'} size={15} /></span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{s.filename ?? s.name ?? s.source_id}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{s.kind ?? s.detail ?? ''}</span>
            </span>
            <Icon name="arrowRight" size={15} color="var(--fg-faint)" />
          </a>
        ))}
        {!sources.length && <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13 }}>No sources linked to this page.</div>}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
const WIKI_TABS = ['Read', 'Edit', 'History', 'Sources', 'Graph'] as const;
type WikiTab = typeof WIKI_TABS[number];

export function WikiPage() {
  const isMobile = useMedia(MOBILE_QUERY);
  const [topic, setTopic] = useState<string | null>(null);
  const [tab, setTab] = useState<WikiTab>('Read');
  const [audit, setAudit] = useState(false);
  const [wf, setWf] = useState<WikiFilter>({ project: 'all', filter: 'all' });
  const [mobilePage, setMobilePage] = useState<string | null>(null);

  // ── live data ──────────────────────────────────────────────────────────────
  const { workspaceId, projectId, setProjectId } = useWorkspace();
  const { data: projects = [] } = useProjects(workspaceId);

  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].project_id);
    }
  }, [projectId, projects, setProjectId]);

  const { data: vaultPages = [] } = useVaultPages(projectId);
  const { data: pageData, isLoading: pageLoading } = useVaultPage(projectId, topic);
  const { data: historyData } = useVaultHistory(projectId, topic);
  const { data: sourceData } = useWikiTopicSources(projectId, topic);
  const writePage = useWritePage(projectId);
  const revertCommit = useRevertCommit(projectId);

  const content = pageData?.content ?? '';
  const commits = historyData?.commits ?? [];
  const sources = sourceData?.sources ?? [];

  // pick first page when pages load
  useEffect(() => {
    if (!topic && vaultPages.length > 0) setTopic(vaultPages[0].topic);
  }, [topic, vaultPages]);

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
          <span>›</span><span style={{ color: 'var(--fg)' }}>{topic ?? '—'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontSize: isMobile ? 22 : 26, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>{topic ?? '—'}</h1>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {!isMobile && <button style={wbtnGhost()}><Icon name="chats" size={14} /> Open in chat</button>}
            <button onClick={() => setAudit(true)} style={{ ...wbtnGhost(), color: 'var(--accent)', borderColor: 'var(--accent-line)' }}><Icon name="sparkles" size={14} color="var(--accent)" /> Audit</button>
            <button onClick={() => setTab('Edit')} style={wbtnPrimary()}><Icon name="pencil" size={14} color="#fff" /> Edit</button>
          </span>
        </div>
        {pageData && (
          <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 6, fontFamily: 'var(--mono-font)' }}>{pageData.tldr ?? pageData.zone}</div>
        )}
        {pageLoading && <div style={{ fontSize: 12.5, color: 'var(--fg-faint)', marginTop: 6 }}>Loading…</div>}
        <div className="b2-tabscroll" style={{ display: 'flex', gap: 20, marginTop: 8, overflowX: 'auto' }}>
          {WIKI_TABS.map((t) => <WikiTabBtn key={t} label={t} active={tab === t} onClick={() => setTab(t)} />)}
          <WikiTabBtn label="Audit" active={false} onClick={() => setAudit(true)} />
        </div>
      </div>
      {/* body */}
      {tab === 'Graph' ? (
        <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          <GraphView project="" selected={topic ?? ''} onSelect={(t) => { setTopic(t); setTab('Read'); }} isMobile={isMobile} />
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: bodyPad, paddingBottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom, 0px))' : undefined }}>
          {tab === 'Read' && <ReadTab content={content} onAudit={() => setAudit(true)} onAsk={() => setAudit(true)} />}
          {tab === 'Edit' && (isMobile
            ? <EditTab initialContent={content} onSave={(c) => topic && writePage.mutate({ topic, content: c })} saving={writePage.isPending} mobile />
            : <div style={{ height: editH }}><EditTab initialContent={content} onSave={(c) => topic && writePage.mutate({ topic, content: c })} saving={writePage.isPending} /></div>
          )}
          {tab === 'History' && (isMobile
            ? <HistoryTab commits={commits} projectId={projectId} onRevert={(sha) => revertCommit.mutate({ sha })} reverting={revertCommit.isPending} mobile />
            : <div style={{ height: editH }}><HistoryTab commits={commits} projectId={projectId} onRevert={(sha) => revertCommit.mutate({ sha })} reverting={revertCommit.isPending} /></div>
          )}
          {tab === 'Sources' && <SourcesTab sources={sources} />}
        </div>
      )}
    </main>
  );

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
      {!isMobile && <WikiSidebar wf={wf} setWf={setWf} selected={topic ?? ''} onSelect={setTopic} pages={vaultPages} />}
      {isMobile && !mobilePage ? <WikiPicker wf={wf} setWf={setWf} pages={vaultPages} onSelect={openPage} /> : pageView}
      <AuditDrawer open={audit} onClose={() => setAudit(false)} topic={topic ?? ''} />
    </div>
  );
}
