/*
 * OrgPeopleSection — Organization → People page.
 */
import { useMemo, useState, useRef } from 'react';
import { useQueries } from '@tanstack/react-query';
import { SCard } from '@/components/settings/SettingsCard';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { Popover, ModalOverlay } from '@/components/ui/Popover';
import { RowMenu } from '@/components/ui/RowMenu';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import { formatLastSeen, presenceFromLastSeen } from '@/lib/lastSeen';
import { useMe } from '@/hooks/me';
import { useWorkspacesOverview } from '@/hooks/useWorkspaces';
import { useTenantUsers, useInviteUser } from '@/hooks/people';
import { useAddMember, useRemoveMember, useSetMemberRole } from '@/hooks/members';
import {
  useAddGroupMember,
  useCreateGroup,
  useDeleteGroup,
  useGroups,
  useRemoveGroupMember,
  useRemoveGroupWorkspaceRole,
  useSetGroupWorkspaceRole,
} from '@/hooks/groups';
import { useGuests, useInviteGuest } from '@/hooks/guests';
import { useAddGuest, useRemoveGuest, useSetGuestRole } from '@/hooks/access';
import type { UserAccess } from '@/lib/types';

// ─── Types ───────────────────────────────────────────────────────────────────

type Presence = 'active' | 'offline';
type WsRole = 'Admin' | 'Member';
type VaultLevel = 'Editor' | 'Viewer';
type TopRole = 'Owner' | 'Admin' | 'Member';

interface WsAccess { w: string; role: WsRole }
interface VaultAccess { v: string; level: VaultLevel }

interface OrgMember {
  u: string;
  userId: string;
  you?: boolean;
  owner?: boolean;
  status?: 'invited';
  presence: Presence;
  last: string;
  ws: WsAccess[];
}

interface Group {
  id: string;
  name: string;
  ws: WsAccess[];
  members: string[];
}

interface Guest {
  u: string;
  userId: string;
  name: string;
  presence: Presence;
  vaults: VaultAccess[];
}

interface SelectOption {
  id: string;
  label: string;
  icon?: IconName;
  desc?: string;
  danger?: boolean;
  divider?: boolean;
}

interface DialogState {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm?: () => void;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const PEOPLE_DIR: Record<string, { name: string; email: string }> = {
  alice: { name: 'Alice Chen',   email: 'alice@brain2.dev' },
  bob:   { name: 'Bob Soto',     email: 'bob@brain2.dev'   },
  grace: { name: 'Grace Kim',    email: 'grace@brain2.dev' },
  carol: { name: 'Carol Park',   email: 'carol@brain2.dev' },
  eve:   { name: 'Eve Okafor',   email: 'eve@brain2.dev'   },
  frank: { name: 'Frank Wu',     email: 'frank@brain2.dev' },
  henry: { name: 'Henry Lam',    email: 'henry@brain2.dev' },
  dan:   { name: 'Dan Peters',   email: 'dan@brain2.dev'   },
};

const EXTRA_CANDIDATES: Array<{ u: string; name: string; email: string }> = [
  { u: 'priya', name: 'Priya Nair', email: 'priya@brain2.dev' },
  { u: 'sam',   name: 'Sam Woo',    email: 'sam@brain2.dev'   },
];

const WS_LABELS: Record<string, string> = {
  default:      'default',
  'research-q3': 'research-q3',
  engineering:  'engineering',
  personal:     'personal',
};
const WS_LIST = Object.keys(WS_LABELS);

const VAULT_LIST = ['Cell biology', 'Microscopy', 'Q3 research', 'Engineering docs'];

const ROLE_RANK: Record<TopRole, number> = { Owner: 3, Admin: 2, Member: 1 };

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ u, size = 36 }: { u: string; size?: number }) {
  const p = PEOPLE_DIR[u] ?? { name: u };
  const initials = p.name[0].toUpperCase();
  const hue = p.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: `oklch(0.28 0.07 ${hue})`,
      color: `oklch(0.85 0.10 ${hue})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
      fontFamily: 'var(--display-font)',
    }}>
      {initials}
    </span>
  );
}

// ─── PresenceAvatar ───────────────────────────────────────────────────────────

function PresenceAvatar({ u, size = 36, presence }: { u: string; size?: number; presence: Presence }) {
  const tone = presence === 'active' ? 'var(--success)' : null;
  const dotSize = Math.round(size * 0.3);
  return (
    <span style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }}>
      <Avatar u={u} size={size} />
      {tone && (
        <span style={{
          position: 'absolute', right: -1, bottom: -1,
          width: dotSize, height: dotSize, borderRadius: '50%',
          background: tone, border: '2px solid var(--surface)',
        }} />
      )}
    </span>
  );
}

// ─── GuestAvatar (for guests who don't have a PEOPLE_DIR entry) ──────────────

function GuestAvatar({ name, size = 36, presence }: { name: string; size?: number; presence: Presence }) {
  const initials = name[0]?.toUpperCase() ?? '?';
  const hue = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const tone = presence === 'active' ? 'var(--success)' : null;
  const dotSize = Math.round(size * 0.3);
  return (
    <span style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }}>
      <span style={{
        width: size, height: size, borderRadius: '50%',
        background: `oklch(0.28 0.07 ${hue})`,
        color: `oklch(0.85 0.10 ${hue})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.38, fontWeight: 700,
        fontFamily: 'var(--display-font)',
      }}>
        {initials}
      </span>
      {tone && (
        <span style={{
          position: 'absolute', right: -1, bottom: -1,
          width: dotSize, height: dotSize, borderRadius: '50%',
          background: tone, border: '2px solid var(--surface)',
        }} />
      )}
    </span>
  );
}

// ─── Role badge (local — supports Member) ────────────────────────────────────

