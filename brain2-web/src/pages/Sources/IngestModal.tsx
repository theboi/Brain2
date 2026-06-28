/*
 * Brain2 Console — "Ingest sources" modal (combined file + URL queue, per-row
 * vault / tags / mode pickers, bulk-set bar, and per-vault access management).
 * Faithful TS port of the IngestModal tree in docs/design/v1/project/components.jsx.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { useProjects, useUserDirectory } from '@/hooks/useWorkspaces';
import { useProjectTags } from '@/hooks/useSources';
import { useVaultAccess, useAddGuest, useSetGuestRole, useRemoveGuest } from '@/hooks/access';
import { useWorkspaceMembers } from '@/hooks/members';
import { Checkbox } from '@/components/ui/Checkbox';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { ManageTagsOverlay } from '@/components/overlays/ManageTagsOverlay';
export interface DroppedFile { name: string; type: string; size: string; project: string; tags?: string[]; collision?: boolean; mode: 'wiki' | 'dynamic' | 'static'; }
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useIngestUrl, uploadFileWithProgress } from '@/hooks/useIngest';
import { ops } from '@/lib/api';

// ── constants ─────────────────────────────────────────────────────────────────
const INGEST_TYPE_ICON: Record<string, IconName> = { pdf: 'file', md: 'hash', url: 'globe', txt: 'file', img: 'image', code: 'code', audio: 'sparkles' };
const INGEST_MODES: { id: string; label: string; icon: IconName; desc: string }[] = [
  { id: 'wiki', label: 'Wiki', icon: 'wand', desc: 'Summarise with the LLM into a clean wiki page' },
  { id: 'static', label: 'Static', icon: 'file', desc: 'Store the source as-is, no rewriting' },
  { id: 'dynamic', label: 'Dynamic', icon: 'layers', desc: 'Link a live database — refreshes on change' },
];
type AccessLevelId = 'none' | 'read' | 'write' | 'admin';
type GuestRole = 'viewer' | 'editor' | 'admin';

const ACCESS_LEVELS: { id: AccessLevelId; label: string; icon: IconName }[] = [
  { id: 'none', label: 'No access', icon: 'x' },
  { id: 'read', label: 'Read only', icon: 'file' },
  { id: 'write', label: 'Read & write', icon: 'pencil' },
  { id: 'admin', label: 'Admin', icon: 'shield' },
];

const LEVEL_TO_ROLE: Record<Exclude<AccessLevelId, 'none'>, GuestRole> = {
  read: 'viewer',
  write: 'editor',
  admin: 'admin',
};
const ROLE_TO_LEVEL: Record<string, AccessLevelId> = {
  owner: 'admin',
  admin: 'admin',
  editor: 'write',
  viewer: 'read',
  member: 'read',
};

interface Person { id: string; name: string; email?: string | null; kind: 'user'; }
interface Member extends Person { level: AccessLevelId; source: 'owner' | 'workspace_admin' | 'workspace_member' | 'guest'; }
interface Row { id: string; kind: 'file' | 'url'; name: string; type: string; size: string; url?: string; project: string; tags: string[]; mode: string; collision: boolean; }

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
      {open && createPortal(
        <Fragment>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 305 }} />
          <div className="b2-anim-pop" style={{ position: 'fixed', left: pos.left, top: pos.top, width, zIndex: 306, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 18px 50px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
            {children(close)}
          </div>
        </Fragment>,
        document.body,
      )}
    </Fragment>
  );
}

function ProjectPicker({ value, onPick, full, options, loading }: {
  value: string | null; onPick: (projectId: string) => void; full?: boolean;
  options: { project_id: string; name: string }[]; loading?: boolean;
}) {
  const selectedName = options.find((p) => p.project_id === value)?.name ?? '';
  return (
    <IngMenu width={224} full={full} trigger={(open) => (
      <button style={{ ...ingPill(open, full), color: value ? 'var(--fg)' : 'var(--fg-muted)' }} title={selectedName || 'Choose vault'}>
        <Icon name="folder" size={13} color="var(--fg-muted)" />
        <span style={{ flex: full ? 1 : 'none', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{selectedName || 'Vault'}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 9px 4px' }}>Vault · project</div>
          {loading && <div style={{ padding: '8px 9px', fontSize: 12, color: 'var(--fg-faint)' }}>Loading…</div>}
          {!loading && options.length === 0 && <div style={{ padding: '8px 9px', fontSize: 12, color: 'var(--fg-faint)' }}>No vaults yet</div>}
          {options.map((p) => (
            <button key={p.project_id} onClick={() => { onPick(p.project_id); close(); }} style={ingRowBtn()}>
              <Icon name="folder" size={13} color="var(--fg-muted)" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              {value === p.project_id && <Icon name="check" size={14} color="var(--accent)" />}
            </button>
          ))}
        </div>
      )}
    </IngMenu>
  );
}

function TagsMenuBody({ value, options, onChange }: { value: string[]; options: string[]; onChange: (tags: string[]) => void }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const list = options.filter((t) => t.toLowerCase().includes(ql));
  const exact = options.some((t) => t.toLowerCase() === ql);
  const selected = new Set(value);
  const toggle = (tag: string) => {
    const next = selected.has(tag) ? value.filter((t) => t !== tag) : [...value, tag];
    onChange(next);
  };
  const addTag = () => {
    const tag = q.trim();
    if (!tag || exact) return;
    onChange(selected.has(tag) ? value : [...value, tag]);
  };
  return (
    <div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
          <Icon name="search" size={14} color="var(--fg-muted)" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 12.5, fontFamily: 'var(--ui-font)' }} />
        </div>
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto', padding: 6 }}>
        {list.map((t) => (
          <button key={t} onClick={() => toggle(t)} style={ingRowBtn()}>
            <Checkbox checked={selected.has(t)} onChange={() => toggle(t)} size={15} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
          </button>
        ))}
        {q.trim() && !exact && (
          <button onClick={addTag} style={ingRowBtn()}>
            <Icon name="plus" size={14} color="var(--accent)" />
            <span style={{ color: 'var(--accent)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Add "{q.trim()}"</span>
          </button>
        )}
        {!list.length && !q.trim() && <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--fg-faint)' }}>No tags yet.</div>}
      </div>
    </div>
  );
}

function TagsPicker({ value, options, onChange, full }: { value: string[]; options: string[]; onChange: (tags: string[]) => void; full?: boolean }) {
  const hasTags = value.length > 0;
  return (
    <IngMenu width={252} full={full} trigger={(open) => (
      <button style={{ ...ingPill(open, full), width: hasTags && !full ? 28 : full ? '100%' : 'auto', justifyContent: hasTags && !full ? 'center' : 'flex-start', padding: hasTags && !full ? 0 : '0 9px', color: hasTags ? 'var(--fg)' : 'var(--fg-muted)' }} title={value.join(', ') || 'Choose tags'} aria-label={hasTags ? 'Add tag' : 'Choose tags'}>
        <Icon name={hasTags ? 'plus' : 'hash'} size={13} color={hasTags ? 'var(--accent)' : 'var(--fg-muted)'} />
        {(!hasTags || full) && <span style={{ flex: full ? 1 : 'none', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{hasTags ? 'Add tag' : 'Tags'}</span>}
        {(!hasTags || full) && <Icon name="chevDown" size={12} color="var(--fg-muted)" />}
      </button>
    )}>
      {() => <TagsMenuBody value={value} options={options} onChange={onChange} />}
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

function AddPeopleBody({ members, candidates, onAdd }: { members: Member[]; candidates: Person[]; onAdd: (p: Person) => void }) {
  const [q, setQ] = useState('');
  const have = new Set(members.map((m) => m.id));
  const ql = q.trim().toLowerCase();
  const list = candidates.filter((p) => !have.has(p.id) && `${p.name} ${p.email ?? ''}`.toLowerCase().includes(ql));
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
            <Icon name="user" size={13} color="var(--fg-muted)" />
            <span style={{ flex: 1 }}>{p.name}</span>
            <span style={{ fontSize: 10.5, color: 'var(--fg-faint)' }}>user</span>
          </button>
        ))}
        {!list.length && <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--fg-faint)' }}>{ql ? 'No matching people.' : 'All available people are already added.'}</div>}
      </div>
    </div>
  );
}

function AddPeople({ members, candidates, onAdd }: { members: Member[]; candidates: Person[]; onAdd: (p: Person) => void }) {
  return (
    <IngMenu width={238} align="right" trigger={(open) => (
      <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 7, border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, background: 'transparent', color: 'var(--accent)', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        <Icon name="plus" size={13} color="var(--accent)" /> Add people
      </button>
    )}>
      {(close) => <AddPeopleBody members={members} candidates={candidates} onAdd={(p) => { onAdd(p); close(); }} />}
    </IngMenu>
  );
}

function LevelPicker({ value, onPick }: { value: AccessLevelId; onPick: (v: AccessLevelId) => void }) {
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

const accessSourceLabel = (m: Member) => {
  if (m.source === 'owner') return 'Tenant owner';
  if (m.source === 'workspace_admin') return 'Workspace admin';
  if (m.source === 'workspace_member') return 'Workspace member';
  return m.email || 'Guest';
};

function AccessRow({ m, onLevel, onRemove }: { m: Member; onLevel: (l: AccessLevelId) => void; onRemove: () => void }) {
  const locked = m.source !== 'guest';
  const lv = ACCESS_LEVELS.find((l) => l.id === m.level) || ACCESS_LEVELS[1];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 28, height: 28, flexShrink: 0, borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}><Icon name="user" size={14} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{m.name}</div>
        <div style={{ fontSize: 10.5, color: 'var(--fg-faint)' }}>{accessSourceLabel(m)}</div>
      </div>
      {locked ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg-muted)', fontSize: 12, fontWeight: 500 }}>
          <Icon name={lv.icon} size={12} color="var(--fg-faint)" /> {lv.label}
        </span>
      ) : (
        <LevelPicker value={m.level} onPick={onLevel} />
      )}
      {!locked && <button onClick={onRemove} style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={13} /></button>}
    </div>
  );
}

function VaultAccess({ vaults, projectIdByName, workspaceId }: { vaults: string[]; projectIdByName: Map<string, string>; workspaceId: string | null }) {
  const [active, setActive] = useState(vaults[0]);
  useEffect(() => { if (!vaults.includes(active)) setActive(vaults[0]); }, [vaults.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const av = vaults.includes(active) ? active : vaults[0];
  const activeProjectId = projectIdByName.get(av) ?? null;
  const { data: accessEntries = [] } = useVaultAccess(activeProjectId);
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId);
  const { data: tenantUsers = [] } = useUserDirectory(workspaceId);
  const addGuest = useAddGuest(activeProjectId);
  const setGuestRole = useSetGuestRole(activeProjectId);
  const removeGuest = useRemoveGuest(activeProjectId);
  const members: Member[] = accessEntries.map((entry) => ({
    id: entry.user_id,
    name: entry.display_name || entry.email,
    email: entry.email,
    kind: 'user',
    level: ROLE_TO_LEVEL[entry.role] ?? 'read',
    source: entry.source,
  }));
  const presentAccess = new Set(accessEntries.map((entry) => entry.user_id));
  const workspaceMemberIds = new Set(workspaceMembers.map((member) => member.user_id));
  const candidates: Person[] = tenantUsers
    .filter((user) => !presentAccess.has(user.user_id) && !workspaceMemberIds.has(user.user_id))
    .map((user) => ({ id: user.user_id, name: user.display_name || user.email, email: user.email, kind: 'user' }));
  const setLevel = (userId: string, level: AccessLevelId) => {
    if (!activeProjectId) return;
    if (level === 'none') removeGuest.mutate({ project_id: activeProjectId, user_id: userId });
    else setGuestRole.mutate({ project_id: activeProjectId, user_id: userId, role: LEVEL_TO_ROLE[level] });
  };
  const addMember = (person: Person) => {
    if (!activeProjectId) return;
    addGuest.mutate({ project_id: activeProjectId, user_id: person.id, role: 'viewer' });
  };
  const removeMember = (userId: string) => {
    if (!activeProjectId) return;
    removeGuest.mutate({ project_id: activeProjectId, user_id: userId });
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 10, lineHeight: 1.45 }}>
        <Icon name="key" size={13} color="var(--fg-faint)" /> <span>Vaults are isolated — access is set per vault.</span>
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
          <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{members.length} with access</span>
          <span style={{ marginLeft: 'auto' }}><AddPeople members={members} candidates={candidates} onAdd={addMember} /></span>
        </div>
        {members.map((m) => <AccessRow key={m.id} m={m} onLevel={(l) => setLevel(m.id, l)} onRemove={() => removeMember(m.id)} />)}
        {!members.length && <div style={{ padding: '14px 12px', color: 'var(--fg-faint)', fontSize: 12 }}>No direct access entries.</div>}
      </div>
    </div>
  );
}

function IngestQueueBar({ total, selCount, allSel, onToggleAll, onBulk, onClearSel, onRemoveSel, tagOptions }: {
  total: number; selCount: number; allSel: boolean; onToggleAll: () => void;
  onBulk: (p: Partial<Row>) => void; onClearSel: () => void; onRemoveSel: () => void;
  tagOptions: string[];
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', minHeight: 46, flexWrap: 'wrap' }}>
      <Checkbox checked={allSel} onChange={onToggleAll} />
      {selCount > 0 ? (
        <Fragment>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap' }}>{selCount} selected</span>
          <button onClick={onClearSel} style={{ border: 'none', background: 'transparent', color: 'var(--fg-muted)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>clear</button>
          <span style={{ width: 1, height: 18, background: 'var(--border-strong)' }} />
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>Set for all:</span>
          <TagsPicker value={[]} options={tagOptions} onChange={(tags) => onBulk({ tags })} />
          <ModePicker value={null} onPick={(v) => onBulk({ mode: v })} />
          <button onClick={onRemoveSel} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--destructive)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--ui-font)', marginLeft: 'auto' }}><Icon name="trash" size={13} /> Remove</button>
        </Fragment>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{total} item{total === 1 ? '' : 's'} queued</span>
      )}
    </div>
  );
}

function IngestRow({ r, selected, onToggle, onChange, onRemove, tagOptions }: {
  r: Row; selected: boolean; onToggle: () => void; onChange: (p: Partial<Row>) => void; onRemove: () => void;
  tagOptions: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(r.name);
  const cancelRename = useRef(false);
  useEffect(() => { if (!editing) setDraftName(r.name); }, [editing, r.name]);
  const commitName = () => {
    if (cancelRename.current) {
      cancelRename.current = false;
      return;
    }
    onChange({ name: draftName.trim() || r.name });
    setEditing(false);
  };
  const cancelName = () => {
    cancelRename.current = true;
    setDraftName(r.name);
    setEditing(false);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: '1px solid var(--border)', background: selected ? 'var(--accent-soft)' : 'transparent' }}>
      <Checkbox checked={selected} onChange={onToggle} />
      <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}><Icon name={INGEST_TYPE_ICON[r.type] || 'file'} size={14} /></span>
      <div style={{ flex: 1, minWidth: 80 }}>
        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') cancelName();
            }}
            style={{ width: '100%', height: 24, border: '1px solid var(--accent)', outline: 'none', borderRadius: 6, background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, padding: '0 7px' }}
          />
        ) : (
          <button onClick={() => { cancelRename.current = false; setDraftName(r.name); setEditing(true); }} style={{ display: 'block', width: '100%', border: 'none', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left', padding: 0, cursor: 'text' }}>
            {r.name}
          </button>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.kind === 'url' ? `web page${r.url ? ` · ${r.url}` : ''}` : `${r.type} · ${r.size}`}{r.collision && <span style={{ color: 'var(--warning)' }}> · possible duplicate</span>}
        </div>
      </div>
      <div style={{ flexShrink: 0, width: 180, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {r.tags.map((tag) => (
          <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 7px', borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 11.5, fontWeight: 500, fontFamily: 'var(--ui-font)' }}>
            <Icon name="hash" size={10} color="var(--accent)" />
            <span style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
            <button
              onClick={() => onChange({ tags: r.tags.filter((t) => t !== tag) })}
              style={{ border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', padding: 0, display: 'flex', lineHeight: 1 }}
              title={`Remove ${tag}`}
              aria-label={`Remove ${tag}`}
            >
              <Icon name="x" size={10} />
            </button>
          </span>
        ))}
        <TagsPicker value={r.tags} options={tagOptions} onChange={(tags) => onChange({ tags })} />
      </div>
      <div style={{ flexShrink: 0, width: 104, minWidth: 0 }}><ModePicker value={r.mode} onPick={(v) => onChange({ mode: v })} full /></div>
      <button onClick={onRemove} style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={13} /></button>
    </div>
  );
}

const norm = (f: Partial<DroppedFile> & { kind?: string; url?: string }, i: number, project: string): Row => {
  const isUrl = f.kind === 'url' || f.type === 'url' || (!!f.url && !f.type);
  return {
    id: 'q' + i + '_' + (f.name || f.url || ''),
    kind: isUrl ? 'url' : 'file',
    name: f.name || f.url || 'untitled',
    type: f.type || (isUrl ? 'url' : 'file'),
    size: f.size || '—',
    url: f.url || (isUrl ? f.name : undefined),
    project: f.project || project,
    tags: f.tags || [],
    mode: f.mode || 'wiki',
    collision: !!f.collision,
  };
};

export function IngestModal({ open, onClose, files = [] }: {
  open: boolean; onClose: () => void; files?: DroppedFile[];
}) {
  const { workspaceId } = useWorkspace();
  const { data: projects = [], isLoading: vaultsLoading } = useProjects(workspaceId);
  const vaultOptions = projects.map((p) => p.name);
  const defaultVault = vaultOptions[0] ?? '';
  const [selectedVaultName, setSelectedVaultName] = useState<string>(() => defaultVault);
  const projectIdByName = new Map(projects.map((project) => [project.name, project.project_id]));
  const vaultProjectId = projectIdByName.get(selectedVaultName) ?? null;
  const { data: projectTags = [] } = useProjectTags(vaultProjectId);
  const qc = useQueryClient();
  const ingestUrl = useIngestUrl(vaultProjectId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFiles = useRef<Map<string, File>>(new Map());
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [manageTagsOpen, setManageTagsOpen] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  const seedRows = (): Row[] => files.map((f, i) => norm(f, i, defaultVault));
  const [rows, setRows] = useState<Row[]>(seedRows);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState('');
  const wikiModeSelected = rows.some((r) => r.mode === 'wiki');
  const { data: ollamaRuntime } = useQuery({
    queryKey: ['ollama-runtime'],
    queryFn: () => ops<{ available?: boolean; ollama_ok?: boolean; models?: string[] }>('agents:local:runtime', {}),
    staleTime: 30_000,
    enabled: wikiModeSelected,
  });
  const ollamaWarning = wikiModeSelected && ollamaRuntime && !(ollamaRuntime.available ?? ollamaRuntime.ollama_ok);

  useEffect(() => {
    if (vaultOptions.length > 0 && (!selectedVaultName || !vaultOptions.includes(selectedVaultName))) {
      setSelectedVaultName(vaultOptions[0]);
    }
  }, [vaultOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) {
      setRows(seedRows());
      setSel(new Set());
      setProgress({});
      setSubmitting(false);
      setUploadErrors([]);
      pendingFiles.current = new Map();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const addUrl = () => {
    const v = draft.trim();
    if (!v) return;
    setRows((rs) => [...rs, { id: 'u' + Date.now(), kind: 'url', name: v, url: v, type: 'url', size: '—', project: selectedVaultName, tags: [], mode: 'wiki', collision: false }]);
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
      return norm({ name: f.name, type, size, project: selectedVaultName, tags: [], mode: 'wiki' }, rows.length + i, selectedVaultName);
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
    const applyTags = async (sourceId: string, row: Row) => {
      if (!vaultProjectId) return;
      for (const tag of row.tags) {
        await ops('sources:tag', { project_id: vaultProjectId, source_id: sourceId, tag });
      }
    };
    const errs: string[] = [];
    setUploadErrors([]);
    setSubmitting(true);
    try {
      if (!vaultProjectId) {
        setUploadErrors(['Choose a vault before ingesting sources.']);
        return;
      }
      const urlRows = rows.filter((r) => r.kind === 'url');
      const urlResults = await Promise.allSettled(
        urlRows.map(async (r) => {
          const out = await ingestUrl.mutateAsync({ url: r.url ?? r.name, mode: r.mode });
          await applyTags(out.source_id, r);
        }),
      );
      urlResults.forEach((result, i) => {
        if (result.status === 'rejected') {
          errs.push(`URL "${urlRows[i].name}": ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
        }
      });
      if (vaultProjectId) {
        const fileRows = rows.filter((r) => r.kind === 'file');
        const uploads = Array.from(pendingFiles.current.entries()).map(([name, file]) => {
          const row = fileRows.find((r) => r.name === name);
          const handle = uploadFileWithProgress(vaultProjectId, file, {
            mode: row?.mode,
            onProgress: (frac) => setProgress((p) => ({ ...p, [name]: frac })),
          });
          return handle.promise
            .then(async (out) => {
              if (row) await applyTags(out.source_id, row);
            })
            .finally(() => {
              setProgress((p) => { const { [name]: _omit, ...rest } = p; return rest; });
            });
        });
        const fileResults = await Promise.allSettled(uploads);
        fileResults.forEach((result, i) => {
          if (result.status === 'rejected') {
            const name = Array.from(pendingFiles.current.keys())[i] ?? 'unknown file';
            const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
            errs.push(`File "${name}": ${message}`);
          }
        });
        qc.invalidateQueries({ queryKey: ['sources', vaultProjectId] });
        qc.invalidateQueries({ queryKey: ['source-tags', vaultProjectId] });
      }
      if (errs.length > 0) {
        setUploadErrors(errs);
      } else {
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const ids = rows.map((r) => r.id);
  const isChecked = (id: string) => sel.has(id);
  const allSel = ids.length > 0 && ids.every((id) => sel.has(id));
  const effectiveIds = ids.filter((id) => sel.has(id));
  const effectiveIdSet = new Set(effectiveIds);
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleAll = () => setSel(allSel ? new Set() : new Set(ids));
  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...p } : r));
  const bulk = (p: Partial<Row>) => setRows((rs) => rs.map((r) => effectiveIdSet.has(r.id) ? { ...r, ...p } : r));
  const removeRow = (id: string) => { setRows((rs) => rs.filter((r) => r.id !== id)); setSel((s) => { const n = new Set(s); n.delete(id); return n; }); };
  const removeSel = () => { setRows((rs) => rs.filter((r) => !effectiveIdSet.has(r.id))); setSel(new Set()); };

  const vaults = selectedVaultName ? [selectedVaultName] : [];
  const selCount = effectiveIds.length;
  const progressEntries = Object.entries(progress);

  return (
    <Modal
      onClose={onClose}
      width={880}
      icon="download"
      title="Ingest sources"
      footer={
        <Fragment>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{rows.length} item{rows.length === 1 ? '' : 's'} → <b style={{ color: 'var(--fg)' }}>{vaults.length}</b> vault{vaults.length === 1 ? '' : 's'}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={ingBtnGhost()}>Cancel</button>
            <button onClick={onIngest} disabled={submitting || rows.length === 0} style={{ ...ingBtnPrimary(), opacity: (rows.length && !submitting) ? 1 : 0.5, cursor: submitting ? 'wait' : 'pointer' }}><Icon name="download" size={14} color="#fff" /> {submitting ? 'Ingesting…' : `Ingest${rows.length ? ` ${rows.length}` : ''}`}</button>
          </span>
        </Fragment>
      }
    >
      {/* hidden file input — inside the panel; stop click bubbling to backdrop */}
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
        onClick={(e) => e.stopPropagation()}
        onChange={onFileInputChange} />

      {/* Vault selector — single vault for the whole session */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', fontWeight: 500 }}>Vault</span>
        <ProjectPicker
          value={selectedVaultName}
          onPick={setSelectedVaultName}
          options={vaultOptions}
          loading={vaultsLoading}
        />
        <button
          onClick={() => setManageTagsOpen(true)}
          style={{ ...ingBtnGhost(), marginLeft: 'auto' }}
        >
          <Icon name="hash" size={14} /> Manage Tags
        </button>
      </div>

      {/* combined add area — files + URL */}
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
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addUrl(); }} placeholder="https://…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }} />
          </div>
          <button onClick={addUrl} style={ingBtnGhost()}><Icon name="plus" size={14} /> Add link</button>
        </div>
      </div>

      {/* queue */}
      <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)' }}>
        <IngestQueueBar total={rows.length} selCount={selCount} allSel={allSel} onToggleAll={toggleAll} onBulk={bulk} onClearSel={() => setSel(new Set())} onRemoveSel={removeSel} tagOptions={projectTags} />
        <div>
          {rows.map((r) => <IngestRow key={r.id} r={r} selected={isChecked(r.id)} onToggle={() => toggle(r.id)} onChange={(p) => patch(r.id, p)} onRemove={() => removeRow(r.id)} tagOptions={projectTags} />)}
          {!rows.length && <div style={{ textAlign: 'center', color: 'var(--fg-faint)', padding: '26px 0', fontSize: 12.5 }}>Nothing queued — drop files or paste a link above.</div>}
        </div>
      </div>

      {/* access management */}
      {vaults.length > 0 && (
        <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: 0 }}>
            <Icon name="shield" size={16} color="var(--accent)" />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Vault access</span>
            <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{vaults.length} vault{vaults.length > 1 ? 's' : ''}</span>
          </div>
          <VaultAccess vaults={vaults} projectIdByName={projectIdByName} workspaceId={workspaceId} />
        </div>
      )}
      {uploadErrors.length > 0 && (
        <div role="alert" style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--destructive-soft)', border: '1px solid var(--border)', color: 'var(--destructive)', fontSize: 12.5 }}>
          <b>{uploadErrors.length} error{uploadErrors.length > 1 ? 's' : ''}:</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {uploadErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          <button onClick={() => setUploadErrors([])} style={{ marginTop: 8, border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--ui-font)', padding: 0 }}>Dismiss</button>
        </div>
      )}
      {ollamaWarning && (
        <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'var(--warning-soft)', border: '1px solid var(--border)', color: 'var(--warning)', fontSize: 12.5, lineHeight: 1.45 }}>
          <Icon name="alert" size={14} color="var(--warning)" style={{ marginTop: 1, flexShrink: 0 }} />
          <span>Ollama is not running. Wiki mode requires a local LLM. Start Ollama with <code style={{ fontFamily: 'var(--mono-font)', color: 'var(--fg)' }}>ollama serve</code> before ingesting.</span>
        </div>
      )}
      {manageTagsOpen && (
        <ManageTagsOverlay
          open={manageTagsOpen}
          onClose={() => setManageTagsOpen(false)}
          projectId={vaultProjectId}
        />
      )}
    </Modal>
  );
}
