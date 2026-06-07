import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SCard } from '@/components/settings/SettingsCard';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceMembers, useAddMember, useSetMemberRole, useRemoveMember } from '@/hooks/members';
import { useTenantUsers } from '@/hooks/people';
import { useMe } from '@/hooks/me';

function initials(name: string | null, email: string): string {
  if (name) return name[0].toUpperCase();
  return email[0].toUpperCase();
}

function displayName(name: string | null, email: string): string {
  return name ?? email;
}

export function MembersSection() {
  const { workspaceId } = useWorkspace();
  const { data: members = [], isLoading } = useWorkspaceMembers(workspaceId);
  const { data: allUsers = [] } = useTenantUsers();
  const { data: me } = useMe();
  const addMember = useAddMember(workspaceId);
  const setRole = useSetMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);

  const [showAdd, setShowAdd] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState('member');
  const [addError, setAddError] = useState<string | null>(null);

  const availableUsers = allUsers.filter(u => !members.some(m => m.user_id === u.user_id));

  function handleAdd() {
    if (!workspaceId || !addUserId) return;
    setAddError(null);
    addMember.mutate(
      { workspace_id: workspaceId, user_id: addUserId, role: addRole },
      {
        onSuccess: () => {
          setShowAdd(false);
          setAddUserId('');
          setAddRole('member');
        },
        onError: (err: unknown) => {
          setAddError(err instanceof Error ? err.message : 'Failed to add member');
        },
      }
    );
  }

  if (!workspaceId) {
    return (
      <div>
        <SCard title="Members" desc="People with access to this workspace.">
          <p style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
            Select a workspace to manage members.
          </p>
        </SCard>
      </div>
    );
  }

  return (
    <div>
      <SCard
        title="Members"
        desc="People with access to this workspace. Roles map to the operations each member can call."
        action={
          <Button variant="primary" icon="plus" onClick={() => setShowAdd(s => !s)}>
            Add member
          </Button>
        }
      >
        {showAdd && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 14px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <select
              style={{
                flex: 1, height: 30, padding: '0 8px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', background: 'var(--bg)',
                color: 'var(--fg)', fontSize: 12.5, cursor: 'pointer',
                fontFamily: 'var(--ui-font)',
              }}
              value={addUserId}
              onChange={e => setAddUserId(e.target.value)}
            >
              <option value="">Select a user…</option>
              {availableUsers.map(u => (
                <option key={u.user_id} value={u.user_id}>
                  {u.display_name ? `${u.display_name} (${u.email})` : u.email}
                </option>
              ))}
            </select>
            <select
              style={{
                height: 30, padding: '0 8px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', background: 'var(--bg)',
                color: 'var(--fg)', fontSize: 12.5, cursor: 'pointer',
                fontFamily: 'var(--ui-font)',
              }}
              value={addRole}
              onChange={e => setAddRole(e.target.value)}
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
            <Button
              variant="primary"
              onClick={handleAdd}
              disabled={!addUserId || addMember.isPending}
            >
              {addMember.isPending ? 'Adding…' : 'Add'}
            </Button>
            <Button variant="ghost" onClick={() => { setShowAdd(false); setAddError(null); }}>
              Cancel
            </Button>
          </div>
        )}
        {addError && (
          <p style={{ fontSize: 12, color: 'var(--danger)', margin: '4px 0 8px' }}>{addError}</p>
        )}

        {isLoading && (
          <p style={{ fontSize: 13, color: 'var(--fg-muted)', padding: '12px 0' }}>Loading…</p>
        )}

        {!isLoading && members.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--fg-muted)', padding: '12px 0' }}>
            No members yet.
          </p>
        )}

        {members.map((m, i) => (
          <div
            key={m.user_id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0',
              borderBottom: i === members.length - 1 ? 'none' : '1px solid var(--border)',
            }}
          >
            <span
              style={{
                width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-2)',
                color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 600, flexShrink: 0,
              }}
            >
              {initials(m.display_name, m.email)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13.5, fontWeight: 600, color: 'var(--fg)',
                  display: 'flex', alignItems: 'center', gap: 7,
                }}
              >
                {displayName(m.display_name, m.email)}
                {m.user_id === me?.user_id && (
                  <span style={{ fontSize: 10.5, color: 'var(--fg-muted)' }}>you</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{m.email}</div>
            </div>
            <select
              style={{
                height: 30, padding: '0 8px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', background: 'var(--bg)',
                color: 'var(--fg)', fontSize: 12.5, cursor: 'pointer',
                fontFamily: 'var(--ui-font)',
              }}
              value={m.role}
              onChange={e =>
                setRole.mutate({ workspace_id: workspaceId, user_id: m.user_id, role: e.target.value })
              }
              disabled={m.user_id === me?.user_id}
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
            <button
              style={{
                width: 30, height: 30, display: 'flex', alignItems: 'center',
                justifyContent: 'center', border: 'none', background: 'transparent',
                cursor: m.user_id === me?.user_id ? 'default' : 'pointer',
                borderRadius: 7,
                opacity: m.user_id === me?.user_id ? 0.35 : 1,
                fontSize: 18, color: 'var(--fg-muted)', lineHeight: 1,
              }}
              disabled={m.user_id === me?.user_id}
              title="Remove member"
              onClick={() =>
                removeMember.mutate({ workspace_id: workspaceId, user_id: m.user_id })
              }
            >
              ×
            </button>
          </div>
        ))}
      </SCard>
    </div>
  );
}
