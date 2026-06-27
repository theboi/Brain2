import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useNotifications } from './useNotifications';

vi.mock('@/lib/api', () => ({ ops: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((options) => options),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

describe('useNotifications', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls notifications:list with given limit', async () => {
    const query = useNotifications(10) as unknown as {
      queryKey: readonly ['notifications', number];
      queryFn: () => Promise<unknown>;
    };

    await query.queryFn();
    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['notifications', 10] }),
    );
    expect(api.ops).toHaveBeenCalledWith('notifications:list', { limit: 10 });
  });

  it('defaults limit to 50', async () => {
    const query = useNotifications() as unknown as {
      queryFn: () => Promise<unknown>;
    };

    await query.queryFn();
    expect(api.ops).toHaveBeenCalledWith('notifications:list', { limit: 50 });
  });
});
