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

export const REPORT_SUGGESTIONS: SuggestedReport[] = [];

export function reportSuggestionsFor({
  role,
  accessibleWorkspaceNames,
}: {
  role: string;
  accessibleWorkspaceNames: string[];
}): SuggestedReport[] {
  void role;
  void accessibleWorkspaceNames;
  return [];
}
