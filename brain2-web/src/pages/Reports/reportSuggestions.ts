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
    id: 'fin-q2', title: 'Q2 Financial Report', icon: 'barChart', tone: 'accent',
    desc: 'P&L, burn and runway with every figure cited back to your finance sources.',
    formats: ['doc', 'deck'], best: 'doc', sources: 12, est: '~2 min', category: 'Financial',
    why: 'You own the finance sources and open the Q2 folder daily.', match: 98,
    workspaceNames: ['Finance'],
  },
  {
    id: 'board', title: 'Board Briefing', icon: 'briefcase', tone: 'accent',
    desc: 'A one-page executive summary of the quarter, written for your board.',
    formats: ['deck', 'doc'], best: 'deck', sources: 24, est: '~3 min', category: 'Executive',
    why: 'Board meeting in 6 days, per your linked calendar.', match: 95,
    workspaceNames: ['Finance', 'Operations'],
  },
  {
    id: 'sales', title: 'Sales Performance Summary', icon: 'trendingUp', tone: 'success',
    desc: 'Pipeline, wins and churn for the month, broken down by segment.',
    formats: ['doc', 'deck'], best: 'doc', sources: 9, est: '~2 min', category: 'Financial',
    why: 'Pulls from the sales dashboards you ingested last week.', match: 88,
    workspaceNames: ['Sales'],
  },
  {
    id: 'video-q2', title: 'Q2 Earnings Walkthrough', icon: 'play', tone: 'warning',
    desc: 'A 4-minute narrated overview of the quarter, ready to send to the team.',
    formats: ['video'], best: 'video', sources: 12, est: '~6 min', category: 'Executive',
    why: 'New: turn your Q2 numbers into something shareable.', match: 84, isNew: true,
    workspaceNames: ['Finance'],
  },
  {
    id: 'headcount', title: 'Headcount & Cost Snapshot', icon: 'users', tone: 'muted',
    desc: 'Team size and spend versus plan, with a hiring-vs-attrition view.',
    formats: ['doc', 'deck'], best: 'doc', sources: 6, est: '~90 s', category: 'Operations',
    why: 'Frequently requested in your weekly ops review.', match: 79,
    workspaceNames: ['Engineering', 'Operations'],
  },
  {
    id: 'investor', title: 'Investor Update', icon: 'mail', tone: 'muted',
    desc: 'Monthly update with metrics, highlights, lowlights and a clear ask.',
    formats: ['doc'], best: 'doc', sources: 18, est: '~2 min', category: 'Executive',
    why: 'Matches the cadence of your last three updates.', match: 74,
    workspaceNames: ['Finance', 'Operations'],
  },
];

export function reportSuggestionsFor({
  role,
  accessibleWorkspaceNames,
}: {
  role: string;
  accessibleWorkspaceNames: string[];
}): SuggestedReport[] {
  const isOwner = role === 'owner';
  const accessible = new Set(accessibleWorkspaceNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const scoped = isOwner
    ? REPORT_SUGGESTIONS
    : REPORT_SUGGESTIONS.filter((suggestion) =>
      suggestion.workspaceNames.some((name) => accessible.has(name.toLowerCase())));

  if (isOwner) return scoped;

  return scoped.map((suggestion) => ({
    ...suggestion,
    why: suggestion.why.replace(/^You own the /, 'Available from accessible '),
  }));
}
