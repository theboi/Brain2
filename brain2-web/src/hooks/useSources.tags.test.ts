import { describe, expect, it, vi } from 'vitest';
import { useProjectTags } from './useSources';
import { ops } from '@/lib/api';

vi.mock('@tanstack/react-query', () => ({
  QueryClient: vi.fn(),
  useQuery: vi.fn((opts) => opts),
  useQueries: vi.fn(),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  ops: vi.fn(),
  sse: vi.fn(),
  genIdempotencyKey: vi.fn(),
}));

describe('useProjectTags', () => {
  it('calls sources:tags:list and maps tags', async () => {
    vi.mocked(ops).mockResolvedValueOnce({ tags: ['Zeta', 'alpha'] });

    const query = useProjectTags('p1') as unknown as { queryFn: () => Promise<string[]> };
    await expect(query.queryFn()).resolves.toEqual(['Zeta', 'alpha']);

    expect(ops).toHaveBeenCalledWith('sources:tags:list', { project_id: 'p1' });
  });
});
