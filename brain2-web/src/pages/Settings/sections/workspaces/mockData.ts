/*
 * Mock data + capability model for the Workspaces settings page
 * (visual port of workspaces.jsx + workspaces-panels.jsx).
 *
 * Placeholder data and an in-memory role model — the page will be wired to
 * workspaces / members / vaults / access ops later. The current mock user is
 * "alice".
 */
import type { IconName } from '@/components/ui/Icon';

export type Role = 'Owner' | 'Admin' | 'Editor' | 'Viewer';
export type VaultMode = 'wiki' | 'static' | 'dynamic';
export type Pov = 'owner' | 'admin' | 'member';
export type AccessLevelId = 'none' | 'read' | 'write' | 'admin';

export interface Member {
  u: string;
  role: Role;
  status?: 'invited';
}

export interface VaultAccess {
  u: string;
  level: AccessLevelId;
}

export interface Vault {
  id: string;
  name: string;
  mode: VaultMode;
  items: number;
  updated: string;
  desc?: string;
  access?: VaultAccess[];
}

export interface Workspace {
  id: string;
  name: string;
  adminOf: boolean;
  private?: boolean;
  desc?: string;
  members: Member[];
  vaults: Vault[];
}

export interface Person { name: string; email: string }

export const WS_PEOPLE: Record<string, Person> = {
  alice: { name: 'Alice Chen', email: 'alice@brain2.dev' },
  bob: { name: 'Bob Ng', email: 'bob@brain2.dev' },
  carol: { name: 'Carol Diaz', email: 'carol@brain2.dev' },
  dan: { name: 'Dan Park', email: 'dan@brain2.dev' },
  eve: { name: 'Eve Liu', email: 'eve@brain2.dev' },
  frank: { name: 'Frank Oyelaran', email: 'frank@brain2.dev' },
  grace: { name: 'Grace Kim', email: 'grace@brain2.dev' },
  henry: { name: 'Henry Voss', email: 'henry@brain2.dev' },
};

export const CURRENT_USER = 'alice';

export const ROLE_ORDER: Role[] = ['Owner', 'Admin', 'Editor', 'Viewer'];
export const ROLE_DESC: Record<Role, string> = {
  Owner: 'Full control of the workspace and its vaults.',
  Admin: 'Manage members and vaults. Cannot delete the workspace.',
  Editor: 'Read and write vault contents.',
  Viewer: 'Read-only access to vaults.',
};

export const MODE_ICON: Record<VaultMode, IconName> = { wiki: 'wand', static: 'file', dynamic: 'layers' };
export const MODE_LABEL: Record<VaultMode, string> = { wiki: 'Wiki', static: 'Static', dynamic: 'Dynamic' };

export const VAULT_MODE_OPTS: { id: VaultMode; label: string; icon: IconName; desc: string }[] = [
  { id: 'wiki', label: 'Wiki', icon: 'wand', desc: 'LLM-summarised wiki pages' },
  { id: 'static', label: 'Static', icon: 'file', desc: 'Stored as-is, no rewriting' },
  { id: 'dynamic', label: 'Dynamic', icon: 'layers', desc: 'Linked live database' },
];

export const ACCESS_LEVELS: { id: AccessLevelId; label: string; icon: IconName }[] = [
  { id: 'none', label: 'No access', icon: 'x' },
  { id: 'read', label: 'Read only', icon: 'file' },
  { id: 'write', label: 'Read & write', icon: 'pencil' },
  { id: 'admin', label: 'Admin', icon: 'shield' },
];

export const POVS: { id: Pov; label: string; icon: IconName; blurb: string }[] = [
  { id: 'owner', label: 'Owner', icon: 'shield', blurb: 'Full control everywhere — create or delete workspaces, move any vault, and add admins or members to any workspace.' },
  { id: 'admin', label: 'Admin', icon: 'user', blurb: "Manage only the workspaces you administer — their members and vaults. You can't create or delete workspaces. Others appear read-only." },
  { id: 'member', label: 'Member', icon: 'users', blurb: "A read-only view. Browse the workspaces and vaults you belong to; you can't move vaults or change access." },
];

export interface Caps {
  canManageMembers: boolean;
  canManageVaults: boolean;
  canMoveVaults: boolean;
  canAddAdmins: boolean;
  canDelete: boolean;
  readOnly: boolean;
}

const RO: Caps = { canManageMembers: false, canManageVaults: false, canMoveVaults: false, canAddAdmins: false, canDelete: false, readOnly: true };

export function wsCaps(pov: Pov, ws: Workspace): Caps {
  if (pov === 'owner') return { canManageMembers: true, canManageVaults: true, canMoveVaults: true, canAddAdmins: true, canDelete: true, readOnly: false };
  if (pov === 'admin') {
    return ws.adminOf
      ? { canManageMembers: true, canManageVaults: true, canMoveVaults: true, canAddAdmins: false, canDelete: false, readOnly: false }
      : RO;
  }
  return RO;
}

export function myRole(pov: Pov, ws: Workspace): Role {
  if (pov === 'owner') return 'Owner';
  const m = ws.members.find((x) => x.u === CURRENT_USER);
  if (pov === 'admin') return ws.adminOf ? 'Admin' : (m ? m.role : 'Viewer');
  return 'Viewer';
}

export const INITIAL_WS: Workspace[] = [
  {
    id: 'default', name: 'default', adminOf: true,
    members: [
      { u: 'alice', role: 'Owner' }, { u: 'bob', role: 'Admin' }, { u: 'carol', role: 'Editor' }, { u: 'dan', role: 'Viewer', status: 'invited' },
    ],
    vaults: [
      { id: 'v_general', name: 'General', mode: 'wiki', items: 142, updated: '2h ago' },
      { id: 'v_fin', name: 'Q2 Financials', mode: 'static', items: 38, updated: '1d ago' },
      { id: 'v_handbook', name: 'Company Handbook', mode: 'wiki', items: 64, updated: '5h ago' },
    ],
  },
  {
    id: 'research-q3', name: 'research-q3', adminOf: true,
    members: [
      { u: 'alice', role: 'Admin' }, { u: 'carol', role: 'Editor' }, { u: 'frank', role: 'Editor' },
    ],
    vaults: [
      { id: 'v_research', name: 'User Research', mode: 'wiki', items: 98, updated: '3h ago' },
      { id: 'v_launch', name: 'Launch Docs', mode: 'static', items: 34, updated: '2d ago' },
    ],
  },
  {
    id: 'engineering', name: 'engineering', adminOf: false,
    members: [
      { u: 'bob', role: 'Owner' }, { u: 'grace', role: 'Admin' }, { u: 'alice', role: 'Viewer' }, { u: 'henry', role: 'Editor' },
    ],
    vaults: [
      { id: 'v_gateway', name: 'LLM Gateway', mode: 'dynamic', items: 21, updated: '12m ago' },
      { id: 'v_runbooks', name: 'Infra Runbooks', mode: 'wiki', items: 47, updated: '1d ago' },
      { id: 'v_archive', name: 'Archive', mode: 'static', items: 212, updated: '30d ago' },
    ],
  },
  {
    id: 'personal', name: 'personal', adminOf: true, private: true,
    members: [{ u: 'alice', role: 'Owner' }],
    vaults: [
      { id: 'v_notes', name: 'Personal Notes', mode: 'wiki', items: 16, updated: '4h ago' },
    ],
  },
];
