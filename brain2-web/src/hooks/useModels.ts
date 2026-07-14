import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import type { ModelConfig, RuntimeModelProvider } from '@/lib/types';

const KEY = ['models'] as const;

export function useModels() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => ops<{ models: ModelConfig[] }>('models:list').then((r) => r.models),
  });
}

export function useCreateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      name: string;
      provider: RuntimeModelProvider;
      model: string;
      param_count?: string;
      ollama_base_url?: string;
      api_key?: string;
      system_prompt?: string;
      fallback_model?: string;
    }) => ops<ModelConfig>('models:create', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { model_id: string } & Partial<{
      name: string;
      model: string;
      param_count: string;
      ollama_base_url: string;
      system_prompt: string;
      fallback_model: string;
    }>) => ops<ModelConfig>('models:update', params),
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
