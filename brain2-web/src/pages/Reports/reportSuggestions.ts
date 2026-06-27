import type { IconName } from '@/components/ui/Icon';

export type ReportFormatId = 'doc' | 'deck' | 'video';
export type ReportTone = 'accent' | 'success' | 'warning' | 'muted' | 'destructive';

export interface SuggestedReport {
  id: string;
  title: string;
  icon: IconName;
  tone: ReportTone;
  desc: string;
  formats: ReportFormatId[];
  best: ReportFormatId;
  sources: number;
  est: string;
  category: string;
  why: string;
  match: number;
  workspaceNames: string[];
  isNew?: boolean;
}

export const REPORT_SUGGESTIONS: SuggestedReport[] = [
  {
    id: 'weekly-activity-digest',
    title: 'Weekly Activity Digest',
    icon: 'barChart',
    tone: 'accent',
    desc: 'Summarise source changes, wiki edits, decisions, and open follow-ups from the week.',
    formats: ['doc', 'deck'],
    best: 'doc',
    sources: 8,
    est: '2 min',
    category: 'Digest',
    why: 'Best for keeping stakeholders aligned without asking them to comb through workspace updates.',
    match: 92,
    workspaceNames: [],
  },
  {
    id: 'risk-issues-summary',
    title: 'Risk & Issues Summary',
    icon: 'alert',
    tone: 'warning',
    desc: 'Group open risks, blockers, and unresolved questions by severity and owner.',
    formats: ['doc'],
    best: 'doc',
    sources: 6,
    est: '3 min',
    category: 'Analysis',
    why: 'Uses recent notes and tagged wiki content to make latent project risk visible.',
    match: 84,
    workspaceNames: [],
  },
  {
    id: 'onboarding-brief',
    title: 'Onboarding Brief',
    icon: 'users',
    tone: 'success',
    desc: 'Create a structured introduction for new teammates from key workspace concepts and process pages.',
    formats: ['doc', 'deck'],
    best: 'deck',
    sources: 10,
    est: '3 min',
    category: 'Communication',
    why: 'Turns scattered internal knowledge into a guided first-read package.',
    match: 80,
    workspaceNames: [],
  },
  {
    id: 'knowledge-coverage-audit',
    title: 'Knowledge Coverage Audit',
    icon: 'sources',
    tone: 'muted',
    desc: 'Map ingested sources to wiki topics and highlight areas with thin or outdated coverage.',
    formats: ['doc'],
    best: 'doc',
    sources: 12,
    est: '4 min',
    category: 'Audit',
    why: 'Helpful before planning cleanup work or deciding where the knowledge base needs more evidence.',
    match: 76,
    workspaceNames: [],
  },
  {
    id: 'decision-log-brief',
    title: 'Decision Log Brief',
    icon: 'clipboard',
    tone: 'accent',
    desc: 'Extract important decisions, tradeoffs, and next actions from recent workspace material.',
    formats: ['doc', 'deck'],
    best: 'doc',
    sources: 7,
    est: '2 min',
    category: 'Brief',
    why: 'Gives teams a compact record of what changed and why.',
    match: 73,
    workspaceNames: [],
    isNew: true,
  },
  {
    id: 'exec-status-update',
    title: 'Executive Status Update',
    icon: 'trendingUp',
    tone: 'success',
    desc: 'Produce a concise status update with progress, risks, decisions, and asks for leadership.',
    formats: ['deck', 'doc'],
    best: 'deck',
    sources: 9,
    est: '4 min',
    category: 'Status',
    why: 'Frames workspace activity in the format leadership teams usually need.',
    match: 71,
    workspaceNames: [],
  },
];

export function reportSuggestionsFor({
  role,
  accessibleWorkspaceNames,
}: {
  role: string;
  accessibleWorkspaceNames: string[];
}): SuggestedReport[] {
  void role;
  const accessible = new Set(
    accessibleWorkspaceNames.map((name) => name.trim()).filter(Boolean),
  );
  if (accessible.size === 0) return [];

  return REPORT_SUGGESTIONS.filter((suggestion) => {
    if (suggestion.workspaceNames.length === 0) return true;
    return suggestion.workspaceNames.some((name) => accessible.has(name));
  });
}
