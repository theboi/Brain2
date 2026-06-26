/*
 * Access / manage-workspace drawer. Name, description, members, archive, and
 * delete are wired to live ops.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/ui/Icon';
import { RoleBadge } from '@/components/settings/SettingsCard';
import { useAddMember, useSetMemberRole, useRemoveMember } from '@/hooks/members';
import { useUpdateWorkspace, useArchiveWorkspace, useUserDirectory } from '@/hooks/useWorkspaces';
import { qk } from '@/lib/queryClient';
import type { OverviewWorkspace } from '@/lib/types';
import { capsFromRole, ROLE_DESC } from './mockData';
import {
  OverlayShell, AddPersonBar, AccessRow, sbtn,
  type SelectOption, type Candidate,
} from './primitives';

export function AccessDrawer({ ws, onClose, onDelete }: {
  ws: OverviewWorkspace;
  onClose: () => void;
  onDelete: () => void;
}) {
  const caps = capsFromRole(ws.role);
  const canEdit = caps.canManageMembers;
  const canDelete = caps.canDelete;
  const qc = useQueryClient();

  const { data: directoryUsers } = useUserDirectory(canEdit ? ws.workspace_id : null);
  const addMember = useAddMember(ws.workspace_id);
  const setMemberRole = useSetMemberRole(ws.workspace_id);
  const removeMember = useRemoveMember(ws.workspace_id);
  const updateWs = useUpdateWorkspace();
  const archiveWs = useArchiveWorkspace();

  const [name, setName] = useState(ws.name);
  const [desc, setDesc] = useState(ws.description || '');
  const [confirmDel, setConfirmDel] = useState(false);

  const invalidateOverview = () => qc.invalidateQueries({ queryKey: qk.workspacesOverview() });
  const present = new Set(ws.members.map((m) => m.user_id));
  const candidates: Candidate[] = (directoryUsers ?? [])
    .filter((u) => !present.has(u.user_id))
    .map((u) => ({ u: u.user_id, name: u.display_name || u.email, email: u.email }));

  const addRoleOpts: SelectOption[] = (caps.canAddAdmins ? ['admin', 'member'] : ['member'])
    .map((r) => ({
      id: r,
      label: r === 'admin' ? 'Admin' : 'Member',
      icon: 'shield',
      desc: ROLE_DESC[r === 'admin' ? 'Admin' : 'Member'],
    }));

  const rowLocked = (role: 'admin' | 'member') => {
    if (!caps.canManageMembers) return true;
    if (!caps.canAddAdmins && role === 'admin') return true;
    return false;
  };

  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 500 };
  const inputStyle: React.CSSProperties = { width: '100%', height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border)', background: canEdit ? 'var(--bg)' : 'var(--surface-2)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' };
  const dirty = name !== ws.name || desc !== (ws.description || '');

  return (
    <OverlayShell
      icon="settings"
      title={ws.name}
      sub="Manage workspace"
      onClose={onClose}
      footer={canEdit
        ? (
          <>
            <button onClick={onClose} style={sbtn()}>Cancel</button>
            <button
              onClick={() => {
                updateWs.mutate({ workspace_id: ws.workspace_id, name: name.trim() || ws.name, description: desc });
                onClose();
              }}
              style={{ ...sbtn('primary'), opacity: dirty ? 1 : 0.6 }}
            >
              Save changes
            </button>
          </>
        )
        : <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>You have read-only access to this workspace.</span>}
    >
      {!canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', marginBottom: 16, borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <Icon name="shield" size={15} color="var(--fg-muted)" />
          <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>You're a member here. Only owners and workspace admins can change these settings.</span>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Workspace name</label>
        <input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Description</label>
        <textarea value={desc} disabled={!canEdit} onChange={(e) => setDesc(e.target.value)} placeholder="What is this workspace for?" rows={2} style={{ ...inputStyle, height: 'auto', padding: '9px 12px', resize: 'vertical', lineHeight: 1.5 }} />
      </div>

      <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 3 }}>Members · {ws.members.length}</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: canEdit ? 12 : 8 }}>People who can access this workspace and its vaults.</div>
        {canEdit && (
          <div style={{ marginBottom: 12 }}>
            <AddPersonBar
              candidates={candidates}
              levelOptions={addRoleOpts}
              defaultLevel="member"
              placeholder="Enter email or name"
              onAdd={(u, role) => addMember.mutate(
                { workspace_id: ws.workspace_id, user_id: u, role },
                { onSuccess: invalidateOverview },
              )}
            />
            {!caps.canAddAdmins && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 8 }}>As an admin you can add Members. Only the owner can grant Admin.</div>}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[...ws.members].sort((a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1)).map((m) => {
            const locked = rowLocked(m.role);
            const badgeRole = m.role === 'admin' ? 'Admin' : 'Member';
            return (
              <AccessRow
                key={m.user_id}
                u={m.user_id}
                name={m.display_name || m.email}
                sub={m.email}
                value={m.role}
                options={(caps.canAddAdmins ? ['admin', 'member'] : ['member']).map((r) => ({
                  id: r,
                  label: r === 'admin' ? 'Admin' : 'Member',
                  desc: ROLE_DESC[r === 'admin' ? 'Admin' : 'Member'],
                }))}
                locked={locked}
                badge={<RoleBadge role={badgeRole} />}
                canRemove={!locked}
                onChange={(r) => setMemberRole.mutate(
                  { workspace_id: ws.workspace_id, user_id: m.user_id, role: r },
                  { onSuccess: invalidateOverview },
                )}
                onRemove={() => removeMember.mutate(
                  { workspace_id: ws.workspace_id, user_id: m.user_id },
                  { onSuccess: invalidateOverview },
                )}
              />
            );
          })}
        </div>
      </div>

      {canDelete && (
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Archive workspace</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Hide from everyone; keep all vaults and data.</div>
            </div>
            <button onClick={() => { archiveWs.mutate({ workspace_id: ws.workspace_id }); onClose(); }} style={sbtn()}>Archive</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--destructive)' }}>Delete workspace</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>{ws.vaults.length > 0 ? 'Move or delete its vaults first.' : 'Permanently delete this empty workspace.'}</div>
            </div>
            {confirmDel
              ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setConfirmDel(false)} style={sbtn()}>Cancel</button>
                  <button onClick={onDelete} style={{ ...sbtn('danger'), background: 'var(--destructive)', color: '#fff', borderColor: 'transparent' }}>Confirm delete</button>
                </div>
              )
              : <button disabled={ws.vaults.length > 0} onClick={() => setConfirmDel(true)} style={{ ...sbtn('danger'), opacity: ws.vaults.length > 0 ? 0.5 : 1 }}><Icon name="trash" size={14} /> Delete</button>}
          </div>
        </div>
      )}
      {!canDelete && canEdit && (
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-faint)' }}>
          <Icon name="shield" size={13} color="var(--fg-faint)" /> Only the workspace owner can archive or delete this workspace.
        </div>
      )}
    </OverlayShell>
  );
}
