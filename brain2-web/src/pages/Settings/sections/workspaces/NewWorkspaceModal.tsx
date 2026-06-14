/*
 * New workspace modal: create + optional description + invited members, wired
 * to live ops.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/ui/Icon';
import { RoleBadge } from '@/components/settings/SettingsCard';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import { useTenantUsers } from '@/hooks/people';
import { useMe } from '@/hooks/me';
import { ROLE_DESC } from './mockData';
import { Avatar, AddPersonBar, iconBtn, sbtn, type SelectOption, type Candidate } from './primitives';

interface Invite {
  u: string;
  role: 'admin' | 'member';
  name: string;
  email: string;
}

export function NewWorkspaceModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: tenantUsers } = useTenantUsers();
  const [shown, setShown] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [invited, setInvited] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    const t = setTimeout(() => setShown(true), 30);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => { cancelAnimationFrame(r); clearTimeout(t); document.removeEventListener('keydown', k); };
  }, [onClose]);

  const inputStyle: React.CSSProperties = { width: '100%', height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 500 };

  const taken = new Set([...invited.map((i) => i.u), me?.user_id ?? '']);
  const candidates: Candidate[] = (tenantUsers ?? [])
    .filter((u) => !taken.has(u.user_id))
    .map((u) => ({ u: u.user_id, name: u.display_name || u.email, email: u.email }));
  const roleOpts: SelectOption[] = (['admin', 'member'] as const).map((r) => ({
    id: r,
    label: r === 'admin' ? 'Admin' : 'Member',
    icon: 'shield',
    desc: ROLE_DESC[r === 'admin' ? 'Admin' : 'Member'],
  }));

  const onAdd = (key: string, role: string) => {
    const u = (tenantUsers ?? []).find((x) => x.user_id === key || x.email === key);
    if (!u) return;
    setInvited((prev) => prev.some((x) => x.u === u.user_id)
      ? prev
      : [...prev, { u: u.user_id, role: role as 'admin' | 'member', name: u.display_name || u.email, email: u.email }]);
  };

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const ws = await ops<{ workspace_id: string }>('workspaces:create', { name: name.trim() });
      if (desc.trim()) {
        await ops('workspaces:update', { workspace_id: ws.workspace_id, description: desc.trim() });
      }
      for (const inv of invited) {
        await ops('workspace_members:add', { workspace_id: ws.workspace_id, user_id: inv.u, role: inv.role });
      }
      await qc.invalidateQueries({ queryKey: qk.workspacesOverview() });
      onCreated();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 220, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 20px 20px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)', opacity: shown ? 1 : 0, transition: 'opacity .2s' }} />
      <div style={{ position: 'relative', width: 500, maxWidth: '100%', maxHeight: '84vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 16, boxShadow: '0 28px 80px rgba(0,0,0,0.5)', overflow: 'hidden', transform: shown ? 'none' : 'translateY(10px) scale(.98)', opacity: shown ? 1 : 0, transition: 'all .22s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={19} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>New workspace</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 1 }}>You'll be the owner.</div>
          </div>
          <button onClick={onClose} style={{ ...iconBtn(), width: 32, height: 32 }} title="Close"><Icon name="x" size={16} color="var(--fg-muted)" /></button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Workspace name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. marketing" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Description <span style={{ color: 'var(--fg-faint)', fontWeight: 400 }}>· optional</span></label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What is this workspace for?" rows={2} style={{ ...inputStyle, height: 'auto', padding: '9px 12px', resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          <label style={labelStyle}>Members</label>
          <div style={{ marginBottom: 10 }}>
            <AddPersonBar candidates={candidates} levelOptions={roleOpts} defaultLevel="member" placeholder="Enter email or name" onAdd={onAdd} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 9, background: 'var(--surface-2)' }}>
              <Avatar u={me?.user_id ?? '?'} label={me?.display_name || me?.email || 'You'} size={26} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{me?.display_name || me?.email || 'You'} <span style={{ fontSize: 10.5, color: 'var(--fg-muted)', fontWeight: 400 }}>you</span></span>
              </span>
              <RoleBadge role="Owner" />
              <span style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-faint)' }} title="The owner can't be removed"><Icon name="key" size={13} color="var(--fg-faint)" /></span>
            </div>
            {invited.map((i) => (
              <div key={i.u} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 9, background: 'var(--surface-2)' }}>
                <Avatar u={i.u} label={i.name} size={26} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{i.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)' }}>{i.email}</span>
                </span>
                <RoleBadge role={i.role === 'admin' ? 'Admin' : 'Member'} />
                <button onClick={() => setInvited(invited.filter((x) => x.u !== i.u))} style={{ ...iconBtn(), width: 26, height: 26, border: 'none' }} title="Remove"><Icon name="x" size={13} color="var(--fg-muted)" /></button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={onClose} style={sbtn()}>Cancel</button>
          <button disabled={!name.trim() || busy} onClick={create} style={{ ...sbtn('primary'), opacity: (name.trim() && !busy) ? 1 : 0.5 }}>{busy ? 'Creating...' : 'Create workspace'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
