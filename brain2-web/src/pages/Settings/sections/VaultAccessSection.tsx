import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SCard } from '@/components/settings/SettingsCard';
import { RoleBadge } from '@/components/settings/SettingsCard';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useProjects } from '@/hooks/useWorkspaces';
import { useVaultAccess, useAddGuest, useSetGuestRole, useRemoveGuest } from '@/hooks/access';
import { useTenantUsers } from '@/hooks/people';

const SELECT_STYLE: React.CSSProperties = {
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
  cursor: 'pointer',
};

const ROLE_SELECT_STYLE: React.CSSProperties = {
  height: 28,
  padding: '0 6px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontSize: 12.5,
  fontFamily: 'var(--ui-font)',
};

export function VaultAccessSection() {
  const { workspaceId, projectId: ctxProjectId } = useWorkspace();
  const { data: projects = [] } = useProjects(workspaceId);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(ctxProjectId);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState('viewer');
  const [addError, setAddError] = useState<string | null>(null);

  const projectId = selectedProjectId;

  const { data: access = [], isLoading: accessLoading } = useVaultAccess(projectId);
  const { data: allUsers = [] } = useTenantUsers();

  const addGuest = useAddGuest(projectId);
  const setGuestRole = useSetGuestRole(projectId);
  const removeGuest = useRemoveGuest(projectId);

  if (!workspaceId) {
    return (
      <SCard title="Vault Access" desc="Manage who can access each vault.">
        <p style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Select a workspace first.</p>
      </SCard>
    );
  }

  if (projects.length === 0) {
    return (
      <SCard title="Vault Access" desc="Manage who can access each vault.">
        <p style={{ fontSize: 13, color: 'var(--fg-muted)' }}>No vaults found in this workspace.</p>
      </SCard>
    );
  }

  const inherited = access.filter(e => e.source !== 'guest');
  const guests = access.filter(e => e.source === 'guest');

  const availableUsers = allUsers.filter(u => !access.some(a => a.user_id === u.user_id));

  async function handleAddGuest(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!projectId || !addUserId) return;
    try {
      await addGuest.mutateAsync({ project_id: projectId, user_id: addUserId, role: addRole });
      setAddUserId('');
      setAddRole('viewer');
      setShowAddForm(false);
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : 'Failed to add guest.');
    }
  }

  return (
    <div>
      {/* Vault picker */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)', marginBottom: 5 }}>
          Vault
        </label>
        <select
          value={selectedProjectId ?? ''}
          onChange={e => {
            setSelectedProjectId(e.target.value || null);
            setShowAddForm(false);
            setAddError(null);
          }}
          style={{ ...SELECT_STYLE, width: 280 }}
        >
          <option value="">— select a vault —</option>
          {projects.map(p => (
            <option key={p.project_id} value={p.project_id}>{p.name}</option>
          ))}
        </select>
      </div>

      {!projectId ? (
        <SCard title="Vault Access" desc="Manage who can access each vault.">
          <p style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Select a vault above to manage its access.</p>
        </SCard>
      ) : (
        <SCard
          title="Vault Access"
          desc="Manage who can access each vault."
          action={
            <Button
              variant="primary"
              icon="plus"
              onClick={() => { setShowAddForm(f => !f); setAddError(null); }}
            >
              Add guest
            </Button>
          }
        >
          {accessLoading ? (
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', padding: '8px 0' }}>Loading…</div>
          ) : (
            <>
              {/* Inherited rows */}
              {inherited.length > 0 && (
                <div style={{ marginBottom: guests.length > 0 ? 12 : 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 6 }}>
                    Inherited
                  </div>
                  {inherited.map((entry, i) => (
                    <div
                      key={entry.user_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '11px 0',
                        borderBottom: i < inherited.length - 1 ? '1px solid var(--border)' : 'none',
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
                        {(entry.display_name ?? entry.email)[0].toUpperCase()}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{entry.display_name ?? entry.email}</div>
                        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{entry.email}</div>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--fg-faint)', background: 'var(--surface-2)', padding: '2px 7px', borderRadius: 20, marginRight: 6 }}>
                        via workspace
                      </span>
                      <RoleBadge role={entry.role === 'admin' ? 'Admin' : entry.role === 'owner' ? 'Owner' : entry.role === 'editor' ? 'Editor' : 'Viewer'} />
                    </div>
                  ))}
                </div>
              )}

              {/* Guest rows */}
              {guests.length > 0 && (
                <div>
                  {inherited.length > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 6, marginTop: 12 }}>
                      Guests
                    </div>
                  )}
                  {guests.map((entry, i) => (
                    <div
                      key={entry.user_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '11px 0',
                        borderBottom: i < guests.length - 1 ? '1px solid var(--border)' : 'none',
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
                        {(entry.display_name ?? entry.email)[0].toUpperCase()}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{entry.display_name ?? entry.email}</div>
                        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{entry.email}</div>
                      </div>
                      <select
                        value={entry.role}
                        onChange={e => setGuestRole.mutate({ project_id: projectId!, user_id: entry.user_id, role: e.target.value })}
                        style={ROLE_SELECT_STYLE}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>
                      <Button
                        variant="ghost"
                        onClick={() => removeGuest.mutate({ project_id: projectId!, user_id: entry.user_id })}
                      >
                        Revoke
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {inherited.length === 0 && guests.length === 0 && !showAddForm && (
                <p style={{ fontSize: 13, color: 'var(--fg-muted)', margin: 0 }}>No access entries yet.</p>
              )}
            </>
          )}

          {/* Add guest form */}
          {showAddForm && (
            <form
              onSubmit={handleAddGuest}
              style={{
                marginTop: access.length > 0 ? 16 : 0,
                paddingTop: access.length > 0 ? 16 : 0,
                borderTop: access.length > 0 ? '1px solid var(--border)' : 'none',
                display: 'flex',
                gap: 8,
                alignItems: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)', marginBottom: 5 }}>
                  User
                </label>
                <select
                  required
                  value={addUserId}
                  onChange={e => setAddUserId(e.target.value)}
                  style={{ ...SELECT_STYLE, width: '100%' }}
                >
                  <option value="">Select a user…</option>
                  {availableUsers.map(u => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.display_name ?? u.email} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)', marginBottom: 5 }}>
                  Role
                </label>
                <select
                  value={addRole}
                  onChange={e => setAddRole(e.target.value)}
                  style={{ ...SELECT_STYLE, width: 120 }}
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setShowAddForm(false); setAddUserId(''); setAddRole('viewer'); setAddError(null); }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!addUserId || addGuest.isPending}
                >
                  {addGuest.isPending ? 'Adding…' : 'Add guest'}
                </Button>
              </div>
              {addError && (
                <p style={{ width: '100%', margin: 0, fontSize: 12, color: 'var(--danger, #e53e3e)' }}>{addError}</p>
              )}
            </form>
          )}
        </SCard>
      )}
    </div>
  );
}
