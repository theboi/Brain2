// brain2-web/src/lib/types.ts

export interface Workspace {
  workspace_id: string;
  name: string;
  created_at: string;
  vault_count: number;
}

export interface Project {
  project_id: string;
  name: string;
  workspace_id: string | null;
  vault_path: string | null;
}

export interface VaultPage {
  path: string;
  topic: string;
  zone: 'wiki' | 'static' | 'dynamic' | 'control' | 'raw';
  tldr: string | null;
  content: string;
}

export interface VaultGraphNode { topic: string; zone: string; tldr: string | null; }
export interface VaultGraphEdge { source: string; target: string; target_zone: string; }
export interface VaultGraph { nodes: VaultGraphNode[]; edges: VaultGraphEdge[]; }

export interface VaultCommit {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export interface SourceRow {
  source_id: string;
  project_id: string;
  kind: 'file' | 'url' | 'text';
  filename: string | null;
  mime: string | null;
  size_bytes: number;
  topic: string | null;
  folder_id: string | null;
  status: 'pending' | 'extracting' | 'extracted' | 'failed' | 'deleted';
  extraction_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceEvent {
  type: 'source_status' | 'source_created' | 'heartbeat';
  source_id?: string;
  status?: SourceRow['status'];
  filename?: string;
  kind?: SourceRow['kind'];
  progress?: number;
}

export interface MeResponse {
  user_id: string;
  tenant_id: string;
  role: string;
  display_name: string | null;
  email: string | null;
  must_change_password: boolean;
}

export interface TenantUser {
  user_id: string;
  email: string;
  role: string;
  display_name: string | null;
}

export interface UserAccess {
  user_id: string;
  role: string;
  workspaces: Array<{ workspace_id: string; name: string; role: string }>;
  guest_vaults: Array<{ project_id: string; name: string; workspace_id: string; workspace_name: string; role: string }>;
}

export interface WorkspaceMember {
  user_id: string;
  email: string;
  display_name: string | null;
  role: string;
}

export interface VaultAccessEntry {
  user_id: string;
  email: string;
  display_name: string | null;
  role: string;
  source: 'owner' | 'workspace_admin' | 'workspace_member' | 'guest';
}

export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type VaultMode = 'wiki' | 'static' | 'dynamic';

export interface OverviewMember {
  user_id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'member';
}

export interface OverviewVault {
  project_id: string;
  name: string;
  mode: VaultMode;
  source_count: number;
  updated_at: string;
  archived_at: string | null;
}

export interface OverviewWorkspace {
  workspace_id: string;
  name: string;
  description: string | null;
  archived_at: string | null;
  role: WorkspaceRole;
  members: OverviewMember[];
  vaults: OverviewVault[];
}

export interface WorkspacesOverview {
  can_create: boolean;
  workspaces: OverviewWorkspace[];
}
