// brain2-web/src/hooks/people.ts
import { ops } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TenantUser, UserAccess } from '@/lib/types';

export function useTenantUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => ops<{ users: TenantUser[]; next_cursor: string | null }>('list_users')
      .then(r => r.users),
  });
}

export function useUserAccess(userId: string | null) {
  return useQuery({
    queryKey: ['user-access', userId],
    queryFn: () => ops<UserAccess>('access:for_user', { user_id: userId }),
    enabled: !!userId,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      email: string;
      password: string;
      display_name?: string;
      role: string;
      workspace_id?: string;
      workspace_role?: string;
    }) => ops('create_user', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { user_id: string; role: string }) =>
      ops('set_user_role', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useTransferOwnership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { target_user_id: string; step_down?: boolean }) =>
      ops('transfer_ownership', params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
