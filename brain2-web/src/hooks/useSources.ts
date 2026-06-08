// brain2-web/src/hooks/useSources.ts
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ops, sse, genIdempotencyKey } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { SourceRow, SourceEvent } from '@/lib/types';
import type { DiffHunk } from '@/lib/wiki';

export interface SourceFilters {
  status?: string;
  tag?: string;
  folder_id?: string;
  q?: string;
}

export function useSources(projectId: string | null, filters: SourceFilters = {}) {
  return useQuery({
    queryKey: projectId ? qk.sources(projectId, filters) : ['sources', '_', null],
    queryFn: () => ops<{ sources: SourceRow[] }>('sources:list',
      { project_id: projectId, ...filters }).then(r => r.sources),
    enabled: !!projectId,
  });
}

export function useSource(projectId: string | null, sourceId: string | null) {
  return useQuery({
    queryKey: projectId && sourceId ? qk.source(projectId, sourceId)
                                     : ['sources', '_', '_'],
    queryFn: () => ops<SourceRow>('sources:get',
      { project_id: projectId, source_id: sourceId }),
    enabled: !!projectId && !!sourceId,
  });
}

export function useExtracted(projectId: string | null, sourceId: string | null) {
  return useQuery({
    queryKey: projectId && sourceId ? qk.sourceExtracted(projectId, sourceId)
                                     : ['sources', '_', '_', 'extracted'],
    queryFn: () => ops<{ extracted_md: string; extracted_version: number }>(
      'sources:get_extracted',
      { project_id: projectId, source_id: sourceId })
      .then((r) => ({ extracted_md: r.extracted_md, version: r.extracted_version })),
    enabled: !!projectId && !!sourceId,
  });
}

export interface ExtractionVersion {
  version: number;
  kind: string;
  created_at: string;
  bytes: number;
}

export function useExtractionHistory(projectId: string | null, sourceId: string | null) {
  return useQuery({
    queryKey: projectId && sourceId ? qk.sourceHistory(projectId, sourceId)
                                     : ['sources', '_', '_', 'history'],
    queryFn: () => ops<{ versions: ExtractionVersion[] }>(
      'sources:extraction_history',
      { project_id: projectId, source_id: sourceId },
    ).then((r) => r.versions),
    enabled: !!projectId && !!sourceId,
  });
}

export function useExtractionDiff(
  projectId: string | null,
  sourceId: string | null,
  version: number | null,
) {
  return useQuery({
    queryKey: projectId && sourceId && version != null
      ? qk.sourceDiff(projectId, sourceId, version)
      : ['sources', '_', '_', 'diff', -1],
    queryFn: () => ops<{ version: number; base_version: number; hunks: DiffHunk[] }>(
      'sources:extraction_diff',
      { project_id: projectId, source_id: sourceId, version },
    ),
    enabled: !!projectId && !!sourceId && version != null,
  });
}

export function useFolders(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.folders(projectId) : ['folders', '_'],
    queryFn: () => ops<{ folders: any[] }>('folders:list', { project_id: projectId })
      .then(r => r.folders),
    enabled: !!projectId,
  });
}

export function usePutExtracted(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { source_id: string; extracted_md: string; expect_version: number }) =>
      ops('sources:put_extracted', {
        project_id: projectId,
        source_id: vars.source_id,
        content: vars.extracted_md,
        expect_version: vars.expect_version,
      },
          { idempotencyKey: genIdempotencyKey() }),
    onSuccess: (_, vars) => {
      if (!projectId) return;
      qc.invalidateQueries({ queryKey: qk.source(projectId, vars.source_id) });
    },
  });
}

export function useReingest(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { source_id: string }) =>
      ops('sources:reingest', { project_id: projectId, ...vars },
          { idempotencyKey: genIdempotencyKey() }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
    },
  });
}

export function useDeleteSource(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { source_id: string }) =>
      ops('sources:delete', { project_id: projectId, ...vars },
          { idempotencyKey: genIdempotencyKey() }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
    },
  });
}

export function useTagSource(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { source_id: string; tag: string }) =>
      ops('sources:tag', { project_id: projectId, ...vars }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
    },
  });
}

export function useUntagSource(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { source_id: string; tag: string }) =>
      ops('sources:untag', { project_id: projectId, ...vars }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
    },
  });
}

export function useSourceEvents(projectId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!projectId) return;
    const close = sse(
      `/api/v1/sources/events?project_id=${encodeURIComponent(projectId)}`,
      (msg) => {
        try {
          const evt = JSON.parse(msg.data) as SourceEvent;
          if (evt.type === 'heartbeat') return;
          qc.invalidateQueries({ queryKey: ['sources', projectId] });
        } catch { /* ignore malformed events */ }
      },
    );
    return close;
  }, [projectId, qc]);
}

export function useDownloadSource() {
  return useMutation({
    mutationFn: async (vars: { source_id: string; filename: string }) => {
      const token = localStorage.getItem('b2-token') ?? '';
      const r = await fetch(`/api/v1/sources/${encodeURIComponent(vars.source_id)}/raw`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`download failed: ${r.status}`);
      const b = await r.blob();
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url; a.download = vars.filename; a.click();
      URL.revokeObjectURL(url);
    },
  });
}
