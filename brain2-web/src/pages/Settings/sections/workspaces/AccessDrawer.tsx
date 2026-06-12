/*
 * Access / "Manage workspace" drawer — ported from workspaces-panels.jsx.
 * Editable workspace name + description, member management with the add-member
 * bar, transfer-ownership, and an owner-only danger zone.
 */
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { RoleBadge } from '@/components/settings/SettingsCard';
import {
  WS_PEOPLE, ROLE_ORDER, ROLE_DESC, CURRENT_USER,
  type Workspace, type Caps, type Role,
} from './mockData';
import {
  OverlayShell, AddPersonBar, AccessRow, sbtn,
  type Shell, type SelectOption, type Candidate,
} from './primitives';

export function AccessDrawer({
  ws, caps, meRole, isTenantOwner, Shell = OverlayShell,
  onClose, onChangeRole, onRemove, onAdd, onTransfer, onSaveMeta, onArchive, onDelete,
}: {
  ws: Workspace;
  caps: Caps;
  meRole: Role;
  isTenantOwner: boolean;
  Shell?: Shell;
  onClose: () => void;
  onChangeRole: (u: string, role: string) => void;
  onRemove: (u: string) => void;
  onAdd: (u: string, role: string) => void;
  onTransfer: () => void;
  onSaveMeta: (name: string, desc: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const canEdit = caps.canManageMembers;
  const canDelete = caps.canDelete;
  const [name, setName] = useState(ws.name);
  const [desc, setDesc] = useState(ws.desc || '');
  const [confirmDel, setConfirmDel] = useState(false);

  const present = new Set(ws.members.map((m) => m.u));
  const candidates: Candidate[] = Object.keys(WS_PEOPLE)
    .filter((u) => !present.has(u))
    .map((u) => ({ u, name: WS_PEOPLE[u].name, email: WS_PEOPLE[u].email }));
  const roleOpts: SelectOption[] = (caps.canAddAdmins ? (['Admin', 'Editor', 'Viewer'] as Role[]) : (['Editor', 'Viewer'] as Role[]))
    .map((r) => ({ id: r, label: r, icon: 'shield', desc: ROLE_DESC[r] }));

  const rowLocked = (m: Workspace['members'][number]) => {
    if (!caps.canManageMembers) return true;
    if (m.role === 'Owner') return true;
    if (!caps.canAddAdmins && m.role === 'Admin') return true;
    return false;
  };
  const showTransfer = caps.canManageMembers && !isTenantOwner;

  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 500 };
  const inputStyle: React.CSSProperties = { width: '100%', height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border)', background: canEdit ? 'var(--bg)' : 'var(--surface-2)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' };
  const dirty = name !== ws.name || desc !== (ws.desc || '');

  return (
    <Shell
      icon="settings" title={ws.name} sub="Manage workspace" onClose={onClose}
      footer={canEdit
        ? (
          <>
            <button onClick={onClose} style={sbtn()}>Cancel</button>
            <button onClick={() => { onSaveMeta(name.trim() || ws.name, desc); onClose(); }} style={{ ...sbtn('primary'), opacity: dirty ? 1 : 0.6 }}>Save changes</button>
          </>
        )
        : <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>You have read-only access to this workspace.</span>}
    >
      {!caps.canManageMembers && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', marginBottom: 16, borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <Icon name="shield" size={15} color="var(--fg-muted)" />
          <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>You're a member here. Only owners and workspace admins can change these settings.</span>
        </div>
      )}

      {/* workspace settings */}
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Workspace name</label>
        <input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Description</label>
        <textarea value={desc} disabled={!canEdit} onChange={(e) => setDesc(e.target.value)} placeholder="What is this workspace for?" rows={2} style={{ ...inputStyle, height: 'auto', padding: '9px 12px', resize: 'vertical', lineHeight: 1.5 }} />
      </div>

      {/* members */}
      <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 3 }}>Members · {ws.members.length}</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: canEdit ? 12 : 8 }}>People who can access this workspace and its vaults.</div>
        {canEdit && (
          <div style={{ marginBottom: 12 }}>
            <AddPersonBar candidates={candidates} levelOptions={roleOpts} defaultLevel="Viewer" placeholder="Enter email or name" onAdd={(u, role) => onAdd(u, role)} />
            {!caps.canAddAdmins && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 8 }}>As an admin you can add Editors and Viewers. Only the owner can grant Admin.</div>}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[...ws.members].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)).map((m) => {
            const p = WS_PEOPLE[m.u] || { name: m.u, email: '' };
            const locked = rowLocked(m);
            const isMe = m.u === CURRENT_USER;
            const displayRole = (isMe && meRole) ? meRole : m.role;
            const tag = (
              <>
                {isMe && <span style={{ fontSize: 10.5, color: 'var(--fg-muted)' }}>you</span>}
                {m.status === 'invited' && <span style={{ fontSize: 10, color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 5, padding: '1px 6px', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="clock" size={10} /> invited</span>}
              </>
            );
            return (
              <AccessRow
                key={m.u} u={m.u} name={p.name} sub={p.email} tag={tag}
                value={m.role}
                options={([...(caps.canAddAdmins ? (['Admin'] as Role[]) : []), 'Editor', 'Viewer'] as Role[]).map((r) => ({ id: r, label: r, desc: ROLE_DESC[r] }))}
                locked={locked} badge={<RoleBadge role={displayRole} />}
                canRemove={!locked && !isMe}
                onChange={(r) => onChangeRole(m.u, r)}
                onRemove={() => onRemove(m.u)}
              />
            );
          })}
        </div>
      </div>

      {showTransfer && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>Transfer ownership</div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', margin: '3px 0 10px', lineHeight: 1.45 }}>Hand this workspace to another admin. You'll become an Admin.</div>
          <button onClick={onTransfer} style={sbtn('danger')}>Transfer ownership…</button>
        </div>
      )}

      {/* danger zone — owners only */}
      {canDelete && (
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Archive workspace</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Hide from everyone; keep all vaults and data.</div>
            </div>
            <button onClick={() => onArchive()} style={sbtn()}>Archive</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--destructive)' }}>Delete workspace</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Removes {ws.vaults ? ws.vaults.length : 0} vault{(ws.vaults ? ws.vaults.length : 0) === 1 ? '' : 's'} and all sources permanently.</div>
            </div>
            {confirmDel
              ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setConfirmDel(false)} style={sbtn()}>Cancel</button>
                  <button onClick={() => onDelete()} style={{ ...sbtn('danger'), background: 'var(--destructive)', color: '#fff', borderColor: 'transparent' }}>Confirm delete</button>
                </div>
              )
              : <button onClick={() => setConfirmDel(true)} style={sbtn('danger')}><Icon name="trash" size={14} /> Delete</button>}
          </div>
        </div>
      )}
      {!canDelete && caps.canManageMembers && (
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-faint)' }}>
          <Icon name="shield" size={13} color="var(--fg-faint)" /> Only the workspace owner can archive or delete this workspace.
        </div>
      )}
    </Shell>
  );
}
