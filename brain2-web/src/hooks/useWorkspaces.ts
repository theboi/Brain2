// brain2-web/src/hooks/useWorkspaces.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { Workspace, Project, UserDirectoryEntry, WorkspacesOverview } from '@/lib/types';

export function useWorkspaces() {
  return useQuery({
    queryKey: qk.workspaces(),
    queryFn: () => ops<{ workspaces: Workspace[] }>('workspaces:list')
      .then((r) => r.workspaces),
  });
}

export function useProjects(workspaceId: string | null) {
  return useQuery({
    queryKey: qk.projects(workspaceId),
    queryFn: () => ops<{ projects: Project[] }>(
      'list_projects',
      workspaceId ? { workspace_id: workspaceId } : {},
    ).then((r) => r.projects),
    enabled: workspaceId !== null,
  });
}

export function useWorkspacesOverview() {
  return useQuery({
    queryKey: qk.workspacesOverview(),
    queryFn: () => ops<WorkspacesOverview>('workspaces:overview'),
  });
}

export function useUserDirectory(workspaceId: string | null) {
  return useQuery({
    queryKey: qk.userDirectory(workspaceId),
    queryFn: () => ops<{ users: UserDirectoryEntry[] }>(
      'users:directory',
      { workspace_id: workspaceId },
    ).then((r) => r.users),
    enabled: workspaceId !== null,
  });
}

function useOverviewMutation<P extends object>(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: P) => ops(name, params),
    onSuccess: () => {
      // The overview board is the primary view, but vault moves / renames /
      // archives also change the per-workspace project lists that the Wiki and
      // Sources pages read (qk.projects) and the workspace list (qk.workspaces).
      // Invalidate all three so those surfaces reflect the change immediately.
      qc.invalidateQueries({ queryKey: qk.workspacesOverview() });
      qc.invalidateQueries({ queryKey: qk.workspaces() });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export const useCreateWorkspace = () =>
  useOverviewMutation<{ name: string }>('workspaces:create');

export const useUpdateWorkspace = () =>
  useOverviewMutation<{ workspace_id: string; name?: string; description?: string }>('workspaces:update');

export const useArchiveWorkspace = () =>
  useOverviewMutation<{ workspace_id: string }>('workspaces:archive');

export const useDeleteWorkspace = () =>
  useOverviewMutation<{ workspace_id: string }>('workspaces:delete');

export const useMoveVault = () =>
  useOverviewMutation<{ project_id: string; workspace_id: string }>('projects:move');

export const useSetVaultMode = () =>
  useOverviewMutation<{ project_id: string; mode: string }>('projects:set_mode');

export const useRenameVault = () =>
  useOverviewMutation<{ project_id: string; name: string }>('projects:rename');

export const useArchiveVault = () =>
  useOverviewMutation<{ project_id: string }>('projects:archive');

export const useCreateVault = () =>
  useOverviewMutation<{ name: string; workspace_id: string }>('create_project');
