// brain2-web/src/hooks/useVault.ts
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { ops, apiFetch, sse, genIdempotencyKey } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { VaultPage, VaultGraph, VaultGraphNode, VaultCommit } from '@/lib/types';
import type { DiffHunk } from '@/lib/wiki';

export function useVaultIndex(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.vaultIndex(projectId) : ['vault', '_', 'index'],
    queryFn: () => ops<{ content: string }>('vault:read_index',
      { project_id: projectId }),
    enabled: !!projectId,
  });
}

export function useVaultPage(projectId: string | null, topic: string | null) {
  return useQuery({
    queryKey: projectId && topic ? qk.vaultPage(projectId, topic)
                                  : ['vault', '_', 'page', '_'],
    queryFn: () => ops<VaultPage>('vault:read_page',
      { project_id: projectId, topic }),
    enabled: !!projectId && !!topic,
  });
}

export function useVaultGraph(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.vaultGraph(projectId) : ['vault', '_', 'graph'],
    queryFn: () => ops<VaultGraph>('vault:graph', { project_id: projectId }),
    enabled: !!projectId,
  });
}

export function useVaultHistory(projectId: string | null, topic: string | null) {
  return useQuery({
    queryKey: projectId && topic ? qk.vaultHistory(projectId, topic)
                                  : ['vault', '_', 'history', '_'],
    queryFn: () => ops<{ commits: Array<Omit<VaultCommit, 'date'> & { ts?: string; date?: string }> }>(
      'vault:history',
      { project_id: projectId, topic, limit: 50 },
    ).then((r) => ({
      commits: r.commits.map((c) => ({ ...c, date: c.date ?? c.ts ?? '' })),
    })),
    enabled: !!projectId && !!topic,
  });
}

export function useVaultHistoryDiff(projectId: string | null, sha: string | null,
                                    topic: string | null = null) {
  return useQuery({
    queryKey: projectId && sha ? [...qk.vaultHistoryDiff(projectId, sha), topic ?? '_']
                                : ['vault', '_', 'history-diff', '_'],
    queryFn: () => ops<{ sha: string; diff: string; hunks: DiffHunk[] }>(
      'vault:history_show',
      { project_id: projectId, sha, topic },
    ),
    enabled: !!projectId && !!sha,
  });
}

export function useVaultSearch(projectId: string | null, query: string) {
  return useQuery({
    queryKey: projectId ? qk.vaultSearch(projectId, query) : ['vault', '_', 'search', query],
    queryFn: () => ops<{ results: { topic: string; path: string; excerpt: string }[] }>(
      'vault:search', { project_id: projectId, query }),
    enabled: !!projectId && query.trim().length > 0,
  });
}

export function useVaultPages(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? ['vault', projectId, 'pages'] : ['vault', '_', 'pages'],
    queryFn: () => ops<VaultGraph>('vault:graph', { project_id: projectId })
      .then(r => r.nodes.filter(n => n.zone === 'wiki')),
    enabled: !!projectId,
  });
}

/**
 * Wiki pages for every vault in the active workspace, fetched in parallel and
 * returned aligned with `projectIds`. Shares cache keys with useVaultPages so a
 * single vault's pages are only fetched once across the sidebar and page view.
 */
export function useWorkspaceVaultPages(projectIds: string[]) {
  return useQueries({
    queries: projectIds.map((pid) => ({
      queryKey: ['vault', pid, 'pages'],
      queryFn: () => ops<VaultGraph>('vault:graph', { project_id: pid })
        .then((r) => r.nodes.filter((n: VaultGraphNode) => n.zone === 'wiki')),
    })),
  });
}

export function useOpenAuditCounts(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? ['wiki-open-audit-counts', projectId] : ['wiki-open-audit-counts', '_'],
    queryFn: () => ops<{ counts: Record<string, number> }>(
      'wiki:open_audit_counts',
      { project_id: projectId! },
    ),
    enabled: !!projectId,
  });
}

export function useWorkspaceOpenAuditCounts(projectIds: string[]) {
  return useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: ['wiki-open-audit-counts', projectId],
      queryFn: () => ops<{ counts: Record<string, number> }>(
        'wiki:open_audit_counts',
        { project_id: projectId },
      ),
    })),
  });
}

export function useLatestAudit(projectId: string | null, topic: string | null) {
  return useQuery({
    queryKey: projectId && topic ? ['wiki-latest-audit', projectId, topic]
                                  : ['wiki-latest-audit', '_', '_'],
    enabled: !!projectId && !!topic,
    queryFn: async () => {
      const { audits } = await ops<{ audits: any[] }>(
        'wiki:list_audits',
        { project_id: projectId!, topic: topic! },
      );
      const latest = audits?.[0] ?? null;
      if (!latest) return { audit: null, suggestions: [] };
      const { suggestions } = await ops<{ suggestions: any[] }>(
        'wiki:list_suggestions',
        { audit_id: latest.audit_id, project_id: projectId! },
      );
      return {
        audit: latest,
        suggestions: (suggestions ?? []).filter((s) => s.status === 'pending'),
      };
    },
  });
}

export function useWritePage(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { topic: string; content: string; expect_content_hash?: string }) =>
      ops<{ page: { topic: string }; commit_sha: string }>('vault:write_page',
        { project_id: projectId, ...vars },
        { idempotencyKey: genIdempotencyKey() }),
    onSuccess: (_, vars) => {
      if (!projectId) return;
      qc.invalidateQueries({ queryKey: ['vault', projectId] });
      qc.invalidateQueries({ queryKey: qk.vaultPage(projectId, vars.topic) });
    },
  });
}

export function useRevertCommit(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { sha: string; topic?: string }) =>
      ops<{ revert_sha: string }>('vault:revert',
        { project_id: projectId, sha: vars.sha, topic: vars.topic },
        { idempotencyKey: genIdempotencyKey() }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['vault', projectId] });
    },
  });
}

export function useWikiTopicSources(projectId: string | null, topic: string | null) {
  return useQuery({
    queryKey: projectId && topic ? qk.wikiTopicSources(projectId, topic)
                                  : ['wiki', '_', '_', 'sources'],
    queryFn: () => apiFetch<{ topic: string; sources: any[] }>(
      `/api/v1/wiki/${encodeURIComponent(topic!)}/sources?project_id=${encodeURIComponent(projectId!)}`),
    enabled: !!projectId && !!topic,
  });
}

export function useStartAudit(projectId: string | null, topic: string | null) {
  return useMutation({
    mutationFn: (vars: { agent_id: string; instructions?: string;
                          scope?: 'page' | 'selection'; selection?: string;
                          citation_policy?: string }) =>
      apiFetch<{ audit_id: string; stream_url: string }>(
        `/api/v1/wiki/${encodeURIComponent(topic!)}/audit?project_id=${encodeURIComponent(projectId!)}`,
        { method: 'POST', body: JSON.stringify(vars) }),
  });
}

export function subscribeAuditStream(auditId: string,
                                     onEvent: (e: any) => void): () => void {
  return sse(`/api/v1/wiki/audits/${encodeURIComponent(auditId)}/stream`,
    (msg) => { try { onEvent(JSON.parse(msg.data)); } catch { /* ignore */ } });
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { suggestion_id: string; edit?: string }) =>
      ops('wiki:accept_suggestion', vars, { idempotencyKey: genIdempotencyKey() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vault'] }); },
  });
}

export function useDismissSuggestion() {
  return useMutation({
    mutationFn: (vars: { suggestion_id: string }) =>
      ops('wiki:dismiss_suggestion', vars, { idempotencyKey: genIdempotencyKey() }),
  });
}
