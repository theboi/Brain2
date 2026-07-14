import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import type { ModelConfig, RuntimeModelProvider } from '@/lib/types';

const KEY = ['models'] as const;

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
    queryKey: KEY,
    queryFn: () => ops<{ models: ModelConfig[] }>('models:list').then((r) => r.models),
  });
}

export function useCreateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateModelParams) => ops<ModelConfig>('models:create', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateModelParams) => ops<ModelConfig>('models:update', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { model_id: string }) => ops('models:delete', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useTestModel() {
  return useMutation({
    mutationFn: (params: { model_id: string; prompt?: string }) =>
      ops<{ ok: boolean; text?: string; error?: string }>('models:test', params),
  });
}
