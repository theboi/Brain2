import { describe, expect, it } from 'vitest';
import { formatLastSeen, presenceFromLastSeen } from './lastSeen';

describe('lastSeen helpers', () => {
  const now = new Date('2026-06-14T10:00:00Z');

  it('treats recent activity as active', () => {
    expect(presenceFromLastSeen('2026-06-14T09:56:00Z', now)).toBe('active');
    expect(formatLastSeen('2026-06-14T09:56:00Z', now)).toBe('Active now');
  });

  it('formats older activity', () => {
    expect(presenceFromLastSeen('2026-06-14T08:00:00Z', now)).toBe('offline');
    expect(formatLastSeen('2026-06-14T08:00:00Z', now)).toBe('2h ago');
  });
});
