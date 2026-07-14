import { MutationCache, QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  internalMutate: vi.fn(),
  internalMutateAsync: vi.fn(),
  invalidateQueries: vi.fn(),
  ops: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn((options: unknown) => options),
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: <T,>(value: T) => ({ current: value }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('@/lib/api', () => ({ ops: mocks.ops }));

import {
  createOneShotApiKeyVault,
  MODEL_REGISTRY_KEY,
  secureModelMutationOptions,
  useCreateModel,
  useModels,
  usePauseModel,
  useResumeModel,
  useUpdateModel,
} from './useModels';
import { qk } from '@/lib/queryClient';

interface MutationHarness<T> {
  mutationFn: (variables: T) => Promise<unknown>;
  onSuccess: () => unknown;
}

describe('model registry hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ops.mockResolvedValue({ model_id: 'm1' });
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.internalMutateAsync.mockResolvedValue({ model_id: 'm1' });
    mocks.useMutation.mockImplementation((options: object) => ({
      ...options,
      mutate: mocks.internalMutate,
      mutateAsync: mocks.internalMutateAsync,
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    }));
  });

  it('uses a registry-only query key', () => {
    const options = useModels() as unknown as {
      queryKey: readonly string[];
      refetchInterval: number;
      refetchOnWindowFocus: boolean;
    };
    expect(options.queryKey).toEqual(MODEL_REGISTRY_KEY);
    expect(options.queryKey).not.toEqual(qk.reportModels());
    expect(options.refetchInterval).toBe(4000);
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('moves the public raw key into a one-shot vault before internal mutate', () => {
    const mutation = useCreateModel();
    const variables = {
      provider: 'anthropic' as const,
      name: 'Claude',
      model: 'claude',
      api_key: 'raw-create-secret',
      max_concurrency: 1,
    };

    mutation.mutate(variables);

    expect(variables).not.toHaveProperty('api_key');
    const cachedVariables = mocks.internalMutate.mock.calls[0]?.[0];
    expect(cachedVariables).toEqual({
      nonce: expect.any(String),
      params: {
        provider: 'anthropic', name: 'Claude', model: 'claude', max_concurrency: 1,
      },
    });
    expect(JSON.stringify(cachedVariables)).not.toContain('raw-create-secret');
  });

  it('never places the secret in a real MutationCache snapshot', async () => {
    const cache = new MutationCache();
    const client = new QueryClient({ mutationCache: cache });
    const snapshots: string[] = [];
    cache.subscribe((event) => {
      snapshots.push(JSON.stringify(event.mutation?.state.variables ?? null));
    });
    const vault = createOneShotApiKeyVault<Record<string, unknown>>();
    const options = secureModelMutationOptions<Record<string, unknown>, { model_id: string }>(
      'models:create', vault, () => undefined,
    );
    const mutation = cache.build(client, options);
    const raw = {
      provider: 'anthropic', name: 'Claude', model: 'claude',
      api_key: 'mutation-cache-secret', max_concurrency: 1,
    };

    await mutation.execute(vault.secure(raw));

    expect(raw).not.toHaveProperty('api_key');
    expect(mocks.ops).toHaveBeenCalledWith('models:create', expect.objectContaining({
      api_key: 'mutation-cache-secret',
    }));
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.join('\n')).not.toContain('mutation-cache-secret');
    expect(JSON.stringify(mutation.state.variables)).not.toContain('mutation-cache-secret');
  });

  it('keeps mutateAsync typed and passes only safe internal variables', async () => {
    const mutation = useUpdateModel();
    const variables = {
      model_id: 'm1',
      api_key: 'raw-update-secret',
      max_concurrency: 2,
    };

    await mutation.mutateAsync(variables);

    expect(variables).not.toHaveProperty('api_key');
    const cachedVariables = mocks.internalMutateAsync.mock.calls[0]?.[0];
    expect(cachedVariables).toEqual({
      nonce: expect.any(String),
      params: { model_id: 'm1', max_concurrency: 2 },
    });
    expect(JSON.stringify(cachedVariables)).not.toContain('raw-update-secret');
  });

  it.each([
    [usePauseModel, 'models:pause'],
    [useResumeModel, 'models:resume'],
  ])('provides a typed status mutation and invalidates both model caches', async (useStatusModel, operation) => {
    const options = useStatusModel() as unknown as MutationHarness<{ model_id: string }>;
    await options.mutationFn({ model_id: 'm1' });
    expect(mocks.ops).toHaveBeenCalledWith(operation, { model_id: 'm1' });
    expect(options.onSuccess()).toBeUndefined();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.modelRegistry() });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.reportModels() });
  });
});
