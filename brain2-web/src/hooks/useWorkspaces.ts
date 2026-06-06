// brain2-web/src/hooks/useWorkspaces.ts
import { useQuery } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { Workspace, Project } from '@/lib/types';

export function useWorkspaces() {
  return useQuery({
    queryKey: qk.workspaces(),
    queryFn: () => ops<{ workspaces: Workspace[] }>('workspaces:list')
      .then(r => r.workspaces),
  });
}

export function useProjects(workspaceId: string | null) {
  return useQuery({
    queryKey: qk.projects(workspaceId),
    queryFn: () => ops<{ projects: Project[] }>('list_projects',
      workspaceId ? { workspace_id: workspaceId } : {}).then(r => r.projects),
    enabled: workspaceId !== null,
  });
}
