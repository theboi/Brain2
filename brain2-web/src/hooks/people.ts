// brain2-web/src/hooks/people.ts
import { ops } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queryClient';
import type { InviteResult, TenantUser, UserAccess } from '@/lib/types';

export function useTenantUsers() {
  return useQuery({
    queryKey: qk.users(),
    queryFn: () => ops<{ users: TenantUser[]; next_cursor: string | null }>('list_users')
      .then(r => r.users),
  });
}

export function useUserAccess(userId: string | null) {
  return useQuery({
    queryKey: userId ? qk.userAccess(userId) : ['user-access', '_'],
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users() });
      qc.invalidateQueries({ queryKey: qk.orgGraph() });
    },
  });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { user_id: string; role: string }) =>
      ops('set_user_role', params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users() });
      qc.invalidateQueries({ queryKey: qk.orgGraph() });
    },
  });
}

export function useTransferOwnership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { target_user_id: string; step_down?: boolean }) =>
      ops('transfer_ownership', params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users() });
      qc.invalidateQueries({ queryKey: qk.me() });
      qc.invalidateQueries({ queryKey: qk.orgGraph() });
    },
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      email: string;
      role: 'admin' | 'member';
      display_name?: string;
      workspace_id?: string;
      workspace_role?: 'admin' | 'member';
    }) => ops<InviteResult>('users:invite', params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users() });
      qc.invalidateQueries({ queryKey: ['user-access'] });
      qc.invalidateQueries({ queryKey: qk.workspacesOverview() });
      qc.invalidateQueries({ queryKey: qk.orgGraph() });
    },
  });
}

export function useResendInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { user_id: string }) =>
      ops<InviteResult>('users:resend_invite', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users() }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { user_id: string }) =>
      ops<{ revoked: boolean }>('users:revoke_invite', params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users() });
      qc.invalidateQueries({ queryKey: qk.orgGraph() });
    },
  });
}
