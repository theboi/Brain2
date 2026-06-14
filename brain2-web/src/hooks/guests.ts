import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { Guest, InviteResult } from '@/lib/types';

export function useGuests() {
  return useQuery({
    queryKey: qk.guests(),
    queryFn: () => ops<{ guests: Guest[] }>('guests:list').then((r) => r.guests),
  });
}

export function useInviteGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { email: string; project_id: string; role: 'viewer' | 'editor' }) =>
      ops<InviteResult>('guests:invite', params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.guests() });
      qc.invalidateQueries({ queryKey: qk.users() });
      qc.invalidateQueries({ queryKey: qk.orgGraph() });
    },
  });
}
