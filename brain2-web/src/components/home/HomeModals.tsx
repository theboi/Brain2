/*
 * Home page modals:
 *   IngestModal       — "Ingest source" button
 *   ActivityModal     — "Recent activity → View all"
 *   ManageAgentsModal — "Manage agents" link
 *   AddAgentModal     — "Add agent" tile
 *
 * All share a common HomeModalShell (fixed backdrop + animated panel).
 */
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import type { IconName } from '@/components/ui/Icon';
import { AGENTS, ACTIVITY } from '@/lib/mockData';

// ── Shared modal shell ────────────────────────────────────────────────────────
interface ModalShellProps {
  icon: IconName;
  title: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

function ModalShell({ icon, title, width = 760, onClose, children, footer }: ModalShellProps) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  return createPortal(
    <div
      className="b2-anim-fade"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        className="b2-anim-slide"
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: '100%', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <Icon name={icon} size={18} color="var(--accent)" />
          <span style={{ fontFamily: 'var(--display-font)', fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>{title}</span>
          <span style={{ marginLeft: 'auto' }}>
            <button
              onClick={onClose}
              style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="x" size={15} />
            </button>
          </span>
        </div>
        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {children}
        </div>
        {/* Footer */}
        {footer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Shared button helpers ────────────────────────────────────────────────────
const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px',
  borderRadius: 8, border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px',
  borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff',
  fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
  width: '100%', height: 36, padding: '0 11px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)',
  fontFamily: 'var(--ui-font)', fontSize: 13, outline: 'none',
};
const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--fg-muted)',
  letterSpacing: '0.02em', marginBottom: 7,
};

// ── 1 · Ingest source ────────────────────────────────────────────────────────
const INGEST_EXAMPLE_FILES = [
  { name: 'darwin-1859.pdf',     type: 'pdf',  size: '11.2 MB', topic: 'Origin of Species' },
  { name: 'standup-04-12.md',    type: 'md',   size: '18 KB',   topic: 'Q3 themes' },
];
const INGEST_PROJECTS = ['default', 'research-q3', 'launch-docs', 'archive'];
const INGEST_MODES = [
  { id: 'wiki',    label: 'Wiki',    desc: 'Summarise with LLM into a clean wiki page' },
  { id: 'static',  label: 'Static',  desc: 'Store as-is, no rewriting' },
  { id: 'dynamic', label: 'Dynamic', desc: 'Link a live database — refreshes on change' },
];

interface IngestFile { name: string; type: string; size: string; topic: string; }

export function IngestModal({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<IngestFile[]>(INGEST_EXAMPLE_FILES);
  const [project, setProject] = useState('default');
  const [mode, setMode] = useState('wiki');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const removeFile = (i: number) => setFiles((f) => f.filter((_, j) => j !== i));

  return (
    <ModalShell
      icon="download"
      title="Ingest source"
      width={680}
      onClose={onClose}
      footer={
        <>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{files.length} file{files.length !== 1 ? 's' : ''} queued</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button style={ghostBtn} onClick={onClose}>Cancel</button>
            <button style={primaryBtn} onClick={onClose}>
              <Icon name="download" size={14} color="#fff" /> Ingest
            </button>
          </span>
        </>
      }
    >
      {/* Drop zone */}
      <div
        style={{ border: '1.5px dashed var(--border-strong)', borderRadius: 12, padding: '24px 20px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg)' }}
        onClick={() => fileInputRef.current?.click()}
      >
        <Icon name="download" size={22} color="var(--fg-faint)" style={{ margin: '0 auto 8px' }} />
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Drop files here or click to browse</div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>PDFs, markdown, text, URLs, screenshots</div>
        <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} />
      </div>

      {/* Queue */}
      {files.length > 0 && (
        <div style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
          {files.map((f, i) => (
            <div
              key={f.name}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderTop: i ? '1px solid var(--border)' : 'none', background: 'var(--surface)' }}
            >
              <Icon name="file" size={16} color="var(--fg-muted)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{f.type} · {f.size}</div>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', flexShrink: 0 }}>{f.topic}</span>
              <button onClick={() => removeFile(i)} style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Settings row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={fieldLabel}>Vault</label>
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            style={{ ...inputStyle, appearance: 'none', cursor: 'pointer' }}
          >
            {INGEST_PROJECTS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={fieldLabel}>Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            style={{ ...inputStyle, appearance: 'none', cursor: 'pointer' }}
          >
            {INGEST_MODES.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.desc}</option>)}
          </select>
        </div>
      </div>
    </ModalShell>
  );
}

// ── 2 · Activity (full log with filter chips) ─────────────────────────────────
const ACTIVITY_FILTERS = [
  { id: 'all',     label: 'All' },
  { id: 'accent',  label: 'Agents',  icon: 'sparkles' as IconName },
  { id: 'muted',   label: 'Sources', icon: 'file' as IconName },
  { id: 'success', label: 'Wiki',    icon: 'check' as IconName },
  { id: 'warning', label: 'Alerts',  icon: 'alert' as IconName },
];

const ACTIVITY_EARLIER = [
  { t: '09:51', icon: 'sparkles', text: 'Wiki page merged · "Microscopy"',           meta: 'v4 · 6 sources', tone: 'accent' as const,   day: 'Yesterday' },
  { t: '09:14', icon: 'sparkles', text: 'Researcher · answered 3 queries',            meta: '5,120 tok',      tone: 'muted' as const,    day: 'Yesterday' },
  { t: '08:30', icon: 'alert',    text: 'Citations Guard · 2 unsupported claims',     meta: 'Cell theory',    tone: 'warning' as const,  day: 'Yesterday' },
  { t: '17:42', icon: 'file',     text: 'Source ingested · "gateway.py"',             meta: '→ LLM Gateway',  tone: 'muted' as const,    day: 'Yesterday' },
  { t: '16:05', icon: 'check',    text: 'Weekly exec digest sent',                   meta: 'to 4 people',    tone: 'success' as const,  day: 'Yesterday' },
];

const TONE_COLOR: Record<string, string> = {
  accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', muted: 'var(--fg-muted)',
};

export function ActivityModal({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState('all');

  const today = ACTIVITY.map((r) => ({ ...r, day: 'Today' }));
  const all = [...today, ...ACTIVITY_EARLIER];
  const rows = filter === 'all' ? all : all.filter((r) => r.tone === filter);
  const days = [...new Set(rows.map((r) => r.day))];

  return (
    <ModalShell
      icon="history"
      title="Activity"
      width={720}
      onClose={onClose}
      footer={
        <>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            Showing <b style={{ color: 'var(--fg)' }}>{rows.length}</b> of {all.length} events
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button style={ghostBtn} onClick={onClose}><Icon name="external" size={14} /> Open audit log</button>
            <button style={primaryBtn} onClick={onClose}>Done</button>
          </span>
        </>
      }
    >
      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {ACTIVITY_FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px',
                borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600,
                border: on ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: on ? 'var(--accent-soft)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--fg-muted)',
              }}
            >
              {f.icon && <Icon name={f.icon} size={13} color={on ? 'var(--accent)' : 'var(--fg-muted)'} />}
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Grouped log */}
      {days.map((day) => {
        const list = rows.filter((r) => r.day === day);
        return (
          <div key={day}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', margin: '2px 0 6px 2px' }}>
              {day}
            </div>
            <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', overflow: 'hidden' }}>
              {list.map((r, i) => (
                <button
                  key={r.day + r.t + i}
                  style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left', padding: '11px 10px', border: 'none', borderTop: i ? '1px solid var(--border)' : 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--surface-2)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-faint)', width: 40, flexShrink: 0 }}>{r.t}</span>
                  <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: TONE_COLOR[r.tone] }}>
                    <Icon name={r.icon as IconName} size={15} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.text}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 2 }}>{r.meta}</span>
                  </span>
                  <Icon name="chevRight" size={15} color="var(--fg-faint)" />
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {!rows.length && (
        <div style={{ textAlign: 'center', color: 'var(--fg-faint)', padding: '30px 0', fontSize: 13 }}>
          No events match this filter.
        </div>
      )}
    </ModalShell>
  );
}

// ── 3 · Manage agents ──────────────────────────────────────────────────────────
export function ManageAgentsModal({ onClose, onAddAgent }: { onClose: () => void; onAddAgent: () => void }) {
  const [q, setQ] = useState('');
  const [paused, setPaused] = useState<Set<string>>(() => new Set());

  const ql = q.trim().toLowerCase();
  const list = AGENTS.filter((a) =>
    !ql || a.name.toLowerCase().includes(ql) || a.model.toLowerCase().includes(ql) || a.provider.toLowerCase().includes(ql),
  );
  const online = AGENTS.filter((a) => a.status === 'active').length;

  const togglePause = (id: string) =>
    setPaused((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <ModalShell
      icon="users"
      title="Manage agents"
      width={880}
      onClose={onClose}
      footer={
        <>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            <b style={{ color: 'var(--fg)' }}>{AGENTS.length}</b> agents · <b style={{ color: 'var(--success)' }}>{online}</b> online
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button style={ghostBtn} onClick={onClose}>Close</button>
            <button style={primaryBtn} onClick={() => { onAddAgent(); }}>
              <Icon name="plus" size={14} color="#fff" /> Add agent
            </button>
          </span>
        </>
      }
    >
      {/* Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 36, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
        <Icon name="search" size={15} color="var(--fg-muted)" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search agents by name, model or provider…"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }}
        />
      </div>

      {/* Table */}
      <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.6fr 1fr 0.7fr 132px', gap: 14, padding: '9px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>
          <span>Agent</span>
          <span>Model</span>
          <span>Status</span>
          <span style={{ textAlign: 'right' }}>Msgs</span>
          <span style={{ textAlign: 'right' }}>Actions</span>
        </div>
        {list.map((a, i) => {
          const isPaused = paused.has(a.id);
          const iconBtnStyle = (active: boolean): React.CSSProperties => ({
            width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
            background: active ? 'var(--accent-soft)' : 'transparent',
          });
          return (
            <div
              key={a.id}
              style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.6fr 1fr 0.7fr 132px', gap: 14, alignItems: 'center', padding: '12px 14px', borderTop: i ? '1px solid var(--border)' : 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <StatusDot status={isPaused ? 'idle' : a.status} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.name}
                </span>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--fg)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.model}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-faint)', marginTop: 1 }}>{a.provider}</div>
              </div>
              <span style={{ fontSize: 12, fontFamily: 'var(--mono-font)', color: isPaused ? 'var(--fg-faint)' : a.status === 'degraded' ? 'var(--warning)' : a.status === 'active' ? 'var(--success)' : 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isPaused ? 'paused' : (a.note ?? a.statusLabel)}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.msgs}</span>
              <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => togglePause(a.id)} title={isPaused ? 'Resume' : 'Pause'} style={iconBtnStyle(isPaused)}>
                  <Icon name={isPaused ? 'play' : 'pause'} size={14} color={isPaused ? 'var(--accent)' : 'var(--fg-muted)'} />
                </button>
                <button title="Configure" style={iconBtnStyle(false)}>
                  <Icon name="settings" size={14} color="var(--fg-muted)" />
                </button>
                <button title="More" style={iconBtnStyle(false)}>
                  <Icon name="more" size={14} color="var(--fg-muted)" />
                </button>
              </span>
            </div>
          );
        })}
        {!list.length && (
          <div style={{ textAlign: 'center', color: 'var(--fg-faint)', padding: '26px 0', fontSize: 12.5 }}>
            No agents match "{q.trim()}".
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ── 4 · Add agent ──────────────────────────────────────────────────────────────
const DEPLOY_OPTIONS = [
  { id: 'cloud', label: 'Cloud', icon: 'cloud' as IconName, desc: 'Hosted provider API' },
  { id: 'local', label: 'Local', icon: 'cpu'   as IconName, desc: 'Runs on Ollama' },
];
const MODELS_BY_DEPLOY: Record<string, { provider: string; model: string }[]> = {
  cloud: [
    { provider: 'Anthropic', model: 'Claude 3.5 Sonnet' },
    { provider: 'Anthropic', model: 'Claude 3 Haiku' },
    { provider: 'OpenAI',    model: 'GPT-4o-mini' },
    { provider: 'Google',    model: 'gemini-1.5-flash' },
  ],
  local: [
    { provider: 'Ollama', model: 'llama3 · 8B' },
    { provider: 'Ollama', model: 'mistral · 7B' },
    { provider: 'Ollama', model: 'qwen2.5 · 14B' },
  ],
};
const TOOL_OPTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'sources:read',    label: 'sources:read',    icon: 'sources' },
  { id: 'wiki:get',        label: 'wiki:get',        icon: 'wiki' },
  { id: 'wiki:edit',       label: 'wiki:edit',       icon: 'pencil' },
  { id: 'web:crawl',       label: 'web:crawl',       icon: 'globe' },
  { id: 'reports:write',   label: 'reports:write',   icon: 'file' },
  { id: 'chat:send',       label: 'chat:send',       icon: 'chats' },
];

export function AddAgentModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [deploy, setDeploy] = useState<'cloud' | 'local'>('cloud');
  const [modelIdx, setModelIdx] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [tools, setTools] = useState<Set<string>>(() => new Set(['sources:read', 'wiki:get']));

  const models = MODELS_BY_DEPLOY[deploy];
  const curModel = models[Math.min(modelIdx, models.length - 1)];
  const ready = name.trim().length > 0;

  const toggleTool = (id: string) =>
    setTools((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const switchDeploy = (d: 'cloud' | 'local') => { setDeploy(d); setModelIdx(0); };

  return (
    <ModalShell
      icon="plus"
      title="Add agent"
      width={600}
      onClose={onClose}
      footer={
        <>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{curModel.provider} · {curModel.model}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button style={ghostBtn} onClick={onClose}>Cancel</button>
            <button
              style={{ ...primaryBtn, opacity: ready ? 1 : 0.5, pointerEvents: ready ? 'auto' : 'none' }}
              onClick={onClose}
            >
              <Icon name="plus" size={14} color="#fff" /> Create agent
            </button>
          </span>
        </>
      }
    >
      {/* Name */}
      <div>
        <label style={fieldLabel}>Agent name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Analyst"
          style={inputStyle}
        />
      </div>

      {/* Deployment */}
      <div>
        <label style={fieldLabel}>Deployment</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {DEPLOY_OPTIONS.map((d) => {
            const on = deploy === d.id;
            return (
              <button
                key={d.id}
                onClick={() => switchDeploy(d.id as 'cloud' | 'local')}
                style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', padding: '11px 13px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--ui-font)', border: on ? '1px solid var(--accent)' : '1px solid var(--border)', background: on ? 'var(--accent-soft)' : 'var(--bg)' }}
              >
                <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--surface)' : 'var(--surface-2)', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
                  <Icon name={d.icon} size={17} />
                </span>
                <span>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{d.label}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 1 }}>{d.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Model */}
      <div>
        <label style={fieldLabel}>Model</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {models.map((m, i) => {
            const on = i === Math.min(modelIdx, models.length - 1);
            return (
              <button
                key={m.provider + m.model}
                onClick={() => setModelIdx(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', padding: '9px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--ui-font)', border: on ? '1px solid var(--accent)' : '1px solid var(--border)', background: on ? 'var(--accent-soft)' : 'var(--bg)' }}
              >
                <span style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: on ? '5px solid var(--accent)' : '1.6px solid var(--border-strong)', background: on ? 'var(--surface)' : 'transparent', boxSizing: 'border-box' }} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)', fontFamily: 'var(--mono-font)' }}>{m.model}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>{m.provider}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* System prompt */}
      <div>
        <label style={fieldLabel}>
          System prompt{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--fg-faint)' }}>· optional</span>
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Describe how this agent should behave and which sources to favour…"
          style={{ ...inputStyle, height: 'auto', padding: '9px 11px', resize: 'vertical', lineHeight: 1.5 }}
        />
      </div>

      {/* Tools */}
      <div>
        <label style={fieldLabel}>
          Tools{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--fg-faint)' }}>· {tools.size} enabled</span>
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TOOL_OPTIONS.map((t) => {
            const on = tools.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggleTool(t.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 11px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--mono-font)', fontSize: 12, fontWeight: 500, border: on ? '1px solid var(--accent)' : '1px solid var(--border)', background: on ? 'var(--accent-soft)' : 'var(--bg)', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}
              >
                <Icon name={on ? 'check' : t.icon} size={13} color={on ? 'var(--accent)' : 'var(--fg-faint)'} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
    </ModalShell>
  );
}
