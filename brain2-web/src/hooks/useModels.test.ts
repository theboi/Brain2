import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  ops: vi.fn(),
  useMutation: vi.fn((options: unknown) => options),
  useQuery: vi.fn((options: unknown) => options),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('@/lib/api', () => ({ ops: mocks.ops }));

import {
  MODEL_REGISTRY_KEY,
  useCreateModel,
  useModels,
  usePauseModel,
  useResumeModel,
  useUpdateModel,
} from './useModels';

interface MutationOptions<T> {
  mutationFn: (variables: T) => Promise<unknown>;
  onSuccess: () => unknown;
  gcTime: number;
}

describe('model registry hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ops.mockResolvedValue({ model_id: 'm1' });
    mocks.invalidateQueries.mockResolvedValue(undefined);
  });

  it('uses a registry-only query key', () => {
    const options = useModels() as unknown as { queryKey: readonly string[] };
    expect(options.queryKey).toEqual(MODEL_REGISTRY_KEY);
    expect(options.queryKey).not.toEqual(['models']);
  });

  it('scrubs a create key from mutation-cache variables before awaiting', async () => {
    const options = useCreateModel() as unknown as MutationOptions<Record<string, unknown>>;
    const variables: Record<string, unknown> = {
      provider: 'anthropic', name: 'Claude', model: 'claude',
      api_key: 'raw-create-secret', max_concurrency: 1,
    };
    const request = options.mutationFn(variables);

    expect(variables).not.toHaveProperty('api_key');
    expect(mocks.ops).toHaveBeenCalledWith('models:create', expect.objectContaining({
      api_key: 'raw-create-secret',
    }));
    expect(options.gcTime).toBe(0);
    await request;
    expect(options.onSuccess()).toBeUndefined();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: MODEL_REGISTRY_KEY });
  });

  it('scrubs a replacement key from update variables before awaiting', async () => {
    const options = useUpdateModel() as unknown as MutationOptions<Record<string, unknown>>;
    const variables: Record<string, unknown> = {
      model_id: 'm1', api_key: 'raw-update-secret', max_concurrency: 2,
    };
    const request = options.mutationFn(variables);

    expect(variables).not.toHaveProperty('api_key');
    expect(mocks.ops).toHaveBeenCalledWith('models:update', expect.objectContaining({
      api_key: 'raw-update-secret',
    }));
    expect(options.gcTime).toBe(0);
    await request;
  });

  it.each([
    [usePauseModel, 'models:pause'],
    [useResumeModel, 'models:resume'],
  ])('provides a typed status mutation', async (useStatusModel, operation) => {
    const options = useStatusModel() as unknown as MutationOptions<{ model_id: string }>;
    await options.mutationFn({ model_id: 'm1' });
    expect(mocks.ops).toHaveBeenCalledWith(operation, { model_id: 'm1' });
    expect(options.onSuccess()).toBeUndefined();
  });
});
