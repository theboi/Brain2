/*
 * Types and pure param-shaping for the Report History overlay.
 * Empty/"all" filters are dropped, month is only sent with year, and offset
 * comes from page.
 */

export const HIST_PAGE_SIZE = 8;

export type HistFormat = 'doc' | 'deck' | 'video';
export type HistStatus = 'ready' | 'processing' | 'failed';

export interface HistoryFilters {
  format: 'all' | HistFormat;
  year: number | null;
  month: number | null;
  q: string;
  page: number;
}

export interface HistoryItem {
  report_id: string;
  title: string;
  format: HistFormat;
  date: string;
  year: number;
  month: number;
  meta: string;
  by: 'Schedule' | 'You';
  status: HistStatus;
  category: string | null;
}

export interface ReportHistoryResult {
  items: HistoryItem[];
  total: number;
  type_counts: Record<string, number>;
  periods: Record<string, number[]>;
}

export interface HistoryQueryParams {
  format?: HistFormat;
  year?: number;
  month?: number;
  q?: string;
  limit: number;
  offset: number;
}

export function buildHistoryParams(f: HistoryFilters): HistoryQueryParams {
  const params: HistoryQueryParams = {
    limit: HIST_PAGE_SIZE,
    offset: f.page * HIST_PAGE_SIZE,
  };

  if (f.format !== 'all') params.format = f.format;
  if (f.year != null) {
    params.year = f.year;
    if (f.month != null) params.month = f.month;
  }

  const q = f.q.trim();
  if (q) params.q = q;

  return params;
}
