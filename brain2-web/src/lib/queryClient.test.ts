import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateTodoQueries, qk } from './queryClient';

describe('todo query invalidation', () => {
  it('invalidates running and failed filtered caches from the stable root', async () => {
    const client = new QueryClient();
    client.setQueryData(qk.todos('running'), ['running']);
    client.setQueryData(qk.todos('failed'), ['failed']);

    await invalidateTodoQueries(client);

    expect(client.getQueryState(qk.todos('running'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(qk.todos('failed'))?.isInvalidated).toBe(true);
  });
});
