// brain2-web/src/hooks/access.ts
import { ops } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queryClient';
import type { VaultAccessEntry } from '@/lib/types';

type GuestRole = 'viewer' | 'editor' | 'admin';

export function useVaultAccess(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.vaultAccess(projectId) : ['vault-access', '_'],
    queryFn: () => ops<{ access: VaultAccessEntry[] }>('vault_access:list',
      { project_id: projectId }).then(r => r.access),
    enabled: !!projectId,
  });
}

export function useAddGuest(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { project_id: string; user_id: string; role: GuestRole }) =>
      ops('vault_access:add_guest', params),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: qk.vaultAccess(projectId) });
      qc.invalidateQueries({ queryKey: qk.guests() });
      qc.invalidateQueries({ queryKey: qk.orgGraph() });
    },
  });
}

export function useSetGuestRole(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { project_id: string; user_id: string; role: GuestRole }) =>
      ops('vault_access:set_guest_role', params),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: qk.vaultAccess(projectId) });
      qc.invalidateQueries({ queryKey: qk.guests() });
      qc.invalidateQueries({ queryKey: qk.orgGraph() });
    },
  });
}

export function useRemoveGuest(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { project_id: string; user_id: string }) =>
      ops('vault_access:remove_guest', params),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: qk.vaultAccess(projectId) });
      qc.invalidateQueries({ queryKey: qk.guests() });
      qc.invalidateQueries({ queryKey: qk.orgGraph() });
    },
  });
}
