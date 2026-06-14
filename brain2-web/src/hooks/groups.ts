import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { GroupDetail } from '@/lib/types';

function invalidateGroups(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.groups() });
  qc.invalidateQueries({ queryKey: ['user-access'] });
  qc.invalidateQueries({ queryKey: qk.orgGraph() });
}

export function useGroups() {
  return useQuery({
    queryKey: qk.groups(),
    queryFn: () => ops<{ groups: GroupDetail[] }>('groups:list').then((r) => r.groups),
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { name: string }) => ops<GroupDetail>('groups:create', params),
    onSuccess: () => invalidateGroups(qc),
  });
}

export function useRenameGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { group_id: string; name: string }) =>
      ops<GroupDetail>('groups:rename', params),
    onSuccess: () => invalidateGroups(qc),
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { group_id: string }) => ops<{ deleted: boolean }>('groups:delete', params),
    onSuccess: () => invalidateGroups(qc),
  });
}

export function useAddGroupMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { group_id: string; user_id: string }) =>
      ops<GroupDetail>('groups:add_member', params),
    onSuccess: () => invalidateGroups(qc),
  });
}

export function useRemoveGroupMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { group_id: string; user_id: string }) =>
      ops<GroupDetail>('groups:remove_member', params),
    onSuccess: () => invalidateGroups(qc),
  });
}

export function useSetGroupWorkspaceRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { group_id: string; workspace_id: string; role: 'admin' | 'member' }) =>
      ops<GroupDetail>('groups:set_workspace_role', params),
    onSuccess: () => invalidateGroups(qc),
  });
}

export function useRemoveGroupWorkspaceRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { group_id: string; workspace_id: string }) =>
      ops<GroupDetail>('groups:remove_workspace_role', params),
    onSuccess: () => invalidateGroups(qc),
  });
}

export function useSetGroupVaultRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { group_id: string; project_id: string; role: 'viewer' | 'editor' | 'admin' }) =>
      ops<GroupDetail>('groups:set_vault_role', params),
    onSuccess: () => invalidateGroups(qc),
  });
}

export function useRemoveGroupVaultRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { group_id: string; project_id: string }) =>
      ops<GroupDetail>('groups:remove_vault_role', params),
    onSuccess: () => invalidateGroups(qc),
  });
}
