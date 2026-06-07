// brain2-web/src/hooks/access.ts
import { ops } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { VaultAccessEntry } from '@/lib/types';

export function useVaultAccess(projectId: string | null) {
  return useQuery({
    queryKey: ['vault-access', projectId],
    queryFn: () => ops<{ access: VaultAccessEntry[] }>('vault_access:list',
      { project_id: projectId }).then(r => r.access),
    enabled: !!projectId,
  });
}

export function useAddGuest(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { project_id: string; user_id: string; role: string }) =>
      ops('vault_access:add_guest', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vault-access', projectId] }),
  });
}

export function useSetGuestRole(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { project_id: string; user_id: string; role: string }) =>
      ops('vault_access:set_guest_role', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vault-access', projectId] }),
  });
}

export function useRemoveGuest(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { project_id: string; user_id: string }) =>
      ops('vault_access:remove_guest', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vault-access', projectId] }),
  });
}
