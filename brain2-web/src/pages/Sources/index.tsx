/*
 * Brain2 Console — Sources page. Two-pane browse: sidebar (Ingest button +
 * Tag/Status filter chips + search + collapsible project folders with nested
 * source rows) ▸ preview pane (Preview / Raw / Extracted / History / Details).
 * Full-page drag overlay + Ingest modal. Mobile collapses to a list→detail
 * back-stack. Faithful port of docs/design/v1 sources.jsx + app-sources.jsx.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { useMedia, MOBILE_QUERY } from '@/hooks/useMedia';
import {
  SOURCE_TREE, TYPE_ICON, STATUS_CHIP,
  type Source, type SourceFilter,
} from '@/lib/sources';
import {
  FilterChips, Folder, NestRow, SidebarSearch, BTONE, btnGhost, btnPrimary,
  type ChipDef,
} from '@/components/browse/Browse';
import { HistoryView, type HistoryRevision } from '@/components/browse/HistoryView';
import { MiniMD } from '@/components/browse/MiniMD';
import { IngestModal } from './IngestModal';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useProjects } from '@/hooks/useWorkspaces';
import { resolveActiveProjectId } from '@/lib/vaultSelection';
import {
  useWorkspaceSources, useExtracted,
  usePutExtracted, useReingest, useDeleteSource,
  useSourceEvents, useDownloadSource, useExtractionHistory, useExtractionDiff,
  useRestoreExtraction,
} from '@/hooks/useSources';
import type { SourceRow } from '@/lib/types';

// ── Adapter: SourceRow (API) → Source (display) ────────────────────────────────
function toDisplaySource(r: SourceRow): Source {
  const typeMap: Record<string, Source['type']> = {
    pdf: 'pdf', md: 'md', url: 'url', image: 'img', code: 'code', audio: 'audio',
  };
  const ext = r.filename?.split('.').pop()?.toLowerCase() ?? '';
  const detectedType = typeMap[ext] ?? (r.kind === 'url' ? 'url' : 'pdf');
  const statusMap: Record<string, Source['status']> = {
    pending: 'pending', extracting: 'running', extracted: 'done', failed: 'failed',
  };
  return {
    id: r.source_id,
    project: r.project_id,
    name: r.filename ?? r.source_id,
    type: detectedType,
    size: r.size_bytes ? `${(r.size_bytes / 1024 / 1024).toFixed(1)} MB` : '—',
    status: statusMap[r.status] ?? 'pending',
    topic: r.topic,
    tags: [],
    provenance: r.kind === 'url' ? 'URL capture' : 'File upload',
    uploader: '',
    created: new Date(r.created_at).toLocaleDateString(),
    updated: new Date(r.updated_at).toLocaleDateString(),
    mime: r.mime ?? '',
    words: 0,
    tokens: 0,
    extracted: '',
    error: r.extraction_error ?? undefined,
    url: r.kind === 'url' ? (r.filename ?? undefined) : undefined,
  };
}

// ── Filter chip defs (Tags / Status) — shared by desktop sidebar + mobile list ─
function sourceChipDefs(f: SourceFilter, setF: (f: SourceFilter) => void, projectNames: string[] = []): ChipDef[] {
  const t = SOURCE_TREE;
  const projOpts = [{ value: 'all', label: 'All projects', icon: 'layers' as const }, ...projectNames.map((p) => ({ value: p, label: p, icon: 'folder' as const }))];
  const tagOpts = [{ value: 'all', label: 'All tags', icon: 'tag' as const }, ...t.tags.map((x) => ({ value: x.label, label: x.label, icon: 'tag' as const, count: x.count }))];
  const statOpts = [{ value: 'all', label: 'All status', icon: 'layers' as const }, ...t.status.map((x) => ({ value: x.id, label: x.label, icon: x.icon, count: x.count, tone: x.tone }))];
  const proj = projectNames.find((p) => p === f.project);
  const tag = t.tags.find((x) => x.label === f.tag);
  const st = t.status.find((x) => x.id === f.status);
  return [
    { key: 'project', icon: 'folder', label: proj ?? 'All projects', active: f.project !== 'all', title: 'Project', options: projOpts, value: f.project, onPick: (v) => setF({ ...f, project: v }) },
    { key: 'tag', icon: 'tag', label: tag ? tag.label : 'All tags', active: f.tag !== 'all', title: 'Tag', options: tagOpts, value: f.tag, onPick: (v) => setF({ ...f, tag: v }) },
    { key: 'status', icon: st ? st.icon : 'layers', tone: st ? st.tone : undefined, label: st ? st.label : 'All status', active: f.status !== 'all', title: 'Status', options: statOpts, value: f.status, onPick: (v) => setF({ ...f, status: v }) },
  ];
}

// ── Desktop sidebar ────────────────────────────────────────────────────────────
function SourcesSidebar({ f, setF, selectedId, onSelect, onIngest, items, projectNames, nameById, width = 268 }: {
  f: SourceFilter; setF: (f: SourceFilter) => void; selectedId: string; onSelect: (id: string) => void; onIngest: () => void; items: Source[]; projectNames: string[]; nameById: Record<string, string>; width?: number;
}) {
  const [q, setQ] = useState('');
  const [openF, setOpenF] = useState<Record<string, boolean>>({ default: true });
  const defs = sourceChipDefs(f, setF, projectNames).filter((d) => d.key !== 'project'); // project = the folder tree
  const filtered = items.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  // Group by project_id
  const projectLabels = Array.from(new Set(items.map((s) => s.project)));
  return (
    <div style={{ width, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button onClick={onIngest} style={{ ...btnPrimary(), width: '100%', height: 36, justifyContent: 'center', fontSize: 13 }}>
          <Icon name="plus" size={15} color="#fff" /> Ingest sources
        </button>
        <FilterChips defs={defs} size="s" />
        <SidebarSearch value={q} onChange={setQ} placeholder="Search sources…" />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {projectLabels.map((proj) => {
          const rows = filtered.filter((s) => s.project === proj);
          return (
            <Folder key={proj} label={nameById[proj] ?? proj} count={rows.length} open={openF[proj] ?? true} onToggle={() => setOpenF((o) => ({ ...o, [proj]: !(o[proj] ?? true) }))}>
              {rows.map((s) => {
                const chip = STATUS_CHIP[s.status];
                return <NestRow key={s.id} icon={TYPE_ICON[s.type] || 'file'} label={s.name} active={s.id === selectedId} onClick={() => onSelect(s.id)}
                  rightIcon={s.status !== 'done' ? chip.icon : null} rightTone={s.status !== 'done' ? chip.tone : undefined} />;
              })}
              {!rows.length && <div style={{ padding: '4px 10px 8px 27px', fontSize: 11.5, color: 'var(--fg-faint)' }}>No matching sources</div>}
            </Folder>
          );
        })}
        {!projectLabels.length && <div style={{ padding: '4px 10px 8px', fontSize: 11.5, color: 'var(--fg-faint)' }}>No sources yet</div>}
      </div>
    </div>
  );
}

// ── Source row (mobile list) ─────────────────────────────────────────────────
function SourceRow({ s, selected, onClick, mobile = false }: { s: Source; selected: boolean; onClick: () => void; mobile?: boolean }) {
  const chip = STATUS_CHIP[s.status];
  const hi = selected && !mobile;
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderLeft: `2px solid ${hi ? 'var(--accent)' : 'transparent'}`,
      borderBottom: '1px solid var(--border)', background: hi ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', padding: '9px 14px', fontFamily: 'var(--ui-font)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-muted)' }}>
          <Icon name={TYPE_ICON[s.type] || 'file'} size={13} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: BTONE[chip.tone], fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap' }}>
          <Icon name={chip.icon} size={11} /> {chip.label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingLeft: 33, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
        <span style={{ whiteSpace: 'nowrap' }}>{s.size.trim()} · {s.type}</span>
        {s.topic && <span style={{ marginLeft: 'auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <Icon name="arrowRight" size={10} color="var(--fg-faint)" /> <span style={{ color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.topic}</span></span>}
      </div>
    </button>
  );
}

function ListPane({ items, selectedId, onSelect, chips, onIngest }: {
  items: Source[]; selectedId: string; onSelect: (id: string) => void; chips: ReactNode; onIngest: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = items.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ flex: 1, width: '100%', minWidth: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ margin: '0 -12px', padding: '0 12px' }}>{chips}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9, height: 34, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <Icon name="search" size={15} color="var(--fg-muted)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sources…" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }} />
          </div>
          <button onClick={onIngest} aria-label="Ingest sources" style={{ ...btnPrimary(), height: 34, padding: '0 12px', flexShrink: 0 }}><Icon name="plus" size={15} color="#fff" /> Ingest</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{filtered.length} sources</span>
          <button style={{ display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', color: 'var(--fg-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
            <Icon name="filter" size={13} /> Newest <Icon name="chevDown" size={12} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 'calc(68px + env(safe-area-inset-bottom, 0px))' }}>
        {filtered.map((s) => <SourceRow key={s.id} s={s} selected={s.id === selectedId} onClick={() => onSelect(s.id)} mobile />)}
        {!filtered.length && <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13 }}>No sources match these filters.</div>}
        {!!filtered.length && <button style={{ width: '100%', padding: '14px', border: 'none', background: 'transparent', color: 'var(--fg-muted)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>Load more…</button>}
      </div>
    </div>
  );
}

// ── Preview pane ───────────────────────────────────────────────────────────────
const SOURCE_TABS = ['Preview', 'Raw source', 'Extracted text', 'History', 'Details'] as const;
type SourceTab = typeof SOURCE_TABS[number];

function Tab({ label, active, onClick, badge }: { label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 7, height: 40, padding: '0 4px', border: 'none', background: 'transparent', cursor: 'pointer',
      color: active ? 'var(--fg)' : 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: active ? 600 : 500 }}>
      {label}
      {badge != null && <span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', background: 'var(--surface-2)', borderRadius: 6, padding: '1px 5px', color: 'var(--fg-muted)' }}>{badge}</span>}
      {active && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: 'var(--accent)', borderRadius: 2 }} />}
    </button>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '7px 0', fontSize: 12.5 }}>
      <span style={{ width: 88, flexShrink: 0, color: 'var(--fg-faint)' }}>{label}</span>
      <span style={{ flex: 1, color: 'var(--fg)', minWidth: 0 }}>{children}</span>
    </div>
  );
}

const tagChip = (): CSSProperties => ({ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '2px 7px' });

function EmptyBody({ label }: { label: string }) { return <div style={{ color: 'var(--fg-faint)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>{label}</div>; }

function RawBody({ s, onDownload }: { s: Source; onDownload?: () => void }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>Original {s.type.toUpperCase()} · {s.size.trim()}</span>
        <button style={btnGhost()} onClick={onDownload}><Icon name="download" size={14} /> Download</button>
      </div>
      <button
        onClick={onDownload}
        title={`Download ${s.name}`}
        style={{ width: '100%', height: 360, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: 'var(--fg-faint)', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-line)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
      >
        <Icon name={TYPE_ICON[s.type] || 'file'} size={34} />
        <span style={{ fontFamily: 'var(--mono-font)', fontSize: 12, color: 'var(--fg-muted)' }}>{s.name}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
          <Icon name="download" size={13} /> Click to download the raw {s.type}
        </span>
      </button>
    </div>
  );
}

function ExtractedBody({ s, extractedText, extractedVersion, onSave, startEditing = false }: {
  s: Source;
  extractedText: string;
  extractedVersion: number;
  onSave?: (text: string, version: number) => Promise<unknown>;
  startEditing?: boolean;
}) {
  const [text, setText] = useState(extractedText);
  const [editing, setEditing] = useState(startEditing);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => { setText(extractedText); setEditing(startEditing); }, [s.id, extractedText, startEditing]);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave?.(text, extractedVersion);
      setResult({ ok: true, message: 'Extracted text saved successfully.' });
      setEditing(false);
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to save extracted text.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{s.words} words · {s.tokens} tokens · markitdown</span>
        <span style={{ display: 'flex', gap: 8 }}>
          {editing ? (
            <>
              <button style={btnGhost()} onClick={() => { setText(extractedText); setEditing(false); }} disabled={saving}>Cancel</button>
              <button style={{ ...btnPrimary(), opacity: saving ? 0.6 : 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </>
          ) : (
            <button style={btnGhost()} onClick={() => setEditing(true)}><Icon name="pencil" size={14} /> Edit</button>
          )}
        </span>
      </div>
      <textarea value={text || ''} onChange={(e) => setText(e.target.value)} spellCheck={false} readOnly={!editing}
        style={{ width: '100%', minHeight: 420, resize: 'vertical', margin: 0, padding: 16, borderRadius: 10, border: `1px solid ${editing ? 'var(--accent-line)' : 'var(--border)'}`, background: 'var(--surface-2)', fontFamily: 'var(--mono-font)', fontSize: 12.5, lineHeight: 1.6, color: editing ? 'var(--fg)' : 'var(--fg-muted)', outline: 'none', cursor: editing ? 'text' : 'default' }} />
      {result && (
        <Modal
          onClose={() => setResult(null)}
          icon={result.ok ? 'check' : 'alert'}
          title={result.ok ? 'Saved' : 'Save failed'}
          width={420}
          footer={<button style={{ ...btnPrimary(), marginLeft: 'auto' }} onClick={() => setResult(null)}>Done</button>}
        >
          <div style={{ fontSize: 13.5, color: 'var(--fg)', lineHeight: 1.5 }}>{result.message}</div>
        </Modal>
      )}
    </div>
  );
}

const EXTRACTION_KIND_LABEL: Record<string, string> = {
  upload: 'extracted on upload',
  reingest: 're-ingested · markitdown',
  edit: 'edited extraction',
  restore: 'restored a prior version',
};

function HistoryBody({ s, projectId, mobile }: { s: Source; projectId: string | null; mobile?: boolean }) {
  const { data: versions = [] } = useExtractionHistory(projectId, s.id);
  const [selVer, setSelVer] = useState<number | null>(null);
  const selected = versions.some((v) => v.version === selVer) ? selVer : versions[0]?.version ?? null;
  const { data: diffData, isFetching } = useExtractionDiff(projectId, s.id, selected);
  const restore = useRestoreExtraction(projectId);
  const revisions: HistoryRevision[] = versions.map((v) => ({
    id: String(v.version),
    shortId: `v${v.version}`,
    date: new Date(v.created_at).toLocaleString(),
    title: EXTRACTION_KIND_LABEL[v.kind] ?? v.kind,
    subtitle: v.bytes ? `${v.bytes.toLocaleString()} bytes` : undefined,
  }));
  // The newest version is already current — only offer restore for older ones.
  const latest = versions[0]?.version ?? null;
  return (
    <HistoryView
      revisions={revisions}
      selectedId={selected != null ? String(selected) : null}
      onSelect={(id) => setSelVer(Number(id))}
      hunks={diffData?.hunks}
      diffLoading={isFetching}
      subtitlePrefix=""
      onRevert={selected != null && selected !== latest
        ? (id) => restore.mutate({ source_id: s.id, version: Number(id) })
        : undefined}
      reverting={restore.isPending}
      revertLabel="Restore this version"
      mobile={mobile}
    />
  );
}

function DetailsBody({ s, onDelete }: { s: Source; onDelete?: () => void }) {
  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>Details</h3>
      <InfoRow label="Source ID"><span style={{ fontFamily: 'var(--mono-font)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{s.id} <Icon name="copy" size={12} color="var(--fg-faint)" /></span></InfoRow>
      <InfoRow label="Uploader">{s.uploader || '—'}</InfoRow>
      <InfoRow label="Created">{s.created}</InfoRow>
      <InfoRow label="Updated">{s.updated}</InfoRow>
      <InfoRow label="Size">{s.size.trim()}</InfoRow>
      <InfoRow label="MIME"><span style={{ fontFamily: 'var(--mono-font)', fontSize: 12 }}>{s.mime}</span></InfoRow>
      <InfoRow label="Provenance">{s.provenance}{s.url && <div style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--accent)', marginTop: 2, wordBreak: 'break-all' }}>{s.url}</div>}</InfoRow>
      <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />
      <InfoRow label="Wiki topic">
        {s.topic ? <a href="/wiki" style={{ color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}><Icon name="wiki" size={13} /> {s.topic}</a> : <span style={{ color: 'var(--fg-faint)' }}>—</span>}
      </InfoRow>
      <InfoRow label="Tags">
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {s.tags.length ? s.tags.map((t) => <span key={t} style={tagChip()}>#{t}</span>) : <span style={{ color: 'var(--fg-faint)' }}>untagged</span>}
        </span>
      </InfoRow>
      <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />
      <button style={{ ...btnGhost(), color: 'var(--destructive)' }} onClick={onDelete}><Icon name="x" size={14} /> Delete source</button>
    </div>
  );
}

function PreviewPane({ s, projectId, mobile = false, onBack, onDeleted }: {
  s: Source; projectId: string | null; mobile?: boolean; onBack?: () => void; onDeleted?: () => void;
}) {
  const [tab, setTab] = useState<SourceTab>('Preview');
  const [editExtracted, setEditExtracted] = useState(false);
  useEffect(() => { setTab(s.status === 'failed' ? 'Extracted text' : 'Preview'); setEditExtracted(false); }, [s.id, s.status]);

  const { data: extractedData } = useExtracted(projectId, s.id);
  const putExtracted = usePutExtracted(projectId);
  const reingest = useReingest(projectId);
  const deleteSource = useDeleteSource(projectId);
  const downloadSource = useDownloadSource();

  const extractedText = extractedData?.extracted_md ?? s.extracted ?? '';
  const extractedVersion = extractedData?.version ?? 0;

  function handleSave(text: string, version: number) {
    return putExtracted.mutateAsync({ source_id: s.id, extracted_md: text, expect_version: version });
  }

  function handleReingest() {
    reingest.mutate({ source_id: s.id });
  }

  function handleDelete() {
    deleteSource.mutate({ source_id: s.id }, { onSuccess: onDeleted });
  }

  function handleDownload() {
    downloadSource.mutate({ source_id: s.id, filename: s.name });
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* header */}
      <div style={{ padding: mobile ? '12px 16px 0' : '14px 28px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {mobile && (
            <button onClick={onBack} aria-label="Back to list" style={{ ...btnGhost(), height: 30, width: 34, padding: 0, justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="chevLeft" size={16} />
            </button>
          )}
          <Icon name={TYPE_ICON[s.type] || 'file'} size={18} color="var(--fg-muted)" />
          <span style={{ fontFamily: 'var(--display-font)', fontSize: mobile ? 15 : 17, fontWeight: 600, color: 'var(--fg)', letterSpacing: 'var(--display-track)', flex: mobile ? 1 : 'none', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
          <span style={{ marginLeft: mobile ? 0 : 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
            {!mobile && projectId && <Link to={`/graph?vault=${encodeURIComponent(projectId)}`} title="Open this vault's graph" style={{ ...btnGhost(), textDecoration: 'none' }}><Icon name="graph" size={14} /> Graph</Link>}
            {!mobile && <button style={btnGhost()} onClick={handleReingest} disabled={reingest.isPending}><Icon name="refresh" size={14} /> Re-ingest</button>}
            <button style={btnPrimary()} onClick={() => { setTab('Extracted text'); setEditExtracted(true); }}><Icon name="pencil" size={14} color="#fff" /> {mobile ? '' : 'Edit MD'}</button>
          </span>
        </div>
        <div className="b2-tabscroll" style={{ display: 'flex', gap: 18, marginTop: 6, overflowX: mobile ? 'auto' : 'visible' }}>
          {SOURCE_TABS.map((t) => <Tab key={t} label={t} active={tab === t} onClick={() => setTab(t)} />)}
        </div>
      </div>
      {/* body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: mobile ? '18px 16px 48px' : '22px 28px 48px', paddingBottom: mobile ? 'calc(80px + env(safe-area-inset-bottom, 0px))' : undefined }}>
        <div style={{ maxWidth: tab === 'History' ? 1040 : 820, margin: '0 auto' }}>
          {s.status === 'failed' && tab !== 'History' && tab !== 'Details' && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 10, background: 'var(--warning-soft)', border: '1px solid var(--border)', marginBottom: 18 }}>
              <Icon name="alert" size={18} color="var(--warning)" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 3 }}>Extraction failed</div>
                <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{s.error}</div>
              </div>
              <button style={btnGhost()} onClick={handleReingest} disabled={reingest.isPending}><Icon name="refresh" size={14} /> Retry</button>
            </div>
          )}
          {tab === 'Preview' && (extractedText ? <MiniMD text={extractedText} /> : <EmptyBody label="Nothing to preview yet." />)}
          {tab === 'Raw source' && <RawBody s={s} onDownload={handleDownload} />}
          {tab === 'Extracted text' && (
            <ExtractedBody
              s={s}
              extractedText={extractedText}
              extractedVersion={extractedVersion}
              onSave={handleSave}
              startEditing={editExtracted}
            />
          )}
          {tab === 'History' && <HistoryBody s={s} projectId={projectId} mobile={mobile} />}
          {tab === 'Details' && <DetailsBody s={s} onDelete={handleDelete} />}
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export function SourcesPage() {
  const isMobile = useMedia(MOBILE_QUERY);
  const navigate = useNavigate();
  const { id: routeSourceId } = useParams<{ id?: string }>();
  const [f, setF] = useState<SourceFilter>({ project: 'all', tag: 'all', status: 'all' });
  const [selectedId, setSelectedId] = useState<string>('');
  const [modal, setModal] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragCount = useRef(0);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');

  const { workspaceId, projectId, setProjectId } = useWorkspace();
  const { data: projects = [], isSuccess: projectsLoaded } = useProjects(workspaceId);
  const projectNames = projects.map((p) => p.name);
  const nameById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.project_id, p.name])),
    [projects],
  );

  useEffect(() => {
    const next = resolveActiveProjectId(projectsLoaded, projects, projectId);
    if (next !== projectId) setProjectId(next);
  }, [projectId, projects, projectsLoaded, setProjectId]);

  // Sources for every vault in the workspace — one folder per vault.
  const projectIds = useMemo(() => projects.map((p) => p.project_id), [projects]);
  const sourceResults = useWorkspaceSources(projectIds, {
    status: f.status !== 'all' ? f.status : undefined,
    tag: f.tag !== 'all' ? f.tag : undefined,
  });
  const sourcesLoading = projectIds.length > 0 && sourceResults.some((r) => r.isLoading);
  const allItems: Source[] = useMemo(
    () => sourceResults.flatMap((r) => (r.data ?? []).map(toDisplaySource)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...sourceResults.map((r) => r.data)],
  );
  // Honour the project filter chip (value is a vault name).
  const items = useMemo(
    () => (f.project === 'all' ? allItems : allItems.filter((s) => nameById[s.project] === f.project)),
    [allItems, f.project, nameById],
  );

  // Keep status/source events fresh for the vault currently being previewed.
  const selectedSource = items.find((s) => s.id === selectedId);
  const activeProjectId = selectedSource?.project ?? projectId;
  useSourceEvents(activeProjectId);

  useEffect(() => {
    if (!routeSourceId) return;
    const routed = allItems.find((s) => s.id === routeSourceId);
    if (routed) { setSelectedId(routed.id); setProjectId(routed.project); }
    setMobileView('detail');
  }, [allItems, routeSourceId, setProjectId]);

  // Auto-select first source when list loads and nothing is selected
  useEffect(() => {
    if (!routeSourceId && !selectedId && items.length > 0) {
      setSelectedId(items[0].id);
      setProjectId(items[0].project);
    }
  }, [items, routeSourceId, selectedId, setProjectId]);

  useEffect(() => {
    const onEnter = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragCount.current++; setDragging(true); } };
    const onOver = (e: DragEvent) => { e.preventDefault(); };
    const onLeave = (e: DragEvent) => { e.preventDefault(); dragCount.current = Math.max(0, dragCount.current - 1); if (!dragCount.current) setDragging(false); };
    const onDrop = (e: DragEvent) => { e.preventDefault(); dragCount.current = 0; setDragging(false); setModal(true); };
    window.addEventListener('dragenter', onEnter); window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave); window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragover', onOver); window.removeEventListener('dragleave', onLeave); window.removeEventListener('drop', onDrop); };
  }, []);

  const selected = items.find((s) => s.id === selectedId) ?? (routeSourceId ? null : items[0] ?? null);
  // The selected source dictates which vault the preview pane reads/writes.
  const selectedProjectId = selected?.project ?? projectId;
  const mobileChips = <FilterChips defs={sourceChipDefs(f, setF, projectNames)} />;

  function selectSource(id: string) {
    setSelectedId(id);
    const src = items.find((s) => s.id === id);
    if (src) setProjectId(src.project);
    navigate(`/sources/${encodeURIComponent(id)}`);
  }

  if (projectsLoaded && projects.length === 0) {
    return <div style={{ padding: 24, color: 'var(--fg-muted)' }}>This workspace has no vaults yet.</div>;
  }

  if (!projectsLoaded || sourcesLoading) {
    return <div style={{ padding: 24, color: 'var(--fg-muted)' }}>Loading sources…</div>;
  }

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
      {isMobile ? (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', overflow: 'hidden' }}>
          {mobileView === 'list'
            ? <ListPane items={items} selectedId={selectedId} onSelect={(id) => { selectSource(id); setMobileView('detail'); }} chips={mobileChips} onIngest={() => setModal(true)} />
            : selected
              ? <PreviewPane s={selected} projectId={selectedProjectId} mobile onBack={() => setMobileView('list')} onDeleted={() => { setSelectedId(''); setMobileView('list'); }} />
              : <div style={{ padding: 24, color: 'var(--fg-muted)' }}>No source selected.</div>}
        </div>
      ) : (
        <>
          <SourcesSidebar f={f} setF={setF} selectedId={selectedId} onSelect={selectSource} onIngest={() => setModal(true)} items={items} projectNames={projectNames} nameById={nameById} />
          {selected
            ? <PreviewPane s={selected} projectId={selectedProjectId} onDeleted={() => setSelectedId('')} />
            : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-faint)', fontSize: 13 }}>Select a source to preview.</div>}
        </>
      )}

      {dragging && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'var(--accent-soft)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ width: '70%', height: '70%', border: '2.5px dashed var(--accent)', borderRadius: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: 'var(--accent)' }}>
            <Icon name="download" size={42} color="var(--accent)" />
            <span style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--display-font)', color: 'var(--fg)' }}>Drop to ingest into default</span>
            <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>PDFs, markdown, text, images — multi-file OK</span>
          </div>
        </div>
      )}
      <IngestModal open={modal} onClose={() => setModal(false)} />
    </div>
  );
}
