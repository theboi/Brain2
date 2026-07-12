/*
 * Brain2 Console — Wiki page. Two-pane browse: sidebar (Filters chip + search +
 * collapsible project folders with topic rows) ▸ page view (breadcrumb, header
 * actions, tabs Read / Edit / History / Sources / Graph) plus a right-side Audit
 * drawer. Mobile lands on a page picker first. Faithful port of docs/design/v1
 * wiki.jsx + app-wiki.jsx.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useMedia, MOBILE_QUERY } from '@/hooks/useMedia';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useProjects } from '@/hooks/useWorkspaces';
import { resolveActiveProjectId } from '@/lib/vaultSelection';
import {
  useWorkspaceVaultPages, useVaultPage, useVaultHistory,
  useWritePage, useWikiTopicSources, useRevertCommit, useVaultHistoryDiff,
  useWorkspaceOpenAuditCounts,
} from '@/hooks/useVault';
import { useReingest } from '@/hooks/useSources';
import type { Project, VaultCommit } from '@/lib/types';
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
// One vault and its wiki pages — the sidebar renders a folder per group.
interface VaultGroup { project: Project; pages: LivePage[]; }
type AuditCountMap = Record<string, Record<string, number>>;

function wikiChipDefs(wf: WikiFilter, setWf: (f: WikiFilter) => void, _pages: LivePage[]): ChipDef[] {
  const filterOpts = [
    { value: 'all', label: 'All pages', icon: 'layers' as const },
    { value: 'recent', label: 'Edited last 7d', icon: 'clock' as const },
    { value: 'audit', label: 'Has open audit', icon: 'alert' as const, tone: 'warning' },
  ];
  const fil = filterOpts.find((o) => o.value === wf.filter);
  return [
    { key: 'filter', icon: 'sliders', label: wf.filter === 'all' ? 'Filters' : (fil ? fil.label : 'Filters'), tone: fil && (fil as any).tone, active: wf.filter !== 'all', title: 'Filter', options: filterOpts, value: wf.filter, onPick: (v) => setWf({ ...wf, filter: v }), menuWidth: 200 },
  ];
}
function wikiPageMatches(topic: string, wf: WikiFilter, q: string, auditCount = 0): boolean {
  if (q && !topic.toLowerCase().includes(q.toLowerCase())) return false;
  if (wf.filter === 'audit' && auditCount <= 0) return false;
  return true;
}

// ── Desktop sidebar ────────────────────────────────────────────────────────────
function WikiSidebar({ wf, setWf, selectedTopic, selectedProject, onSelect, vaults, width = 264 }: {
  wf: WikiFilter; setWf: (f: WikiFilter) => void;
  selectedTopic: string; selectedProject: string | null;
  onSelect: (projectId: string, topic: string) => void;
  vaults: VaultGroup[]; auditCounts: AuditCountMap; width?: number;
}) {
  const [q, setQ] = useState('');
  const [openV, setOpenV] = useState<Record<string, boolean>>({});
  const defs = wikiChipDefs(wf, setWf, []);
  return (
    <div style={{ width, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <FilterChips defs={defs} size="s" />
        <SidebarSearch value={q} onChange={setQ} placeholder="Search wiki…" />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {vaults.map(({ project, pages }) => {
          const projectCounts = auditCounts[project.project_id] ?? {};
          const rows = pages.filter((p) => wikiPageMatches(p.topic, wf, q, projectCounts[p.topic] ?? 0));
          const open = openV[project.project_id] ?? true;
          return (
            <Folder key={project.project_id} label={project.name} count={rows.length} open={open}
              onToggle={() => setOpenV((o) => ({ ...o, [project.project_id]: !(o[project.project_id] ?? true) }))}>
              {rows.map((p) => {
                const n = projectCounts[p.topic] ?? 0;
                return <NestRow key={p.topic} icon="wiki" label={p.topic}
                active={p.topic === selectedTopic && project.project_id === selectedProject}
                badge={n ? `${n} audit${n === 1 ? '' : 's'}` : null}
                rightIcon={n ? 'alert' : null} rightTone="warning"
                onClick={() => onSelect(project.project_id, p.topic)} />;
              })}
              {!rows.length && <div style={{ padding: '4px 10px 8px 27px', fontSize: 11.5, color: 'var(--fg-faint)' }}>No matching pages</div>}
            </Folder>
          );
        })}
        {!vaults.length && <div style={{ padding: '4px 10px 8px', fontSize: 11.5, color: 'var(--fg-faint)' }}>No vaults in this workspace</div>}
      </div>
    </div>
  );
}

// ── Mobile picker ────────────────────────────────────────────────────────────
function WikiPageRow({ topic, tldr, auditCount, onClick }: { topic: string; tldr: string | null; auditCount: number; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', padding: '11px 16px', fontFamily: 'var(--ui-font)' }}>
      <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-muted)' }}><Icon name="wiki" size={15} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{topic}</span>
        </span>
        {tldr && <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tldr}</span>}
        {auditCount > 0 && <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--warning)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{auditCount} audit{auditCount === 1 ? '' : 's'}</span>}
      </span>
      <Icon name="chevRight" size={15} color="var(--fg-faint)" />
    </button>
  );
}
function VaultHeader({ name, count }: { name: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px 4px', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
      <Icon name="folder" size={13} color="var(--fg-muted)" />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--fg-muted)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{count}</span>
    </div>
  );
}
function WikiPicker({ wf, setWf, vaults, auditCounts, onSelect }: { wf: WikiFilter; setWf: (f: WikiFilter) => void; vaults: VaultGroup[]; auditCounts: AuditCountMap; onSelect: (projectId: string, topic: string) => void }) {
  const [q, setQ] = useState('');
  const groups = vaults.map((v) => {
    const projectCounts = auditCounts[v.project.project_id] ?? {};
    return {
      project: v.project,
      rows: v.pages.filter((p) => wikiPageMatches(p.topic, wf, q, projectCounts[p.topic] ?? 0)),
      counts: projectCounts,
    };
  });
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <FilterChips defs={wikiChipDefs(wf, setWf, [])} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 34, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <Icon name="search" size={15} color="var(--fg-muted)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search wiki…" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{total} pages · {vaults.length} vault{vaults.length !== 1 ? 's' : ''}</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}>
        {groups.map(({ project, rows, counts }) => (
          <Fragment key={project.project_id}>
            <VaultHeader name={project.name} count={rows.length} />
            {rows.map((p) => <WikiPageRow key={`${project.project_id}:${p.topic}`} topic={p.topic} tldr={p.tldr} auditCount={counts[p.topic] ?? 0} onClick={() => onSelect(project.project_id, p.topic)} />)}
          </Fragment>
        ))}
        {!total && <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13 }}>No pages match these filters.</div>}
      </div>
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────────────────
function WikiTabBtn({ label, active, onClick, badge, disabled = false }: { label: string; active: boolean; onClick: () => void; badge?: number; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={() => { if (!disabled) onClick(); }} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 7, height: 42, padding: '0 2px', border: 'none', background: 'transparent', cursor: disabled ? 'not-allowed' : 'pointer',
      color: disabled ? 'var(--fg-faint)' : (active ? 'var(--fg)' : 'var(--fg-muted)'), opacity: disabled ? 0.55 : 1, fontFamily: 'var(--ui-font)', fontSize: 13.5, fontWeight: active ? 600 : 500 }}>
      {label}
      {badge != null && <span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', background: active ? 'var(--accent)' : 'var(--surface-2)', color: active ? '#fff' : 'var(--fg-muted)', borderRadius: 6, padding: '1px 6px' }}>{badge}</span>}
      {active && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: 'var(--accent)', borderRadius: 2 }} />}
    </button>
  );
}

function ReadTab({ content, onAudit, onAsk, onWikiLink, knownTopics }: {
  content: string; onAudit: () => void; onAsk: (text: string) => void;
  onWikiLink: (topic: string) => void; knownTopics: Set<string>;
}) {
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
      <MiniMD text={content} onCite={() => {}} onWikiLink={onWikiLink} knownTopics={knownTopics} />
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

function HistoryTab({ commits, projectId, topic, onRevert, reverting, mobile }: {
  commits: VaultCommit[];
  projectId: string | null;
  topic: string | null;
  onRevert: (sha: string) => void;
  reverting?: boolean;
  mobile?: boolean;
}) {
  const [selSha, setSelSha] = useState<string | null>(commits[0]?.sha ?? null);
  const selectedSha = commits.some((c) => c.sha === selSha) ? selSha : commits[0]?.sha ?? null;
  const { data: diffData, isFetching } = useVaultHistoryDiff(projectId, selectedSha, topic);
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
      revertLabel="Restore this version"
      mobile={mobile}
    />
  );
}

function SourcesTab({ sources, projectId }: { sources: any[]; projectId: string | null }) {
  const reingest = useReingest(projectId);
  const reingestAll = () => {
    sources.forEach((s) => {
      const id = s.source_id ?? s.id;
      if (id) reingest.mutate({ source_id: id });
    });
  };
  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{sources.length} sources contributed to this page, derived from provenance.</span>
        <button style={wbtnGhost()} onClick={reingestAll} disabled={reingest.isPending || !projectId || !sources.length}>
          <Icon name="refresh" size={13} /> Re-ingest all
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sources.map((s) => {
          const id = s.source_id ?? s.id;
          return (
            <Link key={id} to={`/sources/${encodeURIComponent(id)}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: 13, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', cursor: 'pointer' }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}><Icon name={s.mime?.startsWith('image') ? 'image' : 'file'} size={15} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.filename ?? s.name ?? id}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.kind ?? s.detail ?? ''}</span>
              </span>
              <Icon name="arrowRight" size={15} color="var(--fg-faint)" />
            </Link>
          );
        })}
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
  const { topic: routeTopic } = useParams<{ topic?: string }>();
  const navigate = useNavigate();
  const [topic, setTopic] = useState<string | null>(null);
  const [tab, setTab] = useState<WikiTab>('Read');
  const [audit, setAudit] = useState(false);
  const [wf, setWf] = useState<WikiFilter>({ project: 'all', filter: 'all' });
  const [mobilePage, setMobilePage] = useState<string | null>(null);

  // ── live data ──────────────────────────────────────────────────────────────
  const { workspaceId, projectId, setProjectId } = useWorkspace();
  const { data: projects = [], isSuccess: projectsLoaded } = useProjects(workspaceId);

  useEffect(() => {
    const next = resolveActiveProjectId(projectsLoaded, projects, projectId);
    if (next !== projectId) setProjectId(next);
  }, [projectId, projects, projectsLoaded, setProjectId]);

  // Pages for every vault in the workspace — one folder per vault in the sidebar.
  const projectIds = useMemo(() => projects.map((p) => p.project_id), [projects]);
  const pageResults = useWorkspaceVaultPages(projectIds);
  const auditCountResults = useWorkspaceOpenAuditCounts(projectIds);
  // Keyed on a single stable-length string (a variable-length deps array makes
  // React skip recomputation when the array grows from empty — see useMemo docs).
  const pagesKey = pageResults.map((r) => r.dataUpdatedAt).join(',');
  const vaults: VaultGroup[] = useMemo(
    () => projects.map((p, i) => ({ project: p, pages: (pageResults[i]?.data ?? []) as LivePage[] })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, pagesKey],
  );
  const auditCountsKey = auditCountResults.map((r) => r.dataUpdatedAt).join(',');
  const auditCounts: AuditCountMap = useMemo(() => {
    const out: AuditCountMap = {};
    projects.forEach((project, i) => {
      out[project.project_id] = auditCountResults[i]?.data?.counts ?? {};
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, auditCountsKey]);

  const { data: pageData, isLoading: pageLoading } = useVaultPage(projectId, topic);
  const { data: historyData } = useVaultHistory(projectId, topic);
  const { data: sourceData } = useWikiTopicSources(projectId, topic);
  const writePage = useWritePage(projectId);
  const revertCommit = useRevertCommit(projectId);

  const content = pageData?.content ?? '';
  const commits = historyData?.commits ?? [];
  const sources = sourceData?.sources ?? [];
  // Wiki-link targets are scoped to the vault currently being viewed.
  const currentPages = useMemo(
    () => vaults.find((v) => v.project.project_id === projectId)?.pages ?? [],
    [vaults, projectId],
  );
  const knownTopics = useMemo(() => new Set(currentPages.map((p) => p.topic)), [currentPages]);

  // Deep link /wiki/:topic — select the topic and align the active vault to the
  // first vault that contains it.
  useEffect(() => {
    if (!routeTopic || routeTopic === topic) return;
    setTopic(routeTopic);
    setMobilePage(routeTopic);
    const owner = vaults.find((v) => v.pages.some((p) => p.topic === routeTopic));
    if (owner) setProjectId(owner.project.project_id);
  }, [routeTopic, topic, vaults, setProjectId]);

  // Pick a page on load: prefer the active vault if it has pages, otherwise the
  // first vault that has any.
  useEffect(() => {
    if (routeTopic || topic) return;
    const current = vaults.find((v) => v.project.project_id === projectId && v.pages.length > 0);
    const target = current ?? vaults.find((v) => v.pages.length > 0);
    if (target) {
      if (target.project.project_id !== projectId) setProjectId(target.project.project_id);
      setTopic(target.pages[0].topic);
    }
  }, [routeTopic, topic, vaults, projectId, setProjectId]);

  const pad = isMobile ? '12px 16px 0' : '16px 28px 0';
  const bodyPad = isMobile ? '18px 16px 48px' : '22px 28px 40px';
  const editH = isMobile ? 'calc(100vh - 330px)' : 'calc(100vh - 260px)';
  const openPage = (pid: string, t: string) => {
    setProjectId(pid);
    setTopic(t);
    setTab('Read');
    setMobilePage(t);
    navigate(`/wiki/${encodeURIComponent(t)}`);
  };

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
            {!isMobile && <button disabled={!topic} style={{ ...wbtnGhost(), opacity: topic ? 1 : 0.45, cursor: topic ? 'pointer' : 'not-allowed' }}><Icon name="chats" size={14} /> Open in chat</button>}
            {!isMobile && projectId && <Link to={`/graph?vault=${encodeURIComponent(projectId)}`} title="Open this vault's graph" style={{ ...wbtnGhost(), textDecoration: 'none' }}><Icon name="graph" size={14} /> Graph</Link>}
            <button disabled={!topic} onClick={() => topic && setAudit(true)} style={{ ...wbtnGhost(), color: 'var(--accent)', borderColor: 'var(--accent-line)', opacity: topic ? 1 : 0.45, cursor: topic ? 'pointer' : 'not-allowed' }}><Icon name="sparkles" size={14} color="var(--accent)" /> Audit</button>
            <button disabled={!topic} onClick={() => topic && setTab('Edit')} style={{ ...wbtnPrimary(), opacity: topic ? 1 : 0.45, cursor: topic ? 'pointer' : 'not-allowed' }}><Icon name="pencil" size={14} color="#fff" /> Edit</button>
          </span>
        </div>
        {pageData && (
          <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 6, fontFamily: 'var(--mono-font)' }}>{pageData.tldr ?? pageData.zone}</div>
        )}
        {pageLoading && <div style={{ fontSize: 12.5, color: 'var(--fg-faint)', marginTop: 6 }}>Loading…</div>}
        <div className="b2-tabscroll" style={{ display: 'flex', gap: 20, marginTop: 8, overflowX: 'auto' }}>
          {WIKI_TABS.map((t) => <WikiTabBtn key={t} label={t} active={tab === t} disabled={!topic && t === 'Edit'} onClick={() => setTab(t)} />)}
          <WikiTabBtn label="Audit" active={false} disabled={!topic} onClick={() => setAudit(true)} />
        </div>
      </div>
      {/* body */}
      {tab === 'Graph' ? (
        <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          <GraphView isMobile={isMobile} />
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: bodyPad, paddingBottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom, 0px))' : undefined }}>
          {tab === 'Read' && <ReadTab content={content} onAudit={() => setAudit(true)} onAsk={() => setAudit(true)} onWikiLink={(t) => projectId && openPage(projectId, t)} knownTopics={knownTopics} />}
          {tab === 'Edit' && (isMobile
            ? <EditTab initialContent={content} onSave={(c) => topic && writePage.mutate({ topic, content: c })} saving={writePage.isPending} mobile />
            : <div style={{ height: editH }}><EditTab initialContent={content} onSave={(c) => topic && writePage.mutate({ topic, content: c })} saving={writePage.isPending} /></div>
          )}
          {tab === 'History' && (isMobile
            ? <HistoryTab commits={commits} projectId={projectId} topic={topic} onRevert={(sha) => topic && revertCommit.mutate({ sha, topic })} reverting={revertCommit.isPending} mobile />
            : <div style={{ height: editH }}><HistoryTab commits={commits} projectId={projectId} topic={topic} onRevert={(sha) => topic && revertCommit.mutate({ sha, topic })} reverting={revertCommit.isPending} /></div>
          )}
          {tab === 'Sources' && <SourcesTab sources={sources} projectId={projectId} />}
        </div>
      )}
    </main>
  );

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
      {!isMobile && <WikiSidebar wf={wf} setWf={setWf} selectedTopic={topic ?? ''} selectedProject={projectId} onSelect={openPage} vaults={vaults} auditCounts={auditCounts} />}
      {isMobile && !mobilePage ? <WikiPicker wf={wf} setWf={setWf} vaults={vaults} auditCounts={auditCounts} onSelect={openPage} /> : pageView}
      <AuditDrawer open={audit} onClose={() => setAudit(false)} topic={topic ?? ''} />
    </div>
  );
}