const ROLE_COLOR: Record<string, string> = {
  Owner: 'var(--accent)', Admin: 'var(--accent)', Member: 'var(--fg-muted)',
  Editor: 'var(--success)', Viewer: 'var(--fg-muted)',
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color: ROLE_COLOR[role] ?? 'var(--fg-muted)',
      background: 'var(--surface-2)', borderRadius: 6, padding: '2px 8px', flexShrink: 0,
    }}>
      {role}
    </span>
  );
}

// ─── MiniSelect — role dropdown inside expanded rows ─────────────────────────

const WS_ROLE_OPTS: SelectOption[] = [
  { id: 'Admin',  label: 'Admin',  icon: 'shield', desc: 'Manage members and every vault in this workspace.' },
  { id: 'Member', label: 'Member', icon: 'user',   desc: 'Read and write all vaults in this workspace.' },
  { id: '__remove', label: 'Remove from workspace', icon: 'trash', danger: true, divider: true },
];

function MiniSelect({ value, options, onPick, width = 220 }: {
  value: string;
  options: SelectOption[];
  onPick: (v: string) => void;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
      <button
        ref={ref}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 30, padding: '0 10px', borderRadius: 7,
          border: `1px solid ${open ? 'var(--border-strong)' : 'var(--border)'}`,
          background: open ? 'var(--surface-2)' : 'transparent',
          color: 'var(--fg)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
          fontFamily: 'var(--ui-font)', whiteSpace: 'nowrap',
        }}
      >
        <Icon name="shield" size={13} color="var(--fg-muted)" />
        {value}
        <Icon name="chevDown" size={13} color="var(--fg-muted)" />
      </button>
      {open && (
        <Popover
          anchorRef={ref as React.RefObject<HTMLElement | null>}
          onClose={() => setOpen(false)}
          placement="bottom-end"
          style={{ width, padding: 6 }}
        >
          {options.map((opt) => (
            <div key={opt.id}>
              {opt.divider && <div style={{ height: 1, background: 'var(--border)', margin: '5px 6px' }} />}
              <button
                onClick={() => { onPick(opt.id); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 9, width: '100%', padding: '8px 9px',
                  border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  background: 'transparent', fontFamily: 'var(--ui-font)',
                  color: opt.danger ? 'var(--destructive)' : 'var(--fg)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                {opt.icon && <Icon name={opt.icon} size={14} color={opt.danger ? 'var(--destructive)' : 'var(--fg-muted)'} style={{ marginTop: 1, flexShrink: 0 }} />}
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500 }}>{opt.label}</span>
                  {opt.desc && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', marginTop: 1, lineHeight: 1.4 }}>{opt.desc}</span>}
                </span>
              </button>
            </div>
          ))}
        </Popover>
      )}
    </span>
  );
}

// ─── LevelSelect — labeled option picker used in invite / scope bars ──────────

function LevelSelect({ value, options, onPick, width = 160 }: {
  value: string;
  options: SelectOption[];
  onPick: (v: string) => void;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const opt = options.find((o) => o.id === value) ?? options[0];

  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
      <button
        ref={ref}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 38, padding: '0 12px', borderRadius: 9,
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
          background: open ? 'var(--surface-2)' : 'var(--bg)',
          color: 'var(--fg)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          fontFamily: 'var(--ui-font)', whiteSpace: 'nowrap',
          boxShadow: open ? '0 0 0 3px var(--accent-soft)' : 'none',
          transition: 'border-color .12s, box-shadow .12s',
        }}
      >
        {opt?.icon && <Icon name={opt.icon} size={14} color="var(--fg-muted)" />}
        {opt?.label ?? value}
        <Icon name="chevDown" size={13} color="var(--fg-muted)" />
      </button>
      {open && (
        <Popover
          anchorRef={ref as React.RefObject<HTMLElement | null>}
          onClose={() => setOpen(false)}
          placement="bottom-start"
          style={{ width, padding: 6 }}
        >
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => { onPick(o.id); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 9px',
                border: 'none', borderRadius: 8, cursor: 'pointer',
                background: o.id === value ? 'var(--accent-soft)' : 'transparent',
                fontFamily: 'var(--ui-font)',
              }}
              onMouseEnter={(e) => { if (o.id !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
              onMouseLeave={(e) => { if (o.id !== value) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              {o.icon && <Icon name={o.icon} size={14} color={o.id === value ? 'var(--accent)' : 'var(--fg-muted)'} />}
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: o.id === value ? 'var(--accent)' : 'var(--fg)', textAlign: 'left' }}>
                {o.label}
              </span>
              {o.id === value && <Icon name="check" size={14} color="var(--accent)" />}
            </button>
          ))}
        </Popover>
      )}
    </span>
  );
}

// ─── EmailSuggest ─────────────────────────────────────────────────────────────

