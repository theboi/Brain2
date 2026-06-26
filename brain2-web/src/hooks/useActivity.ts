import { useQuery } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { ActivityEvent, AuditEvent } from '@/lib/activity';

export function useActivity(limit = 25) {
  return useQuery({
    queryKey: qk.activity(limit),
    queryFn: () => ops<{ events: ActivityEvent[] }>('activity:list', { limit }),
  });
}

export function useAuditEvents(limit = 25) {
  return useQuery({
    queryKey: qk.auditEvents(limit),
    queryFn: () => ops<{ events: AuditEvent[] }>('audit:list', { limit }),
  });
}
