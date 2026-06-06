// brain2-web/src/hooks/useIngest.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, genIdempotencyKey } from '@/lib/api';

export function useIngestUrl(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { url: string; topic?: string; folder_id?: string }) =>
      apiFetch<{ source_id: string }>('/api/v1/sources/from_url', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, ...vars }),
        headers: { 'Idempotency-Key': genIdempotencyKey() },
      }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
    },
  });
}

export function useIngestText(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { text: string; filename?: string; topic?: string; folder_id?: string }) =>
      apiFetch<{ source_id: string }>('/api/v1/sources/from_text', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, ...vars }),
        headers: { 'Idempotency-Key': genIdempotencyKey() },
      }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
    },
  });
}

export interface UploadHandle {
  promise: Promise<{ source_id: string }>;
  abort: () => void;
}

export function uploadFileWithProgress(
  projectId: string,
  file: File,
  opts: { topic?: string; folder_id?: string; onProgress?: (frac: number) => void } = {},
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<{ source_id: string }>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('project_id', projectId);
    if (opts.topic) form.append('topic', opts.topic);
    if (opts.folder_id) form.append('folder_id', opts.folder_id);

    xhr.open('POST', '/api/v1/sources/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('b2-token') ?? ''}`);
    xhr.setRequestHeader('Idempotency-Key', genIdempotencyKey());
    xhr.upload.onprogress = (e) => {
      if (opts.onProgress && e.lengthComputable) opts.onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('bad response')); }
      } else {
        reject(new Error(`upload ${xhr.status}: ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
