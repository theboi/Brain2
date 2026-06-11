import { useQuery } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { DayBucket, TokenRow } from '@/lib/stats';

export interface StatsOverview {
  sources_total: number;
  wiki_pages_total: number;
  queries_today: number;
  agents_online: number;
}

export interface WikiByProjectBucket {
  project_id: string;
  count: number;
}

export function useStatsOverview() {
  return useQuery({
    queryKey: qk.statsOverview(),
    queryFn: () => ops<StatsOverview>('stats:overview', {}),
  });
}

export function useStatsSources(windowDays = 30) {
  return useQuery({
    queryKey: qk.statsSources(windowDays),
    queryFn: () => ops<{ buckets: DayBucket[] }>('stats:sources', { window_days: windowDays }),
  });
}

export function useStatsQueries(windowDays = 30) {
  return useQuery({
    queryKey: qk.statsQueries(windowDays),
    queryFn: () => ops<{ buckets: DayBucket[] }>('stats:queries', { window_days: windowDays }),
  });
}

export function useStatsLlmTokens(windowDays = 30) {
  return useQuery({
    queryKey: qk.statsLlmTokens(windowDays),
    queryFn: () => ops<{ rows: TokenRow[] }>('stats:llm_tokens', { window_days: windowDays }),
  });
}

export function useStatsWikiByProject() {
  return useQuery({
    queryKey: qk.statsWikiByProject(),
    queryFn: () => ops<{ buckets: WikiByProjectBucket[] }>('stats:wiki_by_project', {}),
  });
}
