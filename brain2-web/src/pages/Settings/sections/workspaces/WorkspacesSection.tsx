/*
 * Workspaces settings page: a live board of workspaces with draggable vault
 * cards. Capabilities come from the caller's effective workspace role.
 */
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { RoleBadge } from '@/components/settings/SettingsCard';
import {
  useWorkspacesOverview,
  useMoveVault,
  useDeleteWorkspace,
  useCreateVault,
} from '@/hooks/useWorkspaces';
import type { OverviewWorkspace, OverviewVault } from '@/lib/types';
import { MODE_ICON, MODE_LABEL, capsFromRole, roleLabel, type Caps } from './mockData';
import { sbtn, iconBtn } from './primitives';
import { AccessDrawer } from './AccessDrawer';
import { VaultDrawer } from './VaultDrawer';
import { NewWorkspaceModal } from './NewWorkspaceModal';

interface DragState { vaultId: string; fromWs: string }

function Grip({ dim }: { dim: boolean }) {
  return (
    <span style={{ display: 'grid', gridTemplateColumns: '3px 3px', gap: 3, opacity: dim ? 0.4 : 1, cursor: 'grab', flexShrink: 0 }} title="Drag to move">
      {Array.from({ length: 6 }).map((_, i) => <span key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--fg-faint)' }} />)}
    </span>
  );
}

function VaultCard({ vault, caps, dragging, onOpen, onDragStart, onDragEnd }: {
  vault: OverviewVault;
  caps: Caps;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const [hover, setHover] = useState(false);
  const draggable = caps.canMoveVaults;
  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px', borderRadius: 10,
        border: '1px solid var(--border)', background: hover ? 'var(--surface-3)' : 'var(--surface-2)',
        cursor: draggable ? 'grab' : 'pointer', opacity: dragging ? 0.4 : (vault.archived_at ? 0.55 : 1),
        boxShadow: dragging ? '0 12px 28px rgba(0,0,0,0.3)' : 'none', transition: 'background .12s',
      }}
    >
      {draggable && <span style={{ paddingTop: 5 }}><Grip dim={!hover} /></span>}
      <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}>
        <Icon name="folder" size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vault.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4, whiteSpace: 'nowrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--fg-muted)' }}>
            <Icon name={MODE_ICON[vault.mode]} size={11} color="var(--accent)" />{MODE_LABEL[vault.mode]}
          </span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--fg-faint)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{vault.source_count} src</span>
        </div>
      </div>
      <Icon name="chevRight" size={14} color="var(--fg-faint)" style={{ marginTop: 3, opacity: hover ? 1 : 0 }} />
    </div>
  );
}

