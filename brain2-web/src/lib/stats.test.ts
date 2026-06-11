import { describe, expect, it } from 'vitest';
import { bucketsToSeries, lastNDates, pivotTokenSeries, seriesDelta } from './stats';

const NOW = new Date('2026-06-11T12:00:00Z');

describe('lastNDates', () => {
  it('returns windowDays UTC date strings, oldest first, ending today', () => {
    const dates = lastNDates(3, NOW);
    expect(dates).toEqual(['2026-06-09', '2026-06-10', '2026-06-11']);
  });
});

describe('bucketsToSeries', () => {
  it('zero-fills missing days and aligns counts by UTC date', () => {
    const buckets = [{ day: '2026-06-11', count: 5 }, { day: '2026-06-09', count: 2 }];
    expect(bucketsToSeries(buckets, 3, NOW)).toEqual([2, 0, 5]);
  });

  it('returns an all-zero series when there are no buckets', () => {
    expect(bucketsToSeries([], 3, NOW)).toEqual([0, 0, 0]);
  });
});

describe('seriesDelta', () => {
  it('computes percent change between first and second half (up)', () => {
    expect(seriesDelta([1, 1, 3, 3])).toEqual({ delta: '100%', up: true });
  });

  it('reports a downward delta', () => {
    expect(seriesDelta([4, 4, 1, 1])).toEqual({ delta: '75%', up: false });
  });

  it('returns null when the earlier half is empty (no baseline)', () => {
    expect(seriesDelta([0, 0, 5, 5])).toBeNull();
  });
});

describe('pivotTokenSeries', () => {
  it('groups llm_tokens_in/out into dense daily series, ignoring other metrics', () => {
    const rows = [
      { window_start: '2026-06-11T09:00:00Z', metric: 'llm_tokens_in', value: 100 },
      { window_start: '2026-06-11T10:00:00Z', metric: 'llm_tokens_in', value: 50 },
      { window_start: '2026-06-09T10:00:00Z', metric: 'llm_tokens_out', value: 20 },
      { window_start: '2026-06-11T10:00:00Z', metric: 'llm_cost_est', value: 999 },
    ];
    const out = pivotTokenSeries(rows, 3, NOW);
    expect(out).toEqual({
      'Tokens in': [0, 0, 150],
      'Tokens out': [20, 0, 0],
    });
  });

  it('always returns both keys as equal-length zero-filled series', () => {
    const out = pivotTokenSeries([], 3, NOW);
    expect(out).toEqual({ 'Tokens in': [0, 0, 0], 'Tokens out': [0, 0, 0] });
  });
});
