// brain2-web/src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export const qk = {
  workspaces: () => ['workspaces'] as const,
  workspacesOverview: () => ['workspaces-overview'] as const,
  projects: (workspaceId: string | null) => ['projects', workspaceId] as const,
  vaultIndex: (pid: string) => ['vault', pid, 'index'] as const,
  vaultPage: (pid: string, topic: string) => ['vault', pid, 'page', topic] as const,
  vaultGraph: (pid: string) => ['vault', pid, 'graph'] as const,
  vaultHistory: (pid: string, topic: string) => ['vault', pid, 'history', topic] as const,
  vaultHistoryDiff: (pid: string, sha: string) =>
    ['vault', pid, 'history-diff', sha] as const,
  vaultSearch: (pid: string, q: string) => ['vault', pid, 'search', q] as const,
  sources: (pid: string, filters: object | null = null) =>
    ['sources', pid, filters] as const,
  source: (pid: string, sourceId: string) => ['sources', pid, sourceId] as const,
  sourceExtracted: (pid: string, sourceId: string) =>
    ['sources', pid, sourceId, 'extracted'] as const,
  sourceHistory: (pid: string, sourceId: string) =>
    ['sources', pid, sourceId, 'history'] as const,
  sourceDiff: (pid: string, sourceId: string, version: number) =>
    ['sources', pid, sourceId, 'diff', version] as const,
  reports: (pid: string | null) => ['reports', pid] as const,
  schedules: () => ['schedules'] as const,
  scheduleOccurrences: (start: string, end: string) =>
    ['schedule-occurrences', start, end] as const,
  reportHistory: (pid: string | null, filters: object) =>
    ['report-history', pid, filters] as const,
  statsOverview: () => ['stats', 'overview'] as const,
  statsSources: (d: number) => ['stats', 'sources', d] as const,
  statsQueries: (d: number) => ['stats', 'queries', d] as const,
  statsLlmTokens: (d: number) => ['stats', 'llm_tokens', d] as const,
  statsWikiByProject: () => ['stats', 'wiki_by_project'] as const,
  activity: (limit: number) => ['activity', limit] as const,
  report: (id: string) => ['reports', 'one', id] as const,
  workers: () => ['workers'] as const,
  todos: (status: string | null = null) => ['todos', status] as const,
  todo: (id: string) => ['todo', id] as const,
  folders: (pid: string) => ['folders', pid] as const,
  wikiTopicSources: (pid: string, topic: string) =>
    ['wiki', pid, topic, 'sources'] as const,
  audits: (pid: string, topic: string) => ['audits', pid, topic] as const,
  me: () => ['me'] as const,
  users: () => ['users'] as const,
  userDirectory: (workspaceId: string | null) => ['user-directory', workspaceId] as const,
  userAccess: (userId: string) => ['user-access', userId] as const,
  workspaceMembers: (workspaceId: string) => ['workspace-members', workspaceId] as const,
  vaultAccess: (projectId: string) => ['vault-access', projectId] as const,
  groups: () => ['groups'] as const,
  guests: () => ['guests'] as const,
  orgGraph: () => ['graph', 'org'] as const,
  liveVaultGraph: (pid: string) => ['graph', 'vault', pid] as const,
};
