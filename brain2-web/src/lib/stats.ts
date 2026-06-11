/* Pure transforms that reshape stats:* backend responses into chart props. */

export interface DayBucket {
  day: string;
  count: number;
}

export interface TokenRow {
  window_start: string;
  metric: string;
  value: number;
}

/** UTC YYYY-MM-DD strings for the last `windowDays` days, oldest first, ending today. */
export function lastNDates(windowDays: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = windowDays - 1; i >= 0; i--) {
    out.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/** Sparse {day,count} buckets -> dense length-`windowDays` series aligned to UTC dates. */
export function bucketsToSeries(buckets: DayBucket[], windowDays: number, now: Date = new Date()): number[] {
  const map = new Map<string, number>();
  for (const b of buckets) map.set(b.day, (map.get(b.day) ?? 0) + b.count);
  return lastNDates(windowDays, now).map((d) => map.get(d) ?? 0);
}

/** Percent change between the first and second half of a series; null when no baseline. */
export function seriesDelta(series: number[]): { delta: string; up: boolean } | null {
  if (series.length < 2) return null;
  const mid = Math.floor(series.length / 2);
  const first = series.slice(0, mid).reduce((a, b) => a + b, 0);
  const second = series.slice(mid).reduce((a, b) => a + b, 0);
  if (first === 0) return null;
  const pct = ((second - first) / first) * 100;
  return { delta: `${Math.min(Math.abs(pct), 100).toFixed(0)}%`, up: pct >= 0 };
}

const TOKEN_METRICS: Record<string, string> = {
  llm_tokens_in: 'Tokens in',
  llm_tokens_out: 'Tokens out',
};

/** stats:llm_tokens rows -> { 'Tokens in': number[], 'Tokens out': number[] } (both length windowDays). */
export function pivotTokenSeries(rows: TokenRow[], windowDays: number, now: Date = new Date()): Record<string, number[]> {
  const byMetric: Record<string, DayBucket[]> = { llm_tokens_in: [], llm_tokens_out: [] };
  for (const r of rows) {
    if (!(r.metric in TOKEN_METRICS)) continue;
    byMetric[r.metric].push({ day: r.window_start.slice(0, 10), count: r.value });
  }

  const out: Record<string, number[]> = {};
  for (const metric of Object.keys(TOKEN_METRICS)) {
    out[TOKEN_METRICS[metric]] = bucketsToSeries(byMetric[metric], windowDays, now);
  }
  return out;
}
