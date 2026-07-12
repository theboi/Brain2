import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useActivity', () => ({
  useAuditEvents: () => ({
    data: {
      events: [
        {
          id: 'evt-1',
          actor_id: 'worker-1',
          action: 'source.done',
          resource_id: 'source-1',
          ts: '2026-06-26T10:15:00Z',
          payload: { mode: 'wiki' },
        },
      ],
    },
    isError: false,
    isLoading: false,
  }),
}));

import { ActivitySection } from './ActivitySection';

describe('ActivitySection', () => {
  it('renders live activity events, not mock rows', () => {
    const html = renderToStaticMarkup(<ActivitySection />);

    expect(html).toContain('Activity');
    expect(html).toContain('source.done');
    expect(html).toContain('wiki');
    expect(html).toContain('worker-1');
    expect(html).not.toContain('alice');
    expect(html).not.toContain('bob');
    expect(html).not.toContain('carol');
  });
});
