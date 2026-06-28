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
  url?: string | null;
  mime: string | null;
  size_bytes: number;
  topic: string | null;
  folder_id: string | null;
  status: 'pending' | 'queued' | 'extracting' | 'processing' | 'extracted' | 'done' | 'failed' | 'deleted';
  tags?: string[];
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
  last_seen_at?: string | null;
}

export interface TenantUser {
  user_id: string;
  email: string;
  role: string;
  status: string;
  display_name: string | null;
  last_seen_at: string | null;
  invited: boolean;
}

export interface UserDirectoryEntry {
  user_id: string;
  email: string;
  display_name: string | null;
}

export interface UserWorkspaceAccess {
  workspace_id: string;
  name: string;
  role: string;
}

export interface InheritedWorkspaceAccess extends UserWorkspaceAccess {
  via: string;
  via_id: string;
}

export interface UserAccess {
  user_id: string;
  role: string;
  workspaces: UserWorkspaceAccess[];
  inherited_workspaces: InheritedWorkspaceAccess[];
  guest_vaults: Array<{ project_id: string; name: string; workspace_id: string; workspace_name: string; role: string }>;
}

export interface InviteResult {
  user_id: string;
  email: string;
  role?: string;
  token: string;
}

export interface GroupMember {
  user_id: string;
  email: string | null;
  display_name: string | null;
}

export interface GroupWorkspaceRole {
  workspace_id: string;
  name: string;
  role: 'admin' | 'member';
}

export interface GroupVaultGrant {
  project_id: string;
  name: string;
  role: 'viewer' | 'editor' | 'admin';
}

export interface GroupDetail {
  group_id: string;
  name: string;
  created_at: string;
  members: GroupMember[];
  workspace_roles: GroupWorkspaceRole[];
  vault_grants: GroupVaultGrant[];
}

export interface GuestVault {
  project_id: string;
  name: string;
  role: 'viewer' | 'editor' | 'admin';
}

export interface Guest {
  user_id: string;
  email: string | null;
  display_name: string | null;
  last_seen_at: string | null;
  invited: boolean;
  vaults: GuestVault[];
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

export interface ModelConfig {
  model_id: string;
  name: string;
  provider: 'anthropic' | 'gemini' | 'ollama' | 'openai' | 'stub';
  model: string;
  param_count: string | null;
  system_prompt: string;
  tool_allowlist: string[];
  fallback_model: string | null;
  ollama_base_url: string | null;
  status: 'ready' | 'paused' | 'disabled';
}

export interface Worker {
  agent_id: string;
  name: string;
  status: 'idle' | 'busy' | 'offline';
  current_todo_id: string | null;
  todo_summary: { todo_id: string; title: string } | null;
}

export interface LiveTodo {
  todo_id: string;
  tenant_id: string;
  workspace_id: string;
  requester_user_id: string;
  title: string;
  priority: number;
  status: 'queued' | 'running' | 'done';
  assigned_agent_id: string | null;
  preferred_agent_id: string | null;
  model_pref: string | null;
  conversation_id: string | null;
  memory_flushed: number;
  tokens_total: number | null;
  cost_total: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface TodoMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string | null;
  created_at?: string;
}

export interface OrgGraphResponse {
  workspaces: Array<{
    id: string;
    name: string;
    vaults: Array<{ id: string; name: string; mode: VaultMode; items: number }>;
  }>;
  vault_pages: Record<string, { pages: string[]; links: [string, string][] }>;
  vault_sources: Record<string, Array<{
    id: string;
    name: string;
    mime: string | null;
    kind: string | null;
    cites: string[];
  }>>;
  people: Record<string, { name: string; email: string | null }>;
  members: Array<{ u: string; owner?: boolean; invited?: boolean; ws: Array<{ w: string; role: string }> }>;
  groups: Array<{ id: string; name: string; ws: Array<{ w: string; role: string }>; vaults?: Array<{ v: string; level: string }>; members: string[] }>;
  guests: Array<{ u: string; vaults: Array<{ v: string; level: string }> }>;
}

export interface VaultGraphResponse {
  vault: { id: string; name: string; mode: VaultMode };
  pages: string[];
  links: [string, string][];
  sources: OrgGraphResponse['vault_sources'][string];
}