function WsColumn({ ws, drag, dropTarget, onDropHere, setDrag, setDropTarget, onOpenAccess, onOpenVault, onAddVault, onMenu }: {
  ws: OverviewWorkspace;
  drag: DragState | null;
  dropTarget: string | null;
  onDropHere: (toWsId: string) => void;
  setDrag: (d: DragState | null) => void;
  setDropTarget: (id: string | null) => void;
  onOpenAccess: (ws: OverviewWorkspace) => void;
  onOpenVault: (ws: OverviewWorkspace, v: OverviewVault) => void;
  onAddVault: (ws: OverviewWorkspace) => void;
  onMenu: (ws: OverviewWorkspace) => void;
}) {
  const caps = capsFromRole(ws.role);
  const isDropOk = !!drag && caps.canMoveVaults && drag.fromWs !== ws.workspace_id;
  const active = dropTarget === ws.workspace_id && isDropOk;

  return (
    <div
      onDragOver={(e) => { if (isDropOk) { e.preventDefault(); setDropTarget(ws.workspace_id); } }}
      onDragLeave={(e) => {
        const related = e.relatedTarget as Node | null;
        if (dropTarget === ws.workspace_id && (!related || !e.currentTarget.contains(related))) setDropTarget(null);
      }}
      onDrop={(e) => { if (isDropOk) { e.preventDefault(); onDropHere(ws.workspace_id); } }}
      style={{
        width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 14, boxShadow: active ? '0 0 0 3px var(--accent-soft)' : 'var(--shadow-card)',
        transition: 'border-color .12s, box-shadow .12s', overflow: 'hidden',
        opacity: ws.archived_at ? 0.6 : 1,
      }}
    >
      <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, fontFamily: 'var(--display-font)' }}>
            {(ws.name[0] || '?').toUpperCase()}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ws.name}</span>
              {ws.archived_at && <Icon name="file" size={12} color="var(--fg-faint)" />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <RoleBadge role={roleLabel(ws.role)} />
              {caps.readOnly && <span style={{ fontSize: 10.5, color: 'var(--fg-faint)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="file" size={10} /> read-only</span>}
            </div>
          </div>
          <button onClick={() => onMenu(ws)} style={{ ...iconBtn(), width: 28, height: 28, border: 'none' }} title="Workspace settings"><Icon name="more" size={16} color="var(--fg-muted)" /></button>
        </div>

        <button onClick={() => onOpenAccess(ws)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 11, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontFamily: 'var(--ui-font)' }} title={caps.canManageMembers ? 'Manage access' : 'View members'}>
          <div style={{ display: 'flex' }}>
            {ws.members.slice(0, 4).map((m, i) => (
              <span key={m.user_id} style={{ width: 22, height: 22, borderRadius: '50%', marginLeft: i ? -7 : 0, background: 'var(--surface-3)', border: '2px solid var(--surface)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600 }}>
                {(m.display_name || m.email || '?')[0].toUpperCase()}
              </span>
            ))}
          </div>
          <span style={{ flex: 1, textAlign: 'left', fontSize: 12, color: 'var(--fg-muted)' }}>{ws.members.length} {ws.members.length === 1 ? 'member' : 'members'}</span>
          <span style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>{caps.canManageMembers ? 'Manage' : 'View'} <Icon name="chevRight" size={12} /></span>
        </button>
      </div>

      <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 70 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 2px' }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>Vaults · {ws.vaults.length}</span>
        </div>
        {ws.vaults.map((v) => (
          <VaultCard
            key={v.project_id}
            vault={v}
            caps={caps}
            dragging={!!drag && drag.vaultId === v.project_id}
            onOpen={() => onOpenVault(ws, v)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              try { e.dataTransfer.setData('text/plain', v.project_id); } catch { /* ignore */ }
              setDrag({ vaultId: v.project_id, fromWs: ws.workspace_id });
            }}
            onDragEnd={() => { setDrag(null); setDropTarget(null); }}
          />
        ))}
        {ws.vaults.length === 0 && (
          <div style={{ padding: '18px 10px', textAlign: 'center', fontSize: 12, color: 'var(--fg-faint)', border: '1px dashed var(--border)', borderRadius: 10 }}>
            {active ? 'Drop vault here' : 'No vaults yet'}
          </div>
        )}
        {caps.canManageVaults && (
          <button onClick={() => onAddVault(ws)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, borderRadius: 10, border: '1px dashed var(--border-strong)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 500, marginTop: 2 }}>
            <Icon name="plus" size={14} /> New vault
          </button>
        )}
      </div>
    </div>
  );
}

export function WorkspacesSection() {
  const { data, isLoading, error } = useWorkspacesOverview();
  const moveVault = useMoveVault();
  const deleteWs = useDeleteWorkspace();
  const createVault = useCreateVault();

  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [accessWsId, setAccessWsId] = useState<string | null>(null);
  const [vaultCtx, setVaultCtx] = useState<{ wsId: string; vaultId: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const workspaces = data?.workspaces ?? [];
  const canCreate = data?.can_create ?? false;

  const onDropHere = (toWsId: string) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    moveVault.mutate({ project_id: d.vaultId, workspace_id: toWsId });
  };

  const accessWs = accessWsId ? workspaces.find((w) => w.workspace_id === accessWsId) ?? null : null;
  const vaultLive = vaultCtx
    ? (() => {
        const w = workspaces.find((x) => x.workspace_id === vaultCtx.wsId);
        const v = w?.vaults.find((x) => x.project_id === vaultCtx.vaultId);
        return w && v ? { ws: w, vault: v } : null;
      })()
    : null;

  if (isLoading) return <div style={{ padding: 24, color: 'var(--fg-muted)', fontSize: 13 }}>Loading workspaces...</div>;
  if (error) return <div style={{ padding: 24, color: 'var(--destructive)', fontSize: 13 }}>Failed to load workspaces.</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '14px 16px', marginBottom: 18, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-card)' }}>
        <p style={{ flex: 1, minWidth: 240, margin: 0, fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          Organise vaults into workspaces. Drag a vault between workspaces you administer to move it.
        </p>
        {canCreate
          ? <button onClick={() => setCreating(true)} style={sbtn('primary')}><Icon name="plus" size={14} color="#fff" /> New workspace</button>
          : <span style={{ fontSize: 11.5, color: 'var(--fg-faint)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="shield" size={13} /> Only owners can create workspaces</span>}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 18 }}>
        {workspaces.map((ws) => (
          <WsColumn
            key={ws.workspace_id}
            ws={ws}
            drag={drag}
            dropTarget={dropTarget}
            setDrag={setDrag}
            setDropTarget={setDropTarget}
            onDropHere={onDropHere}
            onOpenAccess={(w) => setAccessWsId(w.workspace_id)}
            onOpenVault={(w, v) => setVaultCtx({ wsId: w.workspace_id, vaultId: v.project_id })}
            onAddVault={(w) => {
              const name = prompt('New vault name', 'Untitled');
              if (name?.trim()) createVault.mutate({ name: name.trim(), workspace_id: w.workspace_id });
            }}
            onMenu={(w) => setAccessWsId(w.workspace_id)}
          />
        ))}
        {canCreate && (
          <button onClick={() => setCreating(true)} style={{ width: 300, flexShrink: 0, minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14, border: '1px dashed var(--border-strong)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
            <span style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={20} color="var(--fg-muted)" /></span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>New workspace</span>
          </button>
        )}
      </div>

      {accessWs && (
        <AccessDrawer
          ws={accessWs}
          onClose={() => setAccessWsId(null)}
          onDelete={() => {
            deleteWs.mutate({ workspace_id: accessWs.workspace_id });
            setAccessWsId(null);
          }}
        />
      )}
      {vaultLive && (
        <VaultDrawer
          vault={vaultLive.vault}
          ws={vaultLive.ws}
          allWorkspaces={workspaces}
          onClose={() => setVaultCtx(null)}
        />
      )}
      {creating && <NewWorkspaceModal onClose={() => setCreating(false)} onCreated={() => setCreating(false)} />}
    </div>
  );
}
