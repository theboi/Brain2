import { describe, expect, it } from 'vitest';
import { buildHistoryParams } from './history';

describe('buildHistoryParams', () => {
  it('omits format when "all" and omits empty search', () => {
    const p = buildHistoryParams({ format: 'all', year: null, month: null, q: '', page: 0 });
    expect(p).toEqual({ limit: 8, offset: 0 });
  });

  it('includes format, year, month, q and computes offset from page', () => {
    const p = buildHistoryParams({ format: 'doc', year: 2026, month: 5, q: ' rev ', page: 2 });
    expect(p).toEqual({ format: 'doc', year: 2026, month: 5, q: 'rev', limit: 8, offset: 16 });
  });

  it('never sends month without year', () => {
    const p = buildHistoryParams({ format: 'all', year: null, month: 5, q: '', page: 0 });
    expect(p).toEqual({ limit: 8, offset: 0 });
    expect('month' in p).toBe(false);
  });
});
