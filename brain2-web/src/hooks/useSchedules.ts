import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { genIdempotencyKey, ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';

export interface ScheduleRow {
  schedule_id: string;
  tenant_id: string;
  created_by: string;
  op_name: string;
  op_params: Record<string, unknown>;
  frequency: string | null;
  cron_expr: string | null;
  next_run_at: string;
  last_run_at: string | null;
  enabled: number | boolean;
  created_at: string;
  updated_at: string;
}

export type OccurrenceState = 'ran' | 'queued' | 'skipped' | 'off';

export interface OccurrenceRow {
  schedule_id: string;
  run_at: string;
  title: string;
  format: 'doc' | 'deck' | 'video';
  runner: string | null;
  sources: number | null;
  category: string | null;
  cadence_detail: string;
  cron_expr: string;
  enabled: boolean;
  state: OccurrenceState;
}

export function useSchedules() {
  return useQuery({
    queryKey: qk.schedules(),
    queryFn: () => ops<{ schedules: ScheduleRow[] }>('schedules:list', {})
      .then((r) => r.schedules),
  });
}

export function useScheduleOccurrences(windowStart: string, windowEnd: string) {
  return useQuery({
    queryKey: qk.scheduleOccurrences(windowStart, windowEnd),
    queryFn: () => ops<{ occurrences: OccurrenceRow[] }>('schedules:occurrences', {
      window_start: windowStart,
      window_end: windowEnd,
    }).then((r) => r.occurrences),
    placeholderData: keepPreviousData,
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.schedules() });
  qc.invalidateQueries({ queryKey: ['schedule-occurrences'] });
}

export function useSetScheduleEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { schedule_id: string; enabled: boolean }) =>
      ops('schedules:set_enabled', vars),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { schedule_id: string }) => ops('schedules:delete', vars),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useSkipRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { schedule_id: string; run_at: string }) =>
      ops('schedules:skip', vars),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUnskipRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { schedule_id: string; run_at: string }) =>
      ops('schedules:unskip', vars),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRunNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { schedule_id: string }) =>
      ops('schedules:run_now', vars, { idempotencyKey: genIdempotencyKey() }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      schedule_id: string;
      cron_expr?: string;
      op_params?: object;
      enabled?: boolean;
    }) => ops('schedules:update', vars),
    onSuccess: () => invalidateAll(qc),
  });
}
