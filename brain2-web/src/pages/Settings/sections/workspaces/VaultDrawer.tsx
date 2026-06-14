/*
 * Vault management drawer: name/mode, move-to-workspace, per-vault guest
 * access, and archive are wired to live ops.
 */
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useVaultAccess, useAddGuest, useSetGuestRole, useRemoveGuest } from '@/hooks/access';
import { useRenameVault, useSetVaultMode, useMoveVault, useArchiveVault } from '@/hooks/useWorkspaces';
import { useTenantUsers } from '@/hooks/people';
import type { OverviewWorkspace, OverviewVault } from '@/lib/types';
import {
  VAULT_MODE_OPTS, ACCESS_LEVELS, capsFromRole,
  LEVEL_TO_ROLE, ROLE_TO_LEVEL, type AccessLevelId, type VaultMode,
} from './mockData';
import {
  OverlayShell, MiniSelect, AddPersonBar, AccessRow, sbtn,
  type SelectOption, type Candidate,
} from './primitives';

const levelOpts: SelectOption[] = ACCESS_LEVELS.map((l) => ({ id: l.id, label: l.label, icon: l.icon }));

export function VaultDrawer({ vault, ws, allWorkspaces, onClose }: {
  vault: OverviewVault;
  ws: OverviewWorkspace;
  allWorkspaces: OverviewWorkspace[];
  onClose: () => void;
}) {
  const caps = capsFromRole(ws.role);
  const ro = !caps.canManageVaults;

  const { data: access } = useVaultAccess(vault.project_id);
  const { data: tenantUsers } = useTenantUsers();
  const addGuest = useAddGuest(vault.project_id);
  const setGuestRole = useSetGuestRole(vault.project_id);
  const removeGuest = useRemoveGuest(vault.project_id);
  const renameVault = useRenameVault();
  const setMode = useSetVaultMode();
  const moveVault = useMoveVault();
  const archiveVault = useArchiveVault();

  const [name, setName] = useState(vault.name);
  const [mode, setModeState] = useState<VaultMode>(vault.mode);
  const [moveTo, setMoveTo] = useState(ws.workspace_id);
  const [confirmDel, setConfirmDel] = useState(false);

  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 500 };
  const inputStyle: React.CSSProperties = { width: '100%', height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: ro ? 'var(--surface-2)' : 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, outline: 'none' };

  const moveTargets = allWorkspaces.filter((w) => w.workspace_id !== ws.workspace_id && capsFromRole(w.role).canMoveVaults);
  const pendingMove = moveTo !== ws.workspace_id;
  const moveTargetName = allWorkspaces.find((w) => w.workspace_id === moveTo)?.name;

  const accessRows = access ?? [];
  const presentAccess = new Set(accessRows.map((a) => a.user_id));
  const candidates: Candidate[] = (tenantUsers ?? [])
    .filter((u) => !presentAccess.has(u.user_id))
    .map((u) => ({ u: u.user_id, name: u.display_name || u.email, email: u.email }));

  const save = () => {
    if (name.trim() && name.trim() !== vault.name) renameVault.mutate({ project_id: vault.project_id, name: name.trim() });
    if (mode !== vault.mode) setMode.mutate({ project_id: vault.project_id, mode });
    if (pendingMove) moveVault.mutate({ project_id: vault.project_id, workspace_id: moveTo });
    onClose();
  };

  return (
    <OverlayShell
      icon="folder"
      title={vault.name}
      sub={`in ${ws.name} · ${vault.source_count} sources`}
      onClose={onClose}
      footer={ro ? <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>Read-only: you can't edit this vault.</span> : (
        <>
          <button onClick={onClose} style={sbtn()}>Cancel</button>
          <button onClick={save} style={sbtn('primary')}>Save changes</button>
        </>
      )}
    >
      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Vault name</label>
        <input value={name} disabled={ro} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--border)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Default ingestion mode</div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>How new sources are processed.</div>
        </div>
        <MiniSelect value={mode} disabled={ro} width={236} options={VAULT_MODE_OPTS} onPick={(v) => setModeState(v as VaultMode)} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--border)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Move to workspace</div>
          <div style={{ fontSize: 11.5, color: pendingMove ? 'var(--accent)' : 'var(--fg-muted)', marginTop: 2 }}>
            {!caps.canMoveVaults ? "You can't move this vault." : pendingMove ? `Moves to "${moveTargetName ?? 'selected workspace'}" when you save.` : 'Relocate this vault and its sources.'}
          </div>
        </div>
        <MiniSelect
          value={moveTo}
          disabled={ro || !moveTargets.length}
          width={210}
          options={[
            { id: ws.workspace_id, label: `${ws.name} (current)`, icon: 'folder' },
            ...moveTargets.map((w) => ({ id: w.workspace_id, label: w.name, icon: 'folder' as const })),
          ]}
          onPick={(t) => setMoveTo(t)}
        />
      </div>

      <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)', marginTop: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 3 }}>Who can access this vault</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: ro ? 8 : 12 }}>Owners, workspace members and per-vault guests.</div>
        {!ro && (
          <div style={{ marginBottom: 12 }}>
            <AddPersonBar
              candidates={candidates}
              levelOptions={levelOpts}
              defaultLevel="read"
              placeholder="Enter email or name"
              onAdd={(u, level) => addGuest.mutate({ project_id: vault.project_id, user_id: u, role: LEVEL_TO_ROLE[level as AccessLevelId] })}
            />
          </div>
        )}
        {accessRows.map((a) => {
          const level = ROLE_TO_LEVEL[a.role] ?? 'read';
          const lv = ACCESS_LEVELS.find((l) => l.id === level) || ACCESS_LEVELS[0];
          const isGuest = a.source === 'guest';
          const subText = a.source === 'owner' ? 'Tenant owner'
            : a.source === 'workspace_admin' ? 'Workspace admin'
            : a.source === 'workspace_member' ? 'Workspace member'
            : a.email;
          return (
            <AccessRow
              key={a.user_id}
              u={a.user_id}
              name={a.display_name || a.email}
              sub={subText}
              value={level}
              options={levelOpts}
              locked={ro || !isGuest}
              badge={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg-muted)', fontSize: 12, fontWeight: 500 }}><Icon name={lv.icon} size={13} color="var(--fg-faint)" />{lv.label}</span>}
              canRemove={!ro && isGuest}
              onChange={(lvl) => setGuestRole.mutate({ project_id: vault.project_id, user_id: a.user_id, role: LEVEL_TO_ROLE[lvl as AccessLevelId] })}
              onRemove={() => removeGuest.mutate({ project_id: vault.project_id, user_id: a.user_id })}
            />
          );
        })}
      </div>

      {caps.canDelete && (
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Archive vault</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Hide from agents; keep the data.</div>
            </div>
            <button onClick={() => { archiveVault.mutate({ project_id: vault.project_id }); onClose(); }} style={sbtn()}>Archive</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--destructive)' }}>Delete vault</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Vault deletion is not yet available. Archive instead.</div>
            </div>
            {confirmDel
              ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setConfirmDel(false)} style={sbtn()}>Cancel</button>
                  <button disabled style={{ ...sbtn('danger'), opacity: 0.5 }}>Unavailable</button>
                </div>
              )
              : <button disabled onClick={() => setConfirmDel(true)} style={{ ...sbtn('danger'), opacity: 0.5 }}><Icon name="trash" size={14} /> Delete</button>}
          </div>
        </div>
      )}
      {!caps.canDelete && !ro && (
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-faint)' }}>
          <Icon name="shield" size={13} color="var(--fg-faint)" /> Only the workspace owner can archive this vault.
        </div>
      )}
    </OverlayShell>
  );
}
