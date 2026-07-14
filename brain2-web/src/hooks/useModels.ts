import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { ModelConfig, RuntimeModelProvider } from '@/lib/types';

export const MODEL_REGISTRY_KEY = qk.modelRegistry();

type CreateModelCommon = {
  name: string;
  model: string;
  max_concurrency: number;
};

export type CreateModelParams = CreateModelCommon & (
  | { provider: 'ollama'; ollama_base_url: string; api_key?: never }
  | { provider: Exclude<RuntimeModelProvider, 'ollama'>; api_key: string; ollama_base_url?: never }
);

export type UpdateModelParams = {
  model_id: string;
  name?: string;
  model?: string;
  max_concurrency?: number;
  ollama_base_url?: string;
  api_key?: string;
};

export function useModels() {
  return useQuery({
    queryKey: MODEL_REGISTRY_KEY,
    queryFn: () => ops<{ models: ModelConfig[] }>('models:list').then((r) => r.models),
  });
}

export function useCreateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateModelParams) => {
      const request = cloneAndScrubApiKey(params);
      return ops<ModelConfig>('models:create', request);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MODEL_REGISTRY_KEY });
    },
    gcTime: 0,
  });
}

export function useUpdateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateModelParams) => {
      const request = cloneAndScrubApiKey(params);
      return ops<ModelConfig>('models:update', request);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MODEL_REGISTRY_KEY });
    },
    gcTime: 0,
  });
}

export function useDeleteModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { model_id: string }) => ops('models:delete', params),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MODEL_REGISTRY_KEY });
    },
  });
}

export function useTestModel() {
  return useMutation({
    mutationFn: (params: { model_id: string; prompt?: string }) =>
      ops<{ ok: boolean; text?: string; error?: string }>('models:test', params),
  });
}

export function usePauseModel() {
  return useModelStatusMutation('models:pause');
}

export function useResumeModel() {
  return useModelStatusMutation('models:resume');
}

function useModelStatusMutation(operation: 'models:pause' | 'models:resume') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { model_id: string }) =>
      ops<{ model_id: string; status: ModelConfig['status'] }>(operation, params),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MODEL_REGISTRY_KEY });
    },
  });
}

function cloneAndScrubApiKey<T extends { api_key?: string }>(params: T): T {
  const request = { ...params };
  delete params.api_key;
  return request;
}
