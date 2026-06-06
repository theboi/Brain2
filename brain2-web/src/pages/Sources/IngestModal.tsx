/*
 * Brain2 Console — "Ingest sources" modal (combined file + URL queue, per-row
 * vault / topic / mode pickers, bulk-set bar, and per-vault access management).
 * Faithful TS port of the IngestModal tree in docs/design/v1/project/components.jsx.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import type { DroppedFile } from '@/lib/sources';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useIngestUrl, uploadFileWithProgress } from '@/hooks/useIngest';

// ── constants ─────────────────────────────────────────────────────────────────
const INGEST_TYPE_ICON: Record<string, IconName> = { pdf: 'file', md: 'hash', url: 'globe', txt: 'file', img: 'image', code: 'code', audio: 'sparkles' };
const PROJECT_OPTS = ['default', 'research-q3', 'launch-docs', 'archive'];
const INGEST_MODES: { id: string; label: string; icon: IconName; desc: string }[] = [
  { id: 'wiki', label: 'Wiki', icon: 'wand', desc: 'Summarise with the LLM into a clean wiki page' },
  { id: 'static', label: 'Static', icon: 'file', desc: 'Store the source as-is, no rewriting' },
  { id: 'dynamic', label: 'Dynamic', icon: 'layers', desc: 'Link a live database — refreshes on change' },
];
const INGEST_TOPICS = ['Micrographia', 'Cell theory', 'Constitutional AI', 'LLM Gateway', 'User research Q3', 'Origin of Species', 'Microscopy', 'Alignment methods', 'Web crawling', 'Q3 themes'];
const ACCESS_LEVELS: { id: string; label: string; icon: IconName }[] = [
  { id: 'none', label: 'No access', icon: 'x' },
  { id: 'read', label: 'Read only', icon: 'file' },
  { id: 'write', label: 'Read & write', icon: 'pencil' },
  { id: 'admin', label: 'Admin', icon: 'shield' },
];
const PEOPLE_POOL: Person[] = [
  { id: 'u_alice', name: 'alice', kind: 'user' }, { id: 'u_bob', name: 'bob', kind: 'user' },
  { id: 'u_carol', name: 'carol', kind: 'user' }, { id: 'u_dan', name: 'dan', kind: 'user' },
  { id: 'g_everyone', name: 'Everyone', kind: 'group' }, { id: 'g_research', name: 'Research', kind: 'group' },
  { id: 'g_eng', name: 'Engineering', kind: 'group' }, { id: 'g_design', name: 'Design', kind: 'group' },
];
const seedAccess = (): Member[] => ([
  { id: 'g_everyone', name: 'Everyone', kind: 'group', level: 'none' },
  { id: 'g_research', name: 'Research', kind: 'group', level: 'write' },
  { id: 'u_alice', name: 'alice', kind: 'user', level: 'admin' },
]);

interface Person { id: string; name: string; kind: 'user' | 'group'; }
interface Member extends Person { level: string; }
interface Row { id: string; kind: 'file' | 'url'; name: string; type: string; size: string; url?: string; project: string; suggestedTopic: string; topic: string; mode: string; collision: boolean; }

const ingBtnGhost = (): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, cursor: 'pointer' });
const ingBtnPrimary = (): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
const ingPill = (open: boolean, full?: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, width: full ? '100%' : 'auto', maxWidth: '100%', height: 28, padding: '0 9px', borderRadius: 7, border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' });
const ingRowBtn = (): CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 9, width: '100%', minHeight: 34, padding: '0 9px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5, cursor: 'pointer', textAlign: 'left' });

// Lightweight fixed-position popover. children is a render fn (close) => content.
function IngMenu({ trigger, width = 240, align = 'left', full = false, children }: {
  trigger: (open: boolean) => ReactNode; width?: number; align?: 'left' | 'right'; full?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      let left = align === 'right' ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = r.bottom + 6;
      if (top + 280 > window.innerHeight) top = Math.max(8, r.top - 6 - 280);
      setPos({ left, top });
    }
  }, [open, align, width]);
  const close = () => setOpen(false);
  return (
    <Fragment>
      <div ref={ref} onClick={() => setOpen((o) => !o)} style={{ display: full ? 'block' : 'inline-flex', width: full ? '100%' : 'auto', minWidth: 0 }}>{trigger(open)}</div>
      {open && (
        <Fragment>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 305 }} />
          <div className="b2-anim-pop" style={{ position: 'fixed', left: pos.left, top: pos.top, width, zIndex: 306, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 18px 50px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
            {children(close)}
          </div>
        </Fragment>
      )}
    </Fragment>
  );
}

function IngCheck({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onChange(); }} style={{ width: 17, height: 17, flexShrink: 0, borderRadius: 5, border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`, background: checked ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
      {checked && <Icon name="check" size={11} color="#fff" />}
    </button>
  );
}

function ProjectPicker({ value, onPick, full }: { value: string | null; onPick: (v: string) => void; full?: boolean }) {
  return (
    <IngMenu width={224} full={full} trigger={(open) => (
      <button style={{ ...ingPill(open, full), color: value ? 'var(--fg)' : 'var(--fg-muted)' }} title={value || 'Choose vault'}>
        <Icon name="folder" size={13} color="var(--fg-muted)" />
        <span style={{ flex: full ? 1 : 'none', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{value || 'Vault'}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 9px 4px' }}>Vault · project</div>
          {PROJECT_OPTS.map((p) => (
            <button key={p} onClick={() => { onPick(p); close(); }} style={ingRowBtn()}>
              <Icon name="folder" size={13} color="var(--fg-muted)" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
              {value === p && <Icon name="check" size={14} color="var(--accent)" />}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
          <button onClick={() => { onPick('new-vault'); close(); }} style={ingRowBtn()}>
            <Icon name="plus" size={13} color="var(--accent)" /><span style={{ color: 'var(--accent)', fontWeight: 600 }}>New vault…</span>
          </button>
        </div>
      )}
    </IngMenu>
  );
}

function TopicMenuBody({ value, onPick }: { value: string | null; onPick: (t: string) => void }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const list = INGEST_TOPICS.filter((t) => t.toLowerCase().includes(ql));
  const exact = INGEST_TOPICS.some((t) => t.toLowerCase() === ql);
  return (
    <div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
          <Icon name="search" size={14} color="var(--fg-muted)" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 12.5, fontFamily: 'var(--ui-font)' }} />
        </div>
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto', padding: 6 }}>
        {!exact && (
          <button onClick={() => onPick(q.trim() || 'New topic')} style={ingRowBtn()}>
            <Icon name="plus" size={14} color="var(--accent)" />
            <span style={{ color: 'var(--accent)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.trim() ? `Create “${q.trim()}”` : 'Create new topic'}</span>
          </button>
        )}
        {list.map((t) => (
          <button key={t} onClick={() => onPick(t)} style={ingRowBtn()}>
            <Icon name="wiki" size={13} color="var(--fg-muted)" />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
            {value === t && <Icon name="check" size={14} color="var(--accent)" />}
          </button>
        ))}
        {!list.length && <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--fg-faint)' }}>No topic matches “{q.trim()}”.</div>}
      </div>
    </div>
  );
}

function TopicPicker({ value, suggested, onPick, full }: { value: string | null; suggested: string | null; onPick: (v: string) => void; full?: boolean }) {
  const isAi = !!value && value === suggested;
  return (
    <IngMenu width={252} full={full} trigger={(open) => (
      <button style={{ ...ingPill(open, full), color: value ? 'var(--fg)' : 'var(--fg-muted)' }} title={value || 'Choose topic'}>
        <Icon name={isAi ? 'sparkles' : 'wiki'} size={13} color={isAi ? 'var(--accent)' : 'var(--fg-muted)'} />
        <span style={{ flex: full ? 1 : 'none', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{value || 'Topic'}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => <TopicMenuBody value={value} onPick={(t) => { onPick(t); close(); }} />}
    </IngMenu>
  );
}

function ModePicker({ value, onPick, full }: { value: string | null; onPick: (v: string) => void; full?: boolean }) {
  const m = INGEST_MODES.find((x) => x.id === value);
  return (
    <IngMenu width={268} align="right" full={full} trigger={(open) => (
      <button style={{ ...ingPill(open, full), color: m ? 'var(--fg)' : 'var(--fg-muted)' }} title={m ? m.desc : 'Ingestion mode'}>
        <Icon name={m ? m.icon : 'sliders'} size={13} color={m ? 'var(--accent)' : 'var(--fg-muted)'} />
        <span style={{ flex: full ? 1 : 'none', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{m ? m.label : 'Mode'}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          {INGEST_MODES.map((o) => (
            <button key={o.id} onClick={() => { onPick(o.id); close(); }} style={{ ...ingRowBtn(), alignItems: 'flex-start', padding: '9px' }}>
              <Icon name={o.icon} size={15} color={value === o.id ? 'var(--accent)' : 'var(--fg-muted)'} />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={{ fontWeight: 600 }}>{o.label}</b>{value === o.id && <Icon name="check" size={13} color="var(--accent)" />}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.4 }}>{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </IngMenu>
  );
}

function AddPeopleBody({ members, onAdd }: { members: Member[]; onAdd: (p: Person) => void }) {
  const [q, setQ] = useState('');
  const have = new Set(members.map((m) => m.id));
  const ql = q.trim().toLowerCase();
  const list = PEOPLE_POOL.filter((p) => !have.has(p.id) && p.name.toLowerCase().includes(ql));
  return (
    <div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
          <Icon name="search" size={14} color="var(--fg-muted)" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="People or groups…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 12.5, fontFamily: 'var(--ui-font)' }} />
        </div>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', padding: 6 }}>
        {list.map((p) => (
          <button key={p.id} onClick={() => onAdd(p)} style={ingRowBtn()}>
            <Icon name={p.kind === 'group' ? 'users' : 'user'} size={13} color="var(--fg-muted)" />
            <span style={{ flex: 1 }}>{p.name}</span>
            <span style={{ fontSize: 10.5, color: 'var(--fg-faint)' }}>{p.kind}</span>
          </button>
        ))}
        {!list.length && <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--fg-faint)' }}>{ql ? `Invite “${q.trim()}” by email` : 'Everyone already added.'}</div>}
      </div>
    </div>
  );
}

function AddPeople({ members, onAdd }: { members: Member[]; onAdd: (p: Person) => void }) {
  return (
    <IngMenu width={238} align="right" trigger={(open) => (
      <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 7, border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, background: 'transparent', color: 'var(--accent)', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        <Icon name="plus" size={13} color="var(--accent)" /> Add people
      </button>
    )}>
      {(close) => <AddPeopleBody members={members} onAdd={(p) => { onAdd(p); close(); }} />}
    </IngMenu>
  );
}

function LevelPicker({ value, onPick }: { value: string; onPick: (v: string) => void }) {
  const lv = ACCESS_LEVELS.find((l) => l.id === value) || ACCESS_LEVELS[0];
  const isNone = value === 'none';
  return (
    <IngMenu width={204} align="right" trigger={(open) => (
      <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 9px', borderRadius: 7, border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, background: isNone ? 'transparent' : 'var(--surface)', color: isNone ? 'var(--fg-faint)' : 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <Icon name={lv.icon} size={12} color={value === 'admin' ? 'var(--accent)' : 'currentColor'} /> {lv.label} <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          {ACCESS_LEVELS.map((l) => (
            <button key={l.id} onClick={() => { onPick(l.id); close(); }} style={ingRowBtn()}>
              <Icon name={l.icon} size={13} color={l.id === 'admin' ? 'var(--accent)' : 'var(--fg-muted)'} />
              <span style={{ flex: 1 }}>{l.label}</span>
              {value === l.id && <Icon name="check" size={14} color="var(--accent)" />}
            </button>
          ))}
        </div>
      )}
    </IngMenu>
  );
}

function AccessRow({ m, onLevel, onRemove }: { m: Member; onLevel: (l: string) => void; onRemove: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 28, height: 28, flexShrink: 0, borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}><Icon name={m.kind === 'group' ? 'users' : 'user'} size={14} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{m.name}</div>
        <div style={{ fontSize: 10.5, color: 'var(--fg-faint)' }}>{m.kind === 'group' ? 'Group' : 'User'}</div>
      </div>
      <LevelPicker value={m.level} onPick={onLevel} />
      <button onClick={onRemove} style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={13} /></button>
    </div>
  );
}

function VaultAccess({ vaults, accessFor, onLevel, onAdd, onRemove }: {
  vaults: string[]; accessFor: (v: string) => Member[];
  onLevel: (v: string, id: string, l: string) => void; onAdd: (v: string, p: Person) => void; onRemove: (v: string, id: string) => void;
}) {
  const [active, setActive] = useState(vaults[0]);
  useEffect(() => { if (!vaults.includes(active)) setActive(vaults[0]); }, [vaults.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const av = vaults.includes(active) ? active : vaults[0];
  const members = accessFor(av);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 10, lineHeight: 1.45 }}>
        <Icon name="key" size={13} color="var(--fg-faint)" /> <span>1 vault = 1 project · 1 topic = 1 wiki page · vaults are isolated, with no cross-vault links, so each vault's data stays contained.</span>
      </div>
      {vaults.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {vaults.map((v) => (
            <button key={v} onClick={() => setActive(v)} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 7, border: `1px solid ${v === av ? 'var(--accent)' : 'var(--border)'}`, background: v === av ? 'var(--accent-soft)' : 'transparent', color: v === av ? 'var(--fg)' : 'var(--fg-muted)', fontSize: 12, fontWeight: v === av ? 600 : 500, cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
              <Icon name="folder" size={12} color={v === av ? 'var(--accent)' : 'var(--fg-muted)'} /> {v}
            </button>
          ))}
        </div>
      )}
      <div style={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="folder" size={14} color="var(--fg-muted)" />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{av}</span>
          <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{members.filter((m) => m.level !== 'none').length} with access</span>
          <span style={{ marginLeft: 'auto' }}><AddPeople members={members} onAdd={(p) => onAdd(av, p)} /></span>
        </div>
        {members.map((m) => <AccessRow key={m.id} m={m} onLevel={(l) => onLevel(av, m.id, l)} onRemove={() => onRemove(av, m.id)} />)}
      </div>
    </div>
  );
}

function IngestQueueBar({ total, selCount, allSel, onToggleAll, onBulk, onClearSel, onRemoveSel }: {
  total: number; selCount: number; allSel: boolean; onToggleAll: () => void;
  onBulk: (p: Partial<Row>) => void; onClearSel: () => void; onRemoveSel: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', minHeight: 46, flexWrap: 'wrap' }}>
      <IngCheck checked={allSel} onChange={onToggleAll} />
      {selCount > 0 ? (
        <Fragment>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap' }}>{selCount} selected</span>
          <button onClick={onClearSel} style={{ border: 'none', background: 'transparent', color: 'var(--fg-muted)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>clear</button>
          <span style={{ width: 1, height: 18, background: 'var(--border-strong)' }} />
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>Set for all:</span>
          <ProjectPicker value={null} onPick={(v) => onBulk({ project: v })} />
          <TopicPicker value={null} suggested={null} onPick={(v) => onBulk({ topic: v })} />
          <ModePicker value={null} onPick={(v) => onBulk({ mode: v })} />
          <button onClick={onRemoveSel} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--destructive)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--ui-font)', marginLeft: 'auto' }}><Icon name="trash" size={13} /> Remove</button>
        </Fragment>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{total} item{total === 1 ? '' : 's'} queued · select rows to bulk-set vault, topic or mode</span>
      )}
    </div>
  );
}

function IngestRow({ r, selected, onToggle, onChange, onRemove }: {
  r: Row; selected: boolean; onToggle: () => void; onChange: (p: Partial<Row>) => void; onRemove: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: '1px solid var(--border)', background: selected ? 'var(--accent-soft)' : 'transparent' }}>
      <IngCheck checked={selected} onChange={onToggle} />
      <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}><Icon name={INGEST_TYPE_ICON[r.type] || 'file'} size={14} /></span>
      <div style={{ flex: 1, minWidth: 80 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.kind === 'url' ? r.url : r.name}</div>
        <div style={{ fontSize: 10.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.kind === 'url' ? 'web page' : `${r.type} · ${r.size}`}{r.collision && <span style={{ color: 'var(--warning)' }}> · topic exists</span>}
        </div>
      </div>
      <div style={{ flexShrink: 0, width: 124, minWidth: 0 }}><ProjectPicker value={r.project} onPick={(v) => onChange({ project: v })} full /></div>
      <div style={{ flexShrink: 0, width: 150, minWidth: 0 }}><TopicPicker value={r.topic} suggested={r.suggestedTopic} onPick={(v) => onChange({ topic: v })} full /></div>
      <div style={{ flexShrink: 0, width: 104, minWidth: 0 }}><ModePicker value={r.mode} onPick={(v) => onChange({ mode: v })} full /></div>
      <button onClick={onRemove} style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={13} /></button>
    </div>
  );
}

const norm = (f: Partial<DroppedFile> & { kind?: string; url?: string; suggestedTopic?: string }, i: number, project: string): Row => {
  const isUrl = f.kind === 'url' || f.type === 'url' || (!!f.url && !f.type);
  return {
    id: 'q' + i + '_' + (f.name || f.url || ''),
    kind: isUrl ? 'url' : 'file',
    name: f.name || f.url || 'untitled',
    type: f.type || (isUrl ? 'url' : 'file'),
    size: f.size || '—',
    url: f.url || (isUrl ? f.name : undefined),
    project: f.project || project,
    suggestedTopic: f.suggestedTopic || f.topic || '',
    topic: f.topic || f.suggestedTopic || '',
    mode: f.mode || 'wiki',
    collision: !!f.collision,
  };
};

export function IngestModal({ open, onClose, files = [] }: {
  open: boolean; onClose: () => void; files?: DroppedFile[];
}) {
  const { projectId } = useWorkspace();
  const qc = useQueryClient();
  const ingestUrl = useIngestUrl(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // pendingFiles: tracks File objects for rows added via picker/drop
  const pendingFiles = useRef<Map<string, File>>(new Map());
  // progress: filename → 0..1 fraction
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const effectiveProject = projectId ?? 'default';

  const seedRows = (): Row[] => files.map((f, i) => norm(f, i, effectiveProject));
  const [rows, setRows] = useState<Row[]>(seedRows);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState('');
  const [access, setAccess] = useState<Record<string, Member[]>>({});
  const [showAccess, setShowAccess] = useState(true);
  useEffect(() => {
    if (open) {
      setRows(seedRows());
      setSel(new Set());
      setProgress({});
      setSubmitting(false);
      pendingFiles.current = new Map();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;

  const addUrl = () => {
    const v = draft.trim();
    if (!v) return;
    let host = v;
    try { host = new URL(v.match(/^https?:\/\//) ? v : 'https://' + v).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    setRows((rs) => [...rs, { id: 'u' + Date.now(), kind: 'url', name: v, url: v, type: 'url', size: '—', project: effectiveProject, suggestedTopic: host, topic: host, mode: 'wiki', collision: false }]);
    setDraft('');
  };

  const addFilesToQueue = (picked: File[]) => {
    const newRows: Row[] = picked.map((f, i) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? 'file';
      const typeMap: Record<string, string> = { pdf: 'pdf', md: 'md', txt: 'md', png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', webp: 'img', py: 'code', js: 'code', ts: 'code', mp3: 'audio', m4a: 'audio', wav: 'audio' };
      const type = typeMap[ext] ?? 'file';
      const sizeKb = f.size / 1024;
      const size = sizeKb < 1024 ? `${sizeKb.toFixed(0)} KB` : `${(sizeKb / 1024).toFixed(1)} MB`;
      pendingFiles.current.set(f.name, f);
      return norm({ name: f.name, type, size, project: effectiveProject, topic: '', mode: 'wiki' }, rows.length + i, effectiveProject);
    });
    setRows((rs) => [...rs, ...newRows]);
  };

  const onBrowseClick = () => fileInputRef.current?.click();

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) addFilesToQueue(picked);
    e.target.value = '';
  };

  const onDropZoneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const picked = Array.from(e.dataTransfer.files);
    if (picked.length) addFilesToQueue(picked);
  };

  const onIngest = async () => {
    if (rows.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      // Submit URL rows
      const urlRows = rows.filter((r) => r.kind === 'url');
      await Promise.allSettled(
        urlRows.map((r) =>
          ingestUrl.mutateAsync({ url: r.url ?? r.name, topic: r.topic || undefined }),
        ),
      );

      // Upload file rows that have corresponding File objects
      if (projectId) {
        const fileRows = rows.filter((r) => r.kind === 'file');
        const uploads = Array.from(pendingFiles.current.entries()).map(([name, file]) => {
          const row = fileRows.find((r) => r.name === name);
          const handle = uploadFileWithProgress(projectId, file, {
            topic: row?.topic || undefined,
            onProgress: (frac) => setProgress((p) => ({ ...p, [name]: frac })),
          });
          return handle.promise
            .then(() => setProgress((p) => { const { [name]: _, ...rest } = p; return rest; }))
            .catch((err) => console.error('upload error', name, err));
        });
        await Promise.allSettled(uploads);
        qc.invalidateQueries({ queryKey: ['sources', projectId] });
      }

      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const ids = rows.map((r) => r.id);
  const allSel = ids.length > 0 && ids.every((id) => sel.has(id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allSel ? new Set() : new Set(ids));
  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...p } : r));
  const bulk = (p: Partial<Row>) => setRows((rs) => rs.map((r) => sel.has(r.id) ? { ...r, ...p } : r));
  const removeRow = (id: string) => { setRows((rs) => rs.filter((r) => r.id !== id)); setSel((s) => { const n = new Set(s); n.delete(id); return n; }); };
  const removeSel = () => { setRows((rs) => rs.filter((r) => !sel.has(r.id))); setSel(new Set()); };

  const vaults = [...new Set(rows.map((r) => r.project))];
  const accessFor = (v: string) => access[v] || seedAccess();
  const setLevel = (v: string, id: string, level: string) => setAccess((a) => { const cur = a[v] || seedAccess(); return { ...a, [v]: cur.map((m) => m.id === id ? { ...m, level } : m) }; });
  const addMember = (v: string, p: Person) => setAccess((a) => { const cur = a[v] || seedAccess(); if (cur.some((m) => m.id === p.id)) return a; return { ...a, [v]: [...cur, { ...p, level: 'read' }] }; });
  const rmMember = (v: string, id: string) => setAccess((a) => { const cur = a[v] || seedAccess(); return { ...a, [v]: cur.filter((m) => m.id !== id) }; });
  const selCount = sel.size;

  const progressEntries = Object.entries(progress);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {/* hidden file input */}
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={onFileInputChange} />
      <div onClick={(e) => e.stopPropagation()} className="b2-anim-slide" style={{ width: 880, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 14px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="download" size={18} color="var(--accent)" />
          <span style={{ fontFamily: 'var(--display-font)', fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>Ingest sources</span>
          <span style={{ marginLeft: 'auto' }}><button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={15} /></button></span>
        </div>
        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* combined add area — files + URL in one place */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDropZoneDrop}
            style={{ borderRadius: 12, border: `1.5px dashed ${dragOver ? 'var(--accent)' : 'var(--border-strong)'}`, background: dragOver ? 'var(--accent-soft)' : 'var(--bg)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12, transition: 'border-color .1s, background .1s' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="download" size={19} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Drag files here, or <button onClick={onBrowseClick} style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--ui-font)', cursor: 'pointer', padding: 0 }}>browse</button></div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>PDF · Markdown · text · images · code — or paste a link below</div>
              </div>
            </div>
            {progressEntries.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {progressEntries.map(([name, frac]) => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-muted)' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                    <div style={{ width: 80, height: 4, borderRadius: 2, background: 'var(--border)' }}>
                      <div style={{ width: `${Math.round(frac * 100)}%`, height: '100%', borderRadius: 2, background: 'var(--accent)', transition: 'width .15s' }} />
                    </div>
                    <span style={{ width: 30, textAlign: 'right' }}>{Math.round(frac * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 9, height: 36, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <Icon name="globe" size={15} color="var(--fg-muted)" />
                <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addUrl(); }} placeholder="https://…  paste a page or sitemap URL" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }} />
              </div>
              <button onClick={addUrl} style={ingBtnGhost()}><Icon name="plus" size={14} /> Add link</button>
            </div>
          </div>

          {/* queue */}
          <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)' }}>
            <IngestQueueBar total={rows.length} selCount={selCount} allSel={allSel} onToggleAll={toggleAll} onBulk={bulk} onClearSel={() => setSel(new Set())} onRemoveSel={removeSel} />
            <div>
              {rows.map((r) => <IngestRow key={r.id} r={r} selected={sel.has(r.id)} onToggle={() => toggle(r.id)} onChange={(p) => patch(r.id, p)} onRemove={() => removeRow(r.id)} />)}
              {!rows.length && <div style={{ textAlign: 'center', color: 'var(--fg-faint)', padding: '26px 0', fontSize: 12.5 }}>Nothing queued — drop files or paste a link above.</div>}
            </div>
          </div>

          {/* access management */}
          {vaults.length > 0 && (
            <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', padding: 14 }}>
              <button onClick={() => setShowAccess((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                <Icon name="shield" size={16} color="var(--accent)" />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Vault access</span>
                <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{vaults.length} vault{vaults.length > 1 ? 's' : ''}</span>
                <span style={{ marginLeft: 'auto', transform: showAccess ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .12s', display: 'flex' }}><Icon name="chevDown" size={15} color="var(--fg-muted)" /></span>
              </button>
              {showAccess && <VaultAccess vaults={vaults} accessFor={accessFor} onLevel={setLevel} onAdd={addMember} onRemove={rmMember} />}
            </div>
          )}
        </div>
        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{rows.length} item{rows.length === 1 ? '' : 's'} → <b style={{ color: 'var(--fg)' }}>{vaults.length}</b> vault{vaults.length === 1 ? '' : 's'}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={ingBtnGhost()}>Cancel</button>
            <button onClick={onIngest} disabled={submitting || rows.length === 0} style={{ ...ingBtnPrimary(), opacity: (rows.length && !submitting) ? 1 : 0.5, cursor: submitting ? 'wait' : 'pointer' }}><Icon name="download" size={14} color="#fff" /> {submitting ? 'Ingesting…' : `Ingest${rows.length ? ` ${rows.length}` : ''}`}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
