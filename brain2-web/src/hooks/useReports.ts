import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { genIdempotencyKey, ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { AgentStatus } from '@/lib/mockData';
import { buildHistoryParams, type HistoryFilters, type ReportHistoryResult } from '@/pages/Reports/history';

export interface ReportRow {
  report_id: string;
  project_id: string | null;
  title: string;
  format: 'doc' | 'deck' | 'video';
  prompt: string;
  agent_id: string | null;
  conversation_id: string | null;
  status: 'generating' | 'ready' | 'scheduled' | 'failed';
  schedule: 'now' | 'weekly' | 'monthly' | 'quarterly';
  created_at: string;
  updated_at: string;
}

export interface GenerateReportVars {
  title: string;
  prompt: string;
  agent_id: string;
  project_id: string | null;
  format: 'doc' | 'deck' | 'video';
  schedule: 'now' | 'weekly' | 'monthly' | 'quarterly';
  category?: string;
}

export interface GenerateReportResult {
  report_id: string;
  status: string;
  conversation_id: string | null;
  stream_url: string | null;
}

export interface AgentRow {
  agent_id: string;
  name: string;
  model: string;
  provider: string;
  status: AgentStatus;
}

interface RawAgentRow {
  agent_id: string;
  name: string;
  model: string;
  provider: string;
  status: string;
}

function normalizeAgentStatus(status: string): AgentStatus {
  if (status === 'active' || status === 'ready' || status === 'idle' ||
      status === 'degraded' || status === 'error') {
    return status;
  }
  if (status === 'failed' || status === 'disabled') return 'error';
  if (status === 'running' || status === 'streaming') return 'active';
  return 'ready';
}

export function useReports(projectId: string | null) {
  return useQuery({
    queryKey: qk.reports(projectId),
    queryFn: () => ops<{ reports: ReportRow[] }>('reports:list', {
      project_id: projectId,
    }).then((r) => r.reports),
  });
}

export function useGenerateReport(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: GenerateReportVars) =>
      ops<GenerateReportResult>('reports:generate', vars, {
        idempotencyKey: genIdempotencyKey(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.reports(projectId) });
      qc.invalidateQueries({ queryKey: ['report-history', projectId] });
    },
  });
}

export function useCreateSchedule(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      op_name: string;
      op_params: object;
      frequency: 'weekly' | 'monthly' | 'quarterly';
    }) =>
      ops('schedules:create', { project_id: projectId, ...vars }, {
        idempotencyKey: genIdempotencyKey(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.reports(projectId) });
    },
  });
}

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => ops<{ agents: RawAgentRow[] }>('agents:list', {})
      .then((r) => r.agents.map((agent) => ({
        ...agent,
        status: normalizeAgentStatus(agent.status),
      }))),
  });
}

export function useReportHistory(projectId: string | null, filters: HistoryFilters) {
  const params = buildHistoryParams(filters);
  return useQuery({
    queryKey: qk.reportHistory(projectId, params),
    queryFn: () =>
      ops<ReportHistoryResult>('reports:history', { project_id: projectId, ...params }),
    placeholderData: keepPreviousData,
  });
}
