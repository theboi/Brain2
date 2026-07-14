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

describe('model query domains', () => {
  it('keeps settings registry rows separate from report agent rows', () => {
    const client = new QueryClient();
    const registry = [{ model_id: 'm1', name: 'Local', has_api_key: false }];
    const reportAgents = [{ agent_id: 'm1', name: 'Local' }];

    client.setQueryData(qk.modelRegistry(), registry);
    client.setQueryData(['models'], reportAgents);

    expect(client.getQueryData(qk.modelRegistry())).toBe(registry);
    expect(client.getQueryData(['models'])).toBe(reportAgents);
    expect(qk.modelRegistry()).not.toEqual(['models']);
  });
});