function EmailSuggest({ value, onChange, candidates, onEnter, placeholder = 'Enter email or name…' }: {
  value: string;
  onChange: (v: string) => void;
  candidates: Array<{ u: string; name: string; email: string }>;
  onEnter?: () => void;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const q = value.trim().toLowerCase();
  const matches = (
    q ? candidates.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      : candidates
  ).slice(0, 6);
  const open = focused && matches.length > 0;

  const pick = (c: typeof candidates[0]) => { onChange(c.email); setFocused(false); setActiveIdx(0); };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        value={value}
        type="email"
        placeholder={placeholder}
        style={{
          width: '100%', height: 38, padding: '0 34px 0 12px', borderRadius: 9, boxSizing: 'border-box',
          border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
          background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5,
          outline: 'none', boxShadow: focused ? '0 0 0 3px var(--accent-soft)' : 'none',
          transition: 'border-color .12s, box-shadow .12s',
        }}
        onChange={(e) => { onChange(e.target.value); setActiveIdx(0); }}
        onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setFocused(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setFocused(false), 130); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(true); setActiveIdx((i) => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (open && matches[activeIdx]) pick(matches[activeIdx]); else onEnter?.(); }
          else if (e.key === 'Escape') setFocused(false);
        }}
      />
      <span style={{ position: 'absolute', right: 11, top: 11, pointerEvents: 'none' }}>
        <Icon name="search" size={15} color="var(--fg-faint)" />
      </span>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50,
          background: 'var(--surface)', border: '1px solid var(--border-strong)',
          borderRadius: 11, boxShadow: '0 18px 50px rgba(0,0,0,0.4)', overflow: 'hidden', padding: 5,
        }}>
          {matches.map((c, i) => (
            <button
              key={c.u}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 8px',
                border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                background: activeIdx === i ? 'var(--surface-2)' : 'transparent',
                fontFamily: 'var(--ui-font)',
              }}
            >
              <Avatar u={c.u} size={28} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{c.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)' }}>{c.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── WsRoleEditor — per-workspace role list (shared by people + groups) ───────

const WS_OPTS: SelectOption[] = WS_LIST.map((w) => ({ id: w, label: WS_LABELS[w] ?? w, icon: 'layers' as IconName }));
const WS_ROLE_LEVEL_OPTS: SelectOption[] = [
  { id: 'Admin',  label: 'Admin',  icon: 'shield' },
  { id: 'Member', label: 'Member', icon: 'user'   },
];

function AddScopeRow({ label, taken, allOpts, levelOpts, defaultLevel, onAdd }: {
  label: string;
  taken: string[];
  allOpts: SelectOption[];
  levelOpts: SelectOption[];
  defaultLevel: string;
  onAdd: (scope: string, level: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const avail = allOpts.filter((o) => !taken.includes(o.id));
  const [scope, setScope] = useState(avail[0]?.id ?? '');
  const [level, setLevel] = useState(defaultLevel);

  if (!avail.length) return null;

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, height: 32,
        padding: '0 13px', borderRadius: 8, border: '1px solid var(--border)',
        background: 'transparent', color: 'var(--fg)', cursor: 'pointer',
        fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600,
      }}
    >
      <Icon name="plus" size={13} /> {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      <LevelSelect value={scope} options={avail} onPick={setScope} width={180} />
      <LevelSelect value={level} options={levelOpts} onPick={setLevel} width={150} />
      <button onClick={() => { onAdd(scope, level); setOpen(false); }} style={{ display: 'inline-flex', alignItems: 'center', height: 38, padding: '0 13px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600 }}>Add</button>
      <button onClick={() => setOpen(false)} style={{ display: 'inline-flex', alignItems: 'center', height: 38, padding: '0 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg)', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600 }}>Cancel</button>
    </div>
  );
}

function WsRoleEditor({ ws, inherited = [], setRole, removeWs, addWs, emptyText = 'Not in any workspace yet.' }: {
  ws: WsAccess[];
  inherited?: Array<{ w: string; role: WsRole; via: string }>;
  setRole: (w: string, role: WsRole) => void;
  removeWs: (w: string) => void;
  addWs?: (w: string, role: WsRole) => void;
  emptyText?: string;
}) {
  const wsIcon: React.CSSProperties = { width: 24, height: 24, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)', flexShrink: 0 };

  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 8 }}>
        Workspace roles
      </div>
      {(ws.length > 0 || inherited.length > 0) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {ws.map((x) => (
            <div key={x.w} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <span style={wsIcon}><Icon name="layers" size={13} /></span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{WS_LABELS[x.w] ?? x.w}</span>
              <MiniSelect
                value={x.role}
                options={WS_ROLE_OPTS}
                onPick={(v) => { if (v === '__remove') removeWs(x.w); else setRole(x.w, v as WsRole); }}
                width={220}
              />
            </div>
          ))}
          {inherited.map((x, i) => (
            <div key={`inh-${x.w}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <span style={{ ...wsIcon, color: 'var(--fg-faint)' }}><Icon name="layers" size={13} /></span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{WS_LABELS[x.w] ?? x.w}</span>
                <span title={`Granted via the ${x.via} group`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 5, color: 'var(--fg-muted)', background: 'var(--surface-2)' }}>
                  <Icon name="users" size={10} color="var(--fg-muted)" /> {x.via}
                </span>
              </span>
              <span title="Granted by a group — change it from the Groups tab" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg-muted)', fontSize: 12, fontWeight: 500, flexShrink: 0 }}>
                <Icon name="lock" size={12} color="var(--fg-faint)" /> {x.role}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--fg-faint)' }}>{emptyText}</div>
      )}
      {addWs && (
        <AddScopeRow
          label="Add to workspace"
          taken={ws.map((x) => x.w)}
          allOpts={WS_OPTS}
          levelOpts={WS_ROLE_LEVEL_OPTS}
          defaultLevel="Member"
          onAdd={(w, role) => addWs(w, role as WsRole)}
        />
      )}
    </>
  );
}

// ─── ConfirmDialog ────────────────────────────────────────────────────────────

function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose }: DialogState & { onClose: () => void }) {
  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ width: 420, maxWidth: '100vw', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 16, boxShadow: '0 28px 80px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface-2)', color: danger ? 'var(--destructive)' : 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={danger ? 'shield' : 'key'} size={19} />
            </span>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--display-font)' }}>{title}</div>
          </div>
          <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.55 }}>{body}</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '18px 20px' }}>
          <button onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg)', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600 }}>
            {onConfirm ? 'Cancel' : 'OK'}
          </button>
          {onConfirm && (
            <button onClick={() => { onConfirm(); onClose(); }} style={{ display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 13px', borderRadius: 8, border: 'none', background: danger ? 'var(--destructive)' : 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600 }}>
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

// ─── GroupsPanel ──────────────────────────────────────────────────────────────

function GroupsPanel({ groups, members, setDialog, onCreateGroup, onSetWsRole, onRemoveWs, onAddWs, onAddMember, onRemoveMember, onRemoveGroup }: {
  groups: Group[];
  members: OrgMember[];
  setDialog: (d: DialogState) => void;
  onCreateGroup: (name: string) => void;
  onSetWsRole: (id: string, w: string, role: WsRole) => void;
  onRemoveWs: (id: string, w: string) => void;
  onAddWs: (id: string, w: string, role: WsRole) => void;
  onAddMember: (id: string, userId: string) => void;
  onRemoveMember: (id: string, userId: string) => void;
  onRemoveGroup: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(groups.length ? [groups[0].id] : []));
  const [addPerson, setAddPerson] = useState<Record<string, string>>({});

  const toggleExp = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const nm = name.trim();
  const dupName = groups.some((g) => g.name.toLowerCase() === nm.toLowerCase());

  const create = () => {
    if (!nm || dupName) return;
    onCreateGroup(nm);
    setName('');
  };

  const addMember = (id: string, email: string) => {
    const member = members.find((m) => (PEOPLE_DIR[m.u]?.email ?? m.u) === email);
    if (!member) return;
    onAddMember(id, member.userId);
    setAddPerson((p) => ({ ...p, [id]: '' }));
  };
  const removeGroup = (g: Group) => setDialog({ title: `Delete "${g.name}"?`, danger: true, confirmLabel: 'Delete group', body: `The ${g.members.length} ${g.members.length === 1 ? 'person' : 'people'} in this group lose the workspace access it granted. Their own direct roles are unchanged.`, onConfirm: () => onRemoveGroup(g.id) });

  const groupTop = (g: Group): TopRole => g.ws.some((x) => x.role === 'Admin') ? 'Admin' : 'Member';

  const createInput: React.CSSProperties = { flex: 1, minWidth: 0, height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' };

  return (
    <SCard title="Groups" desc="Bundle people together and grant workspace access once. Every role you set on a group applies to everyone in it — and a group can be admin of one workspace and member of another, just like a person.">
      {/* create bar */}
      <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--accent-line, var(--accent))', background: 'var(--accent-soft)', marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>Create a group</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <input
            value={name}
            placeholder="Group name — e.g. Research team"
            style={createInput}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          />
          <button
            onClick={create}
            disabled={!nm || dupName}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 38, padding: '0 13px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: (nm && !dupName) ? 'pointer' : 'not-allowed', opacity: (nm && !dupName) ? 1 : 0.5, fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}
          >
            <Icon name="plus" size={14} color="#fff" /> Create group
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 8 }}>New groups start with no workspace access — expand the group to grant it.</div>
        {dupName && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>A group with that name already exists.</div>}
      </div>

      {/* group rows */}
      <div>
        {groups.map((g, i) => {
          const open = expanded.has(g.id);
          const last = i === groups.length - 1;
          const personCandidates = members
            .filter((m) => !g.members.includes(m.userId) && !m.owner)
            .map((m) => ({ u: m.u, name: PEOPLE_DIR[m.u]?.name ?? m.u, email: PEOPLE_DIR[m.u]?.email ?? m.u }));

          return (
            <div key={g.id} style={{ borderBottom: last && !open ? 'none' : '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', cursor: 'pointer' }} onClick={() => toggleExp(g.id)}>
                <Icon name="chevRight" size={14} color="var(--fg-faint)" style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="users" size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{g.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{g.members.length} {g.members.length === 1 ? 'person' : 'people'}</div>
                </div>
                <div className="b2-hide-sm" style={{ width: 150, flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
                    {g.ws.length > 0
                      ? <><Icon name="layers" size={12} color="var(--fg-muted)" /><span>{g.ws.length} workspace{g.ws.length === 1 ? '' : 's'}</span></>
                      : <span style={{ color: 'var(--fg-faint)' }}>No access yet</span>}
                  </div>
                </div>
                <RoleBadge role={groupTop(g)} />
                <RowMenu items={[{ label: 'Delete group', icon: 'trash', danger: true, onClick: () => removeGroup(g) }]} />
              </div>

              {open && (
                <div style={{ padding: '4px 0 16px 60px' }}>
                  <WsRoleEditor
                    ws={g.ws}
                    setRole={(w, v) => onSetWsRole(g.id, w, v)}
                    removeWs={(w) => onRemoveWs(g.id, w)}
                    addWs={(w, role) => onAddWs(g.id, w, role)}
                    emptyText="No workspace access yet — add one below."
                  />
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)', margin: '18px 0 8px' }}>Members · {g.members.length}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 12px', fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                    <Icon name="shield" size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                    <span>Everyone below inherits the roles above. They show on each person's row, locked.</span>
                  </div>
                  {/* add person bar */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <EmailSuggest
                      value={addPerson[g.id] ?? ''}
                      onChange={(v) => setAddPerson((p) => ({ ...p, [g.id]: v }))}
                      candidates={personCandidates}
                      onEnter={() => addMember(g.id, addPerson[g.id] ?? '')}
                      placeholder="Add a person to this group"
                    />
                    <button
                      onClick={() => addMember(g.id, addPerson[g.id] ?? '')}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', flexShrink: 0, fontSize: 20 }}
                    >
                      <Icon name="plus" size={16} color="#fff" />
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {g.members.map((u) => {
                      const p = PEOPLE_DIR[u] ?? { name: u, email: u };
                      return (
                        <div key={u} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                          <Avatar u={u} size={30} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{p.name}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</div>
                          </div>
                          <button onClick={() => onRemoveMember(g.id, u)} title="Remove from group" style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="x" size={13} color="var(--fg-muted)" />
                          </button>
                        </div>
                      );
                    })}
                    {g.members.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '8px 0' }}>No one in this group yet — add someone above.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && (
          <div style={{ padding: '28px 10px', textAlign: 'center', fontSize: 13, color: 'var(--fg-faint)' }}>No groups yet. Create one above to grant access in bulk.</div>
        )}
      </div>
    </SCard>
  );
}

// ─── GuestsPanel ──────────────────────────────────────────────────────────────

const GUEST_LEVEL_OPTS: SelectOption[] = [
  { id: 'Editor', label: 'Editor', icon: 'pencil', desc: 'Read and write the vaults they are added to.' },
  { id: 'Viewer', label: 'Viewer', icon: 'file',   desc: 'Read-only access to specific vaults.' },
  { id: '__remove', label: 'Remove vault', icon: 'trash', danger: true, divider: true },
];

function GuestsPanel({ guests, vaultOptions, setDialog, onInvite, onSetVaultLevel, onRemoveVault, onAddVault, onRemoveGuest }: {
  guests: Guest[];
  vaultOptions: SelectOption[];
  setDialog: (d: DialogState) => void;
  onInvite: (email: string, projectId: string, level: VaultLevel) => void;
  onSetVaultLevel: (userId: string, projectId: string, level: VaultLevel) => void;
  onRemoveVault: (userId: string, projectId: string) => void;
  onAddVault: (userId: string, projectId: string, level: VaultLevel) => void;
  onRemoveGuest: (guest: Guest) => void;
}) {
  const [email, setEmail] = useState('');
  const [vault, setVault] = useState(vaultOptions[0]?.id ?? '');
  const [level, setLevel] = useState<VaultLevel>('Viewer');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(guests.length ? [guests[0].u] : []));
  const effectiveVault = vault || vaultOptions[0]?.id || '';

  const toggleExp = (u: string) => setExpanded((s) => { const n = new Set(s); n.has(u) ? n.delete(u) : n.add(u); return n; });
  const addr = email.trim();
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr);
  const exists = guests.some((g) => g.u.toLowerCase() === addr.toLowerCase());
  const guestCandidates = EXTRA_CANDIDATES.filter((c) => !guests.some((g) => g.u.toLowerCase() === c.email.toLowerCase()));

  const invite = () => {
    if (!validEmail || exists) return;
    onInvite(addr, effectiveVault, level);
    setExpanded((s) => new Set([...s, addr]));
    setEmail(''); setVault(vaultOptions[0]?.id ?? ''); setLevel('Viewer');
  };

  const removeGuest = (g: Guest) => setDialog({ title: `Remove ${g.name}?`, danger: true, confirmLabel: 'Remove guest', body: 'They lose access to every vault shared with them. Your content stays.', onConfirm: () => onRemoveGuest(g) });

  return (
    <SCard title="Guests" desc="External collaborators with access to specific vaults only — never a whole workspace. Grant Editor or Viewer per vault.">
      {/* invite bar */}
      <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--accent-line, var(--accent))', background: 'var(--accent-soft)', marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>Invite a guest</div>
        <EmailSuggest value={email} onChange={setEmail} candidates={guestCandidates} onEnter={invite} placeholder="Enter email or name…" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Share</span>
          <LevelSelect value={effectiveVault} options={vaultOptions} onPick={setVault} width={180} />
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>as</span>
          <LevelSelect value={level} options={GUEST_LEVEL_OPTS.filter((o) => !o.danger)} onPick={(v) => setLevel(v as VaultLevel)} width={150} />
          <button onClick={invite} disabled={!validEmail || exists || !effectiveVault} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 38, padding: '0 13px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: (validEmail && !exists && effectiveVault) ? 'pointer' : 'not-allowed', opacity: (validEmail && !exists && effectiveVault) ? 1 : 0.5, fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, marginLeft: 'auto' }}>
            <Icon name="plus" size={14} color="#fff" /> Invite guest
          </button>
        </div>
        {addr && !validEmail && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>Enter a valid email address.</div>}
        {exists && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>That guest already has access.</div>}
      </div>

      {/* guest list */}
      <div>
        {guests.map((g, i) => {
          const open = expanded.has(g.u);
          const last = i === guests.length - 1;
          const topLevel = g.vaults.some((x) => x.level === 'Editor') ? 'Editor' : 'Viewer';
          const taken = g.vaults.map((x) => x.v);
          return (
            <div key={g.u} style={{ borderBottom: last && !open ? 'none' : '1px solid var(--border)' }}>
              <div onClick={() => toggleExp(g.u)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', cursor: 'pointer' }}>
                <Icon name="chevRight" size={14} color="var(--fg-faint)" style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                <GuestAvatar name={g.name} size={36} presence={g.presence} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>
                    {g.name}
                    <span style={{ fontSize: 10, color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 5, padding: '1px 6px' }}>guest</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.u}</div>
                </div>
                <div className="b2-hide-sm" style={{ width: 150, flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
                    {g.vaults.length > 0
                      ? <><Icon name="folder" size={12} color="var(--fg-muted)" /><span>{g.vaults.length} vault{g.vaults.length === 1 ? '' : 's'}</span></>
                      : <span style={{ color: 'var(--fg-faint)' }}>No vaults yet</span>}
                  </div>
                </div>
                <RoleBadge role={topLevel} />
                <RowMenu items={[{ label: 'Remove guest', icon: 'trash', danger: true, onClick: () => removeGuest(g) }]} />
              </div>
              {open && (
                <div style={{ padding: '4px 0 16px 60px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 8 }}>Vault access</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {g.vaults.map((x) => (
                      <div key={x.v} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                        <span style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)', flexShrink: 0 }}><Icon name="folder" size={13} /></span>
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{vaultOptions.find((o) => o.id === x.v)?.label ?? x.v}</span>
                        <MiniSelect
                          value={x.level}
                          options={GUEST_LEVEL_OPTS}
                          onPick={(v) => { if (v === '__remove') onRemoveVault(g.userId, x.v); else onSetVaultLevel(g.userId, x.v, v as VaultLevel); }}
                          width={200}
                        />
                      </div>
                    ))}
                    {g.vaults.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--fg-faint)' }}>No vaults shared yet.</div>}
                  </div>
                  <AddScopeRow
                    label="Share a vault"
                    taken={taken}
                    allOpts={vaultOptions}
                    levelOpts={GUEST_LEVEL_OPTS.filter((o) => !o.danger)}
                    defaultLevel="Viewer"
                    onAdd={(v, lvl) => onAddVault(g.userId, v, lvl as VaultLevel)}
                  />
                </div>
              )}
            </div>
          );
        })}
        {guests.length === 0 && (
          <div style={{ padding: '28px 10px', textAlign: 'center', fontSize: 13, color: 'var(--fg-faint)' }}>No guests yet. Invite one above to share a vault.</div>
        )}
      </div>
    </SCard>
  );
}

// ─── OrgPeopleSection — main export ──────────────────────────────────────────

const toWsRole = (role: string): WsRole => role === 'admin' ? 'Admin' : 'Member';
const fromWsRole = (role: WsRole): 'admin' | 'member' => role === 'Admin' ? 'admin' : 'member';
const toVaultLevel = (role: string): VaultLevel => role === 'editor' || role === 'admin' ? 'Editor' : 'Viewer';
const fromVaultLevel = (level: VaultLevel): 'viewer' | 'editor' => level === 'Editor' ? 'editor' : 'viewer';

export function OrgPeopleSection() {
  const [view, setView] = useState<'people' | 'groups' | 'guests'>('people');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'owner' | 'admin' | 'member'>('all');
  const [email, setEmail] = useState('');
  const [inviteWs, setInviteWs] = useState('');
  const [inviteRole, setInviteRole] = useState<WsRole>('Member');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const me = useMe().data;
  const { data: users = [] } = useTenantUsers();
  const { data: overview } = useWorkspacesOverview();
  const { data: groupRows = [] } = useGroups();
  const { data: guestRows = [] } = useGuests();
  const inviteUser = useInviteUser();
  const addMember = useAddMember(null);
  const setMemberRole = useSetMemberRole(null);
  const removeMember = useRemoveMember(null);
  const createGroup = useCreateGroup();
  const addGroupMember = useAddGroupMember();
  const removeGroupMember = useRemoveGroupMember();
  const setGroupWs = useSetGroupWorkspaceRole();
  const removeGroupWs = useRemoveGroupWorkspaceRole();
  const deleteGroup = useDeleteGroup();
  const inviteGuest = useInviteGuest();
  const addGuestAccess = useAddGuest(null);
  const setGuestRole = useSetGuestRole(null);
  const removeGuestAccess = useRemoveGuest(null);

  const workspaceRows = overview?.workspaces ?? [];
  const vaultRows = workspaceRows.flatMap((ws) => ws.vaults);
  const effectiveInviteWs = inviteWs || workspaceRows[0]?.workspace_id || '';

  workspaceRows.forEach((ws) => { WS_LABELS[ws.workspace_id] = ws.name; });
  WS_LIST.splice(0, WS_LIST.length, ...workspaceRows.map((ws) => ws.workspace_id));
  VAULT_LIST.splice(0, VAULT_LIST.length, ...vaultRows.map((v) => v.name));

  const accessQueries = useQueries({
    queries: users.map((u) => ({
      queryKey: qk.userAccess(u.user_id),
      queryFn: () => ops<UserAccess>('access:for_user', { user_id: u.user_id }),
      staleTime: 30_000,
    })),
  });
  const accessByUser = new Map<string, UserAccess>();
  users.forEach((u, i) => {
    const data = accessQueries[i]?.data;
    if (data) accessByUser.set(u.user_id, data);
  });

  users.forEach((u) => {
    PEOPLE_DIR[u.user_id] = {
      name: u.display_name || u.email,
      email: u.email,
    };
  });
  guestRows.forEach((g) => {
    PEOPLE_DIR[g.user_id] = {
      name: g.display_name || g.email || g.user_id,
      email: g.email || g.user_id,
    };
  });

  const groups = useMemo<Group[]>(() => groupRows.map((g) => ({
    id: g.group_id,
    name: g.name,
    ws: g.workspace_roles.map((r) => ({ w: r.workspace_id, role: toWsRole(r.role) })),
    members: g.members.map((m) => m.user_id),
  })), [groupRows]);

  const inheritedByUser = useMemo(() => {
    const map = new Map<string, Array<{ w: string; role: WsRole; via: string }>>();
    users.forEach((u) => {
      const access = accessByUser.get(u.user_id);
      map.set(u.user_id, (access?.inherited_workspaces ?? []).map((r) => ({
        w: r.workspace_id,
        role: toWsRole(r.role),
        via: r.via,
      })));
    });
    return map;
  }, [users, accessQueries.map((q) => q.dataUpdatedAt).join('|')]);

  const members = useMemo<OrgMember[]>(() => users.map((u) => {
    const access = accessByUser.get(u.user_id);
    return {
      u: u.user_id,
      userId: u.user_id,
      you: me?.user_id === u.user_id,
      owner: u.role === 'owner',
      status: u.invited ? 'invited' : undefined,
      presence: presenceFromLastSeen(u.last_seen_at),
      last: u.invited ? 'Invited' : formatLastSeen(u.last_seen_at),
      ws: (access?.workspaces ?? []).map((w) => ({ w: w.workspace_id, role: toWsRole(w.role) })),
    };
  }), [users, me?.user_id, accessQueries.map((q) => q.dataUpdatedAt).join('|')]);

  const guests = useMemo<Guest[]>(() => guestRows.map((g) => ({
    u: g.email || g.user_id,
    userId: g.user_id,
    name: g.display_name || g.email || g.user_id,
    presence: presenceFromLastSeen(g.last_seen_at),
    vaults: g.vaults.map((v) => ({ v: v.project_id, level: toVaultLevel(v.role) })),
  })), [guestRows]);

  const dir = (u: string) => PEOPLE_DIR[u] ?? { name: u, email: u };

  const inheritedWs = (u: string) => inheritedByUser.get(u) ?? [];

  const isAdminAnywhere = (m: OrgMember) =>
    !m.owner && (m.ws.some((x) => x.role === 'Admin') || inheritedWs(m.u).some((x) => x.role === 'Admin'));

  const topRole = (m: OrgMember): TopRole =>
    m.owner ? 'Owner' : isAdminAnywhere(m) ? 'Admin' : 'Member';

  const counts = {
    all: members.length,
    owner: members.filter((m) => m.owner).length,
    admin: members.filter(isAdminAnywhere).length,
    member: members.filter((m) => topRole(m) === 'Member').length,
  };

  const q = query.trim().toLowerCase();
  const shown = members.filter((m) => {
    const p = dir(m.u);
    if (filter !== 'all' && topRole(m).toLowerCase() !== filter) return false;
    if (q && !(p.name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => ROLE_RANK[topRole(b)] - ROLE_RANK[topRole(a)]);

  const toggleExp = (u: string) => setExpanded((s) => { const n = new Set(s); n.has(u) ? n.delete(u) : n.add(u); return n; });
  const setWsRole = (u: string, w: string, role: WsRole) =>
    setMemberRole.mutate({ workspace_id: w, user_id: u, role: fromWsRole(role) });
  const removeWs = (u: string, w: string) =>
    removeMember.mutate({ workspace_id: w, user_id: u });
  const addWs = (u: string, w: string, role: WsRole) =>
    addMember.mutate({ workspace_id: w, user_id: u, role: fromWsRole(role) });

  const requestRemove = (m: OrgMember) => {
    if (m.you) { setDialog({ title: "You can't remove yourself", body: 'Ask another owner to remove your account, or step down first.' }); return; }
    if (m.owner) { setDialog({ title: "Can't remove the owner", body: 'Transfer ownership to someone else before removing this person.' }); return; }
    const p = dir(m.u);
    setDialog({ title: `Remove ${p.name}?`, danger: true, confirmLabel: 'Remove', body: 'Remove them from each workspace using the expanded workspace role controls.' });
  };

  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const exists = members.some((m) => (dir(m.u).email ?? '').toLowerCase() === email.trim().toLowerCase());
  const inviteCandidates = EXTRA_CANDIDATES.filter((c) => !members.some((m) => (dir(m.u).email ?? '').toLowerCase() === c.email.toLowerCase()));

  const invite = () => {
    if (!validEmail || exists) return;
    const addr = email.trim();
    inviteUser.mutate({
      email: addr,
      role: 'member',
      workspace_id: effectiveInviteWs || undefined,
      workspace_role: fromWsRole(inviteRole),
    });
    setEmail(''); setInviteWs(workspaceRows[0]?.workspace_id ?? ''); setInviteRole('Member');
  };

  const wsOpts: SelectOption[] = WS_LIST.map((w) => ({ id: w, label: WS_LABELS[w] ?? w, icon: 'layers' as IconName }));
  const wsRoleOpts: SelectOption[] = [
    { id: 'Admin',  label: 'Admin',  icon: 'shield', desc: 'Manage members and every vault in this workspace.' },
    { id: 'Member', label: 'Member', icon: 'user',   desc: 'Read and write all vaults in this workspace.' },
  ];

  const filters: Array<{ id: typeof filter; label: string; n: number }> = [
    { id: 'all',    label: 'All',     n: counts.all    },
    { id: 'owner',  label: 'Owners',  n: counts.owner  },
    { id: 'admin',  label: 'Admins',  n: counts.admin  },
    { id: 'member', label: 'Members', n: counts.member },
  ];

  const tabs = [
    { id: 'people' as const,  label: 'People',  icon: 'user'  as IconName, n: members.length },
    { id: 'groups' as const,  label: 'Groups',  icon: 'users' as IconName, n: groups.length  },
    { id: 'guests' as const,  label: 'Guests',  icon: 'mail'  as IconName, n: guests.length  },
  ];

  const vaultOpts: SelectOption[] = vaultRows.map((v) => ({
    id: v.project_id,
    label: v.name,
    icon: 'folder' as IconName,
  }));

  return (
    <div>
      {/* tab switcher */}
      <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--surface-2)', borderRadius: 10, marginBottom: 18 }}>
        {tabs.map((t) => {
          const on = view === t.id;
          return (
            <button key={t.id} onClick={() => setView(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: on ? 600 : 500, background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: on ? 'var(--shadow-card)' : 'none', transition: 'background var(--duration-fast)' }}>
              <Icon name={t.icon} size={15} color={on ? 'var(--accent)' : 'var(--fg-muted)'} />
              {t.label}
              <span style={{ fontSize: 11, color: on ? 'var(--fg-muted)' : 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{t.n}</span>
            </button>
          );
        })}
      </div>

      {view === 'groups' ? (
        <GroupsPanel
          groups={groups}
          members={members}
          setDialog={setDialog}
          onCreateGroup={(name) => createGroup.mutate({ name })}
          onSetWsRole={(id, w, role) => setGroupWs.mutate({ group_id: id, workspace_id: w, role: fromWsRole(role) })}
          onRemoveWs={(id, w) => removeGroupWs.mutate({ group_id: id, workspace_id: w })}
          onAddWs={(id, w, role) => setGroupWs.mutate({ group_id: id, workspace_id: w, role: fromWsRole(role) })}
          onAddMember={(id, userId) => addGroupMember.mutate({ group_id: id, user_id: userId })}
          onRemoveMember={(id, userId) => removeGroupMember.mutate({ group_id: id, user_id: userId })}
          onRemoveGroup={(id) => deleteGroup.mutate({ group_id: id })}
        />
      ) : view === 'guests' ? (
        <GuestsPanel
          guests={guests}
          vaultOptions={vaultOpts}
          setDialog={setDialog}
          onInvite={(addr, projectId, lvl) => inviteGuest.mutate({
            email: addr,
            project_id: projectId,
            role: fromVaultLevel(lvl),
          })}
          onSetVaultLevel={(userId, projectId, lvl) => setGuestRole.mutate({
            user_id: userId,
            project_id: projectId,
            role: fromVaultLevel(lvl),
          })}
          onRemoveVault={(userId, projectId) => removeGuestAccess.mutate({
            user_id: userId,
            project_id: projectId,
          })}
          onAddVault={(userId, projectId, lvl) => addGuestAccess.mutate({
            user_id: userId,
            project_id: projectId,
            role: fromVaultLevel(lvl),
          })}
          onRemoveGuest={(g) => g.vaults.forEach((v) => removeGuestAccess.mutate({
            user_id: g.userId,
            project_id: v.v,
          }))}
        />
      ) : (
        <SCard
          title="Organization members"
          desc="Everyone in your Brain2 organization. Roles are granted per workspace — expand a row to manage which workspaces someone belongs to and whether they're an admin or member."
        >
          {/* invite bar */}
          <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--accent-line, var(--accent))', background: 'var(--accent-soft)', marginBottom: 18 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>Invite someone to the organization</div>
            <EmailSuggest value={email} onChange={setEmail} candidates={inviteCandidates} onEnter={invite} placeholder="Enter email or name…" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Add to</span>
              <LevelSelect value={effectiveInviteWs} options={wsOpts} onPick={setInviteWs} width={180} />
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>as</span>
              <LevelSelect value={inviteRole} options={wsRoleOpts} onPick={(v) => setInviteRole(v as WsRole)} width={150} />
              <button onClick={invite} disabled={!validEmail || exists} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 38, padding: '0 13px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: (validEmail && !exists) ? 'pointer' : 'not-allowed', opacity: (validEmail && !exists) ? 1 : 0.5, fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, marginLeft: 'auto' }}>
                <Icon name="plus" size={14} color="#fff" /> Invite
              </button>
            </div>
            {email.trim() && !validEmail && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>Enter a valid email address.</div>}
            {exists && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>That person is already in your organization.</div>}
          </div>

          {/* search + filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
              <span style={{ position: 'absolute', left: 11, top: 9, pointerEvents: 'none' }}>
                <Icon name="search" size={15} color="var(--fg-faint)" />
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people…"
                style={{ width: '100%', height: 34, padding: '0 12px 0 34px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--surface-2)', borderRadius: 9 }}>
              {filters.map((f) => {
                const on = filter === f.id;
                return (
                  <button key={f.id} onClick={() => setFilter(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px', border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: on ? 600 : 500, background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: on ? 'var(--shadow-card)' : 'none' }}>
                    {f.label}
                    <span style={{ fontSize: 11, color: on ? 'var(--fg-muted)' : 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{f.n}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* member rows */}
          <div>
            {shown.map((m, i) => {
              const p = dir(m.u);
              const last = i === shown.length - 1;
              const open = expanded.has(m.u);
              const mGroups = groups.filter((g) => g.members.includes(m.u));
              const tr = topRole(m);
              return (
                <div key={m.u} style={{ borderBottom: last && !open ? 'none' : '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', cursor: 'pointer' }} onClick={() => toggleExp(m.u)}>
                    <Icon name="chevRight" size={14} color="var(--fg-faint)" style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                    <PresenceAvatar u={m.u} size={36} presence={m.presence} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>
                        {p.name}
                        {m.you && <span style={{ fontSize: 10.5, color: 'var(--fg-muted)', fontWeight: 400 }}>you</span>}
                        {m.status === 'invited' && (
                          <span style={{ fontSize: 10, color: 'var(--warning)', background: 'var(--warning-soft, rgba(245,158,11,0.12))', borderRadius: 5, padding: '1px 6px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <Icon name="clock" size={10} color="var(--warning)" /> invited
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</div>
                      {mGroups.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                          {mGroups.map((g) => {
                            const gAdmin = g.ws.some((x) => x.role === 'Admin');
                            return (
                              <span key={g.id} title={`Inherits this group's workspace roles${gAdmin ? ' (incl. Admin)' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 5, color: gAdmin ? 'var(--accent)' : 'var(--fg-muted)', background: gAdmin ? 'var(--accent-soft)' : 'var(--surface-2)' }}>
                                <Icon name="users" size={10} color={gAdmin ? 'var(--accent)' : 'var(--fg-muted)'} /> {g.name}{gAdmin ? ' · Admin' : ''}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="b2-hide-sm" style={{ width: 150, flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: 12, color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
                        {m.owner
                          ? <span style={{ color: 'var(--fg-muted)' }}>All workspaces</span>
                          : m.ws.length > 0
                            ? <><Icon name="layers" size={12} color="var(--fg-muted)" /><span>{m.ws.length} workspace{m.ws.length === 1 ? '' : 's'}</span></>
                            : <span style={{ color: 'var(--fg-faint)' }}>No workspaces yet</span>}
                      </div>
                      {m.presence !== 'active' && <div style={{ fontSize: 11, color: 'var(--fg-faint)', marginTop: 2 }}>{m.last}</div>}
                    </div>
                    <RoleBadge role={tr} />
                    {!m.you && (
                      <RowMenu items={[{ label: 'Remove from organization', icon: 'trash', danger: true, onClick: () => requestRemove(m) }]} />
                    )}
                  </div>

                  {open && (
                    <div style={{ padding: '4px 0 16px 60px' }}>
                      {m.owner ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                          <Icon name="shield" size={15} color="var(--accent)" />
                          <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>As organization owner, {m.you ? 'you are' : 'they are'} an admin of every workspace automatically.</span>
                        </div>
                      ) : (
                        <WsRoleEditor
                          ws={m.ws}
                          inherited={inheritedWs(m.u)}
                          setRole={(w, v) => setWsRole(m.u, w, v)}
                          removeWs={(w) => removeWs(m.u, w)}
                          addWs={(w, role) => addWs(m.u, w, role)}
                          emptyText={`Not in any workspace yet.${m.status === 'invited' ? ' Their invite is still pending.' : ''}`}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {shown.length === 0 && (
              <div style={{ padding: '28px 10px', textAlign: 'center', fontSize: 13, color: 'var(--fg-faint)' }}>No people match your search.</div>
            )}
          </div>
        </SCard>
      )}

      {dialog && <ConfirmDialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
