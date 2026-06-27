import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';

export interface Notification {
  notification_id: string;
  type: string;
  title: string;
  body: string;
  resource_id: string | null;
  resource_type: string | null;
  read_at: string | null;
  created_at: string;
}

export function useNotifications(limit = 50) {
  return useQuery({
    queryKey: ['notifications', limit] as const,
    queryFn: () =>
      ops<{ notifications: Notification[] }>('notifications:list', { limit }),
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notification_id: string) =>
      ops('notifications:mark_read', { notification_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ops('notifications:mark_all_read', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
