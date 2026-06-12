/*
 * Vault management drawer — ported from workspaces-panels.jsx.
 * Vault name/description, default ingestion mode, move-to-workspace, per-vault
 * access overrides, and an owner-only danger zone.
 */
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import {
  WS_PEOPLE, VAULT_MODE_OPTS, ACCESS_LEVELS,
  type Workspace, type Vault, type Caps, type VaultAccess, type AccessLevelId,
} from './mockData';
import {
  OverlayShell, MiniSelect, AddPersonBar, AccessRow, sbtn,
  type Shell, type SelectOption, type Candidate,
} from './primitives';

function seedVaultAccess(): VaultAccess[] {
  return [
    { u: 'alice', level: 'admin' },
    { u: 'bob', level: 'write' },
    { u: 'carol', level: 'read' },
  ];
}

const levelOpts: SelectOption[] = ACCESS_LEVELS.filter((l) => l.id !== 'none').map((l) => ({ id: l.id, label: l.label, icon: l.icon }));

export function VaultDrawer({ vault, ws, allWorkspaces, caps, Shell = OverlayShell, onClose, onSave, onMove, onArchive, onDelete }: {
  vault: Vault;
  ws: Workspace;
  allWorkspaces: Workspace[];
  caps: Caps;
  Shell?: Shell;
  onClose: () => void;
  onSave: (v: Vault) => void;
  onMove: (toId: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const ro = !caps.canManageVaults;
  const [name, setName] = useState(vault.name);
  const [desc, setDesc] = useState(vault.desc || '');
  const [mode, setMode] = useState(vault.mode);
  const [access, setAccess] = useState<VaultAccess[]>(vault.access || seedVaultAccess());
  const [moveTo, setMoveTo] = useState(ws.id);
  const [confirmDel, setConfirmDel] = useState(false);

  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 500 };
  const inputStyle: React.CSSProperties = { width: '100%', height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: ro ? 'var(--surface-2)' : 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, outline: 'none' };
  const moveTargets = allWorkspaces.filter((w) => w.id !== ws.id && caps.canMoveVaults);
  const pendingMove = moveTo !== ws.id;
  const moveTargetName = (allWorkspaces.find((w) => w.id === moveTo) || ({} as Workspace)).name;

  const candidates: Candidate[] = Object.keys(WS_PEOPLE)
    .filter((u) => !access.some((a) => a.u === u))
    .map((u) => ({ u, name: WS_PEOPLE[u].name, email: WS_PEOPLE[u].email }));

  return (
    <Shell
      icon="folder" title={vault.name} sub={`in ${ws.name} · ${vault.items} sources`} onClose={onClose}
      footer={ro ? <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>Read-only — you can't edit this vault.</span> : (
        <>
          <button onClick={onClose} style={sbtn()}>Cancel</button>
          <button onClick={() => { onSave({ ...vault, name, desc, mode, access }); if (pendingMove) onMove(moveTo); }} style={sbtn('primary')}>Save changes</button>
        </>
      )}
    >
      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Vault name</label>
        <input value={name} disabled={ro} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Description</label>
        <textarea value={desc} disabled={ro} onChange={(e) => setDesc(e.target.value)} placeholder="What lives in this vault?" rows={2} style={{ ...inputStyle, height: 'auto', padding: '9px 12px', resize: 'vertical', lineHeight: 1.5 }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--border)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Default ingestion mode</div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>How new sources are processed.</div>
        </div>
        <MiniSelect value={mode} disabled={ro} width={236} options={VAULT_MODE_OPTS} onPick={(v) => setMode(v as Vault['mode'])} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--border)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Move to workspace</div>
          <div style={{ fontSize: 11.5, color: pendingMove ? 'var(--accent)' : 'var(--fg-muted)', marginTop: 2 }}>
            {!caps.canMoveVaults ? "You can't move this vault." : pendingMove ? `Moves to “${moveTargetName}” when you save.` : 'Relocate this vault and its sources.'}
          </div>
        </div>
        <MiniSelect
          value={moveTo} disabled={ro || !moveTargets.length} width={210}
          options={[{ id: ws.id, label: `${ws.name} (current)`, icon: 'folder' }, ...moveTargets.map((w) => ({ id: w.id, label: w.name, icon: 'folder' as const }))]}
          onPick={(t) => setMoveTo(t)}
        />
      </div>

      {/* per-vault access — same row UI as workspace access */}
      <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)', marginTop: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 3 }}>Who can access this vault</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: ro ? 8 : 12 }}>Overrides the workspace role for this vault only.</div>
        {!ro && (
          <div style={{ marginBottom: 12 }}>
            <AddPersonBar
              candidates={candidates}
              levelOptions={levelOpts}
              defaultLevel="read" placeholder="Enter email or name"
              onAdd={(u, level) => setAccess((prev) => prev.some((x) => x.u === u) ? prev : [...prev, { u, level: level as AccessLevelId }])}
            />
          </div>
        )}
        {access.map((a) => {
          const p = WS_PEOPLE[a.u] || { name: a.u, email: '' };
          const lv = ACCESS_LEVELS.find((l) => l.id === a.level) || ACCESS_LEVELS[0];
          return (
            <AccessRow
              key={a.u} u={a.u} name={p.name} sub={p.email}
              value={a.level}
              options={levelOpts}
              locked={ro}
              badge={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg-muted)', fontSize: 12, fontWeight: 500 }}><Icon name={lv.icon} size={13} color="var(--fg-faint)" />{lv.label}</span>}
              canRemove={!ro}
              onChange={(level) => setAccess(access.map((x) => x.u === a.u ? { ...x, level: level as AccessLevelId } : x))}
              onRemove={() => setAccess(access.filter((x) => x.u !== a.u))}
            />
          );
        })}
      </div>

      {/* danger — owners only */}
      {caps.canDelete && (
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Archive vault</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Hide from agents; keep the data.</div>
            </div>
            <button onClick={onArchive} style={sbtn()}>Archive</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--destructive)' }}>Delete vault</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Removes {vault.items} sources permanently.</div>
            </div>
            {confirmDel
              ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setConfirmDel(false)} style={sbtn()}>Cancel</button>
                  <button onClick={onDelete} style={{ ...sbtn('danger'), background: 'var(--destructive)', color: '#fff', borderColor: 'transparent' }}>Confirm delete</button>
                </div>
              )
              : <button onClick={() => setConfirmDel(true)} style={sbtn('danger')}><Icon name="trash" size={14} /> Delete</button>}
          </div>
        </div>
      )}
      {!caps.canDelete && !ro && (
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-faint)' }}>
          <Icon name="shield" size={13} color="var(--fg-faint)" /> Only the workspace owner can archive or delete this vault.
        </div>
      )}
    </Shell>
  );
}
