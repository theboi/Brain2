// brain2-web/src/hooks/me.ts
import { apiFetch } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@/lib/types';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<MeResponse>('/api/v1/me'),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { display_name: string }) =>
      apiFetch<MeResponse>('/api/v1/me', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      apiFetch<{ changed: boolean }>('/api/v1/me/password', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    // No cache invalidation needed — must_change_password clear happens server-side
    // Caller should navigate or refetch /me separately
  });
}
