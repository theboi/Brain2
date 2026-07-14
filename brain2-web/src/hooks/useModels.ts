import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MutateOptions, UseMutationResult } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { invalidateModelQueries, qk } from '@/lib/queryClient';
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

type ApiKeyParams = { api_key?: string };

export interface SecureModelVariables<TParams extends ApiKeyParams> {
  nonce: string;
  params: Omit<TParams, 'api_key'>;
}

export interface OneShotApiKeyVault<TParams extends ApiKeyParams> {
  secure: (params: TParams) => SecureModelVariables<TParams>;
  take: (nonce: string) => string | undefined;
  discard: (nonce: string) => void;
}

export function createOneShotApiKeyVault<
  TParams extends ApiKeyParams,
>(): OneShotApiKeyVault<TParams> {
  const secrets = new Map<string, string>();
  let sequence = 0;
  return {
    secure(params) {
      const nonce = `model-api-key-${++sequence}`;
      if (params.api_key !== undefined) secrets.set(nonce, params.api_key);
      delete params.api_key;
      return {
        nonce,
        params: { ...params } as Omit<TParams, 'api_key'>,
      };
    },
    take(nonce) {
      const secret = secrets.get(nonce);
      secrets.delete(nonce);
      return secret;
    },
    discard(nonce) {
      secrets.delete(nonce);
    },
  };
}

export function secureModelMutationOptions<
  TParams extends ApiKeyParams,
  TData,
>(
  operation: 'models:create' | 'models:update',
  vault: OneShotApiKeyVault<TParams>,
  onSuccess: () => void,
) {
  return {
    mutationFn: (variables: SecureModelVariables<TParams>) => {
      const secret = vault.take(variables.nonce);
      const request = {
        ...variables.params,
        ...(secret !== undefined ? { api_key: secret } : {}),
      };
      return ops<TData>(operation, request);
    },
    onSuccess,
    onSettled: (
      _data: TData | undefined,
      _error: Error | null,
      variables: SecureModelVariables<TParams>,
    ) => {
      vault.discard(variables.nonce);
    },
    gcTime: 0,
    retry: false,
  };
}

export function useModels() {
  return useQuery({
    queryKey: MODEL_REGISTRY_KEY,
    queryFn: () => ops<{ models: ModelConfig[] }>('models:list').then((r) => r.models),
  });
}

export function useCreateModel() {
  return useSecureApiKeyMutation<CreateModelParams, ModelConfig>('models:create');
}

export function useUpdateModel() {
  return useSecureApiKeyMutation<UpdateModelParams, ModelConfig>('models:update');
}

export function useDeleteModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { model_id: string }) => ops('models:delete', params),
    onSuccess: () => {
      void invalidateModelQueries(qc);
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

function useSecureApiKeyMutation<TParams extends ApiKeyParams, TData>(
  operation: 'models:create' | 'models:update',
): UseMutationResult<TData, Error, TParams, unknown> {
  const qc = useQueryClient();
  const vaultRef = useRef<OneShotApiKeyVault<TParams> | null>(null);
  if (vaultRef.current === null) {
    vaultRef.current = createOneShotApiKeyVault<TParams>();
  }
  const vault = vaultRef.current;
  const internal = useMutation<TData, Error, SecureModelVariables<TParams>, unknown>(
    secureModelMutationOptions<TParams, TData>(operation, vault, () => {
      void invalidateModelQueries(qc);
    }),
  );

  const mutate = (
    params: TParams,
    options?: MutateOptions<TData, Error, TParams, unknown>,
  ) => {
    const variables = vault.secure(params);
    try {
      internal.mutate(variables, remapMutateOptions(options, params));
    } catch (error) {
      vault.discard(variables.nonce);
      throw error;
    }
  };
  const mutateAsync = (
    params: TParams,
    options?: MutateOptions<TData, Error, TParams, unknown>,
  ) => {
    const variables = vault.secure(params);
    try {
      return internal.mutateAsync(
        variables,
        remapMutateOptions(options, params),
      ).finally(() => vault.discard(variables.nonce));
    } catch (error) {
      vault.discard(variables.nonce);
      return Promise.reject(error);
    }
  };

  return {
    ...internal,
    variables: internal.variables?.params as TParams | undefined,
    mutate,
    mutateAsync,
  } as UseMutationResult<TData, Error, TParams, unknown>;
}

function remapMutateOptions<TData, TParams extends ApiKeyParams>(
  options: MutateOptions<TData, Error, TParams, unknown> | undefined,
  publicVariables: TParams,
): MutateOptions<TData, Error, SecureModelVariables<TParams>, unknown> | undefined {
  if (!options) return undefined;
  return {
    onSuccess: options.onSuccess
      ? (data, _variables, onMutateResult, context) =>
          options.onSuccess?.(data, publicVariables, onMutateResult, context)
      : undefined,
    onError: options.onError
      ? (error, _variables, onMutateResult, context) =>
          options.onError?.(error, publicVariables, onMutateResult, context)
      : undefined,
    onSettled: options.onSettled
      ? (data, error, _variables, onMutateResult, context) =>
          options.onSettled?.(data, error, publicVariables, onMutateResult, context)
      : undefined,
  };
}

function useModelStatusMutation(operation: 'models:pause' | 'models:resume') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { model_id: string }) =>
      ops<{ model_id: string; status: ModelConfig['status'] }>(operation, params),
    onSuccess: () => {
      void invalidateModelQueries(qc);
    },
  });
}
