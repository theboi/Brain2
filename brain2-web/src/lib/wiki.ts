/*
 * Brain2 Console — Wiki page data.
 * Faithful port of docs/design/v1/project/wiki-data.js, typed for brain2-web.
 */

export interface WikiPageData {
  topic: string; project: string; version: number; updated: string; updatedBy: string;
  sources: number; concepts: number; audits: number; content: string;
}

export type RevisionSource = 'user' | 'llm_audit' | 'ingest';
export interface WikiRevision { v: number; t: string; who: string; source: RevisionSource; label: string; }

export type DiffType = 'add' | 'del' | 'ctx';
export interface DiffHunk { type: DiffType; text: string; }

export const WIKI_DIFFS: Record<string, DiffHunk[]> = {
  '6-7': [
    { type: 'ctx', text: '## Origins' },
    { type: 'del', text: 'Robert Hooke first described "cells" in 1665.' },
    { type: 'add', text: 'Robert Hooke first described "cells" in *Micrographia*' },
    { type: 'add', text: '(1665) [^1].' },
    { type: 'ctx', text: '' },
    { type: 'del', text: 'All living organisms have cells.' },
    { type: 'add', text: 'All living organisms are composed of one or more cells,' },
    { type: 'add', text: 'and the cell is the basic unit of structure.' },
    { type: 'ctx', text: '' },
    { type: 'ctx', text: '## Principles' },
  ],
};

export interface Suggestion {
  id: string; section: string; cited: boolean; sourcesCited: string[]; diff: DiffHunk[]; why: string;
}

export interface WikiPageSource { name: string; type: 'pdf' | 'img'; detail: string; id: string; }

export interface AuditLogEntry { t: string; who: string; agent: string; accepted: number; dismissed: number; }
