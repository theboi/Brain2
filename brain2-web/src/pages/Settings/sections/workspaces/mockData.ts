/*
 * Display constants + capability model for the Workspaces settings page.
 * Formerly mock data; now wired to live workspaces:overview. Capabilities are
 * derived from the caller's effective workspace role; the server re-checks.
 */
import type { IconName } from '@/components/ui/Icon';
import type { WorkspaceRole, VaultMode } from '@/lib/types';

export type { WorkspaceRole, VaultMode } from '@/lib/types';

export type AccessLevelId = 'read' | 'write' | 'admin';

export const LEVEL_TO_ROLE: Record<AccessLevelId, 'viewer' | 'editor' | 'admin'> = {
  read: 'viewer',
  write: 'editor',
  admin: 'admin',
};

export const ROLE_TO_LEVEL: Record<string, AccessLevelId> = {
  owner: 'admin',
  viewer: 'read',
  editor: 'write',
  admin: 'admin',
};

export const ROLE_DESC: Record<string, string> = {
  Owner: 'Full control of the workspace and its vaults.',
  Admin: 'Manage members and vaults. Cannot delete the workspace.',
  Member: 'Access the workspace and its vaults.',
};

export function roleLabel(role: WorkspaceRole): 'Owner' | 'Admin' | 'Member' {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Member';
}

export const MODE_ICON: Record<VaultMode, IconName> = {
  wiki: 'wand',
  static: 'file',
  dynamic: 'layers',
};

export const MODE_LABEL: Record<VaultMode, string> = {
  wiki: 'Wiki',
  static: 'Static',
  dynamic: 'Dynamic',
};

export const VAULT_MODE_OPTS: { id: VaultMode; label: string; icon: IconName; desc: string }[] = [
  { id: 'wiki', label: 'Wiki', icon: 'wand', desc: 'LLM-summarised wiki pages' },
  { id: 'static', label: 'Static', icon: 'file', desc: 'Stored as-is, no rewriting' },
  { id: 'dynamic', label: 'Dynamic', icon: 'layers', desc: 'Linked live database' },
];

export const ACCESS_LEVELS: { id: AccessLevelId; label: string; icon: IconName }[] = [
  { id: 'read', label: 'Read only', icon: 'file' },
  { id: 'write', label: 'Read & write', icon: 'pencil' },
  { id: 'admin', label: 'Admin', icon: 'shield' },
];

export interface Caps {
  canManageMembers: boolean;
  canManageVaults: boolean;
  canMoveVaults: boolean;
  canAddAdmins: boolean;
  canDelete: boolean;
  readOnly: boolean;
}

const READ_ONLY: Caps = {
  canManageMembers: false,
  canManageVaults: false,
  canMoveVaults: false,
  canAddAdmins: false,
  canDelete: false,
  readOnly: true,
};

export function capsFromRole(role: WorkspaceRole): Caps {
  if (role === 'owner') {
    return {
      canManageMembers: true,
      canManageVaults: true,
      canMoveVaults: true,
      canAddAdmins: true,
      canDelete: true,
      readOnly: false,
    };
  }
  if (role === 'admin') {
    return {
      canManageMembers: true,
      canManageVaults: true,
      canMoveVaults: true,
      canAddAdmins: false,
      canDelete: false,
      readOnly: false,
    };
  }
  return READ_ONLY;
}
