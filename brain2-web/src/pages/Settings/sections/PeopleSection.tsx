import { useState } from 'react';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { SCard } from '@/components/settings/SettingsCard';
import { RoleBadge } from '@/components/settings/SettingsCard';
import { useTenantUsers, useCreateUser, useTransferOwnership } from '@/hooks/people';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useMe } from '@/hooks/me';

function genPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map(b => chars[b % chars.length]).join('');
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  height: 34,
  boxSizing: 'border-box',
  padding: '0 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md, 7px)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontSize: 13,
  fontFamily: 'var(--ui-font)',
  outline: 'none',
};

const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  cursor: 'pointer',
};

export function PeopleSection() {
  const { data: users, isLoading: usersLoading } = useTenantUsers();
  const { data: workspaces } = useWorkspaces();
  const { data: me } = useMe();
  const createUser = useCreateUser();
  const transferOwnership = useTransferOwnership();

  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceRole, setWorkspaceRole] = useState<'admin' | 'member'>('member');
  const [formError, setFormError] = useState<string | null>(null);

  const [transferTarget, setTransferTarget] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);

  function resetForm() {
    setEmail('');
    setDisplayName('');
    setPassword('');
    setWorkspaceId('');
    setWorkspaceRole('member');
    setFormError(null);
  }

  async function handleAddPerson(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await createUser.mutateAsync({
        email,
        display_name: displayName || undefined,
        password,
        role: 'member',
        workspace_id: workspaceId || undefined,
        workspace_role: workspaceId ? workspaceRole : undefined,
      });
      resetForm();
      setShowForm(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create user.');
    }
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    setTransferError(null);
    try {
      await transferOwnership.mutateAsync({ target_user_id: transferTarget, step_down: true });
      setTransferTarget('');
    } catch (err: unknown) {
      setTransferError(err instanceof Error ? err.message : 'Transfer failed.');
    }
  }

  const nonOwners = (users ?? []).filter(u => u.role !== 'owner');

  return (
    <div>
      <SCard
        title="People"
        desc="Tenant members and guests."
        action={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => { setShowForm(f => !f); setFormError(null); }}
          >
            Add person
          </Button>
        }
      >
        {/* User list */}
        {usersLoading ? (
          <div style={{ fontSize: 13, color: 'var(--fg-muted)', padding: '8px 0' }}>Loading…</div>
        ) : (users ?? []).map((u, i) => (
          <div
            key={u.user_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '11px 0',
              borderBottom: i < (users ?? []).length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <span style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: 'var(--surface-2)',
              color: 'var(--fg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 600,
              flexShrink: 0,
            }}>
              {(u.display_name ?? u.email)[0].toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{u.display_name ?? u.email}</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{u.email}</div>
            </div>
            <RoleBadge role={u.role === 'owner' ? 'Owner' : 'Editor'} />
          </div>
        ))}

        {/* Add person form */}
        {showForm && (
          <form
            onSubmit={handleAddPerson}
            style={{
              marginTop: (users ?? []).length > 0 ? 16 : 0,
              paddingTop: (users ?? []).length > 0 ? 16 : 0,
              borderTop: (users ?? []).length > 0 ? '1px solid var(--border)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field
                label="Email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="user@example.com"
                type="email"
              />
              <Field
                label="Display name"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)', marginBottom: 5 }}>
                Temporary password <span style={{ color: 'var(--danger, #e53e3e)' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  required
                  type="text"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Temporary password"
                  style={{ ...INPUT_STYLE, flex: 1 }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setPassword(genPassword())}
                >
                  Generate
                </Button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)', marginBottom: 5 }}>
                  Workspace
                </label>
                <select
                  value={workspaceId}
                  onChange={e => setWorkspaceId(e.target.value)}
                  style={SELECT_STYLE}
                >
                  <option value="">— none —</option>
                  {(workspaces ?? []).map(w => (
                    <option key={w.workspace_id} value={w.workspace_id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)', marginBottom: 5 }}>
                  Workspace role
                </label>
                <select
                  value={workspaceRole}
                  onChange={e => setWorkspaceRole(e.target.value as 'admin' | 'member')}
                  disabled={!workspaceId}
                  style={{ ...SELECT_STYLE, opacity: workspaceId ? 1 : 0.5 }}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            {formError && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--danger, #e53e3e)' }}>{formError}</p>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { resetForm(); setShowForm(false); }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={createUser.isPending}
              >
                {createUser.isPending ? 'Adding…' : 'Add person'}
              </Button>
            </div>
          </form>
        )}

        {/* Guest note */}
        <p style={{ margin: (users ?? []).length > 0 || showForm ? '14px 0 0' : '0', fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          Guest access is managed per vault in the Vault Access section.
        </p>
      </SCard>

      {/* Ownership transfer card — only show when there are non-owners to transfer to */}
      <SCard title="Ownership" desc="Transfer tenant ownership to another member.">
        <form onSubmit={handleTransfer}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <select
                value={transferTarget}
                onChange={e => setTransferTarget(e.target.value)}
                required
                style={SELECT_STYLE}
                disabled={nonOwners.length === 0}
              >
                <option value="">Select a member to transfer to…</option>
                {nonOwners.map(u => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.display_name ?? u.email}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="submit"
              variant="danger"
              disabled={!transferTarget || transferOwnership.isPending || me?.role !== 'owner'}
            >
              {transferOwnership.isPending ? 'Transferring…' : 'Transfer ownership'}
            </Button>
          </div>
          {transferError && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--danger, #e53e3e)' }}>{transferError}</p>
          )}
        </form>
      </SCard>
    </div>
  );
}
