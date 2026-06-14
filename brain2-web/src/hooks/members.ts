// brain2-web/src/hooks/members.ts
import { ops } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queryClient';
import type { WorkspaceMember } from '@/lib/types';

export function useWorkspaceMembers(workspaceId: string | null) {
  return useQuery({
    queryKey: workspaceId ? qk.workspaceMembers(workspaceId) : ['workspace-members', '_'],
    queryFn: () => ops<{ members: WorkspaceMember[] }>('workspace_members:list',
      { workspace_id: workspaceId }).then(r => r.members),
    enabled: !!workspaceId,
  });
}

export function useAddMember(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { workspace_id: string; user_id: string; role: string }) =>
      ops('workspace_members:add', params),
    onSuccess: () => {
      if (workspaceId) qc.invalidateQueries({ queryKey: qk.workspaceMembers(workspaceId) });
      qc.invalidateQueries({ queryKey: ['user-access'] });
      qc.invalidateQueries({ queryKey: qk.workspacesOverview() });
      qc.invalidateQueries({ queryKey: qk.orgGraph() });
    },
  });
}

export function useSetMemberRole(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { workspace_id: string; user_id: string; role: string }) =>
      ops('workspace_members:set_role', params),
    onSuccess: () => {
      if (workspaceId) qc.invalidateQueries({ queryKey: qk.workspaceMembers(workspaceId) });
      qc.invalidateQueries({ queryKey: ['user-access'] });
      qc.invalidateQueries({ queryKey: qk.workspacesOverview() });
      qc.invalidateQueries({ queryKey: qk.orgGraph() });
    },
  });
}

export function useRemoveMember(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { workspace_id: string; user_id: string }) =>
      ops('workspace_members:remove', params),
    onSuccess: () => {
      if (workspaceId) qc.invalidateQueries({ queryKey: qk.workspaceMembers(workspaceId) });
      qc.invalidateQueries({ queryKey: ['user-access'] });
      qc.invalidateQueries({ queryKey: qk.workspacesOverview() });
      qc.invalidateQueries({ queryKey: qk.orgGraph() });
    },
  });
}
