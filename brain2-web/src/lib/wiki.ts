/*
 * Brain2 Console — Wiki page data.
 * Faithful port of docs/design/v1/project/wiki-data.js, typed for brain2-web.
 */

export interface WikiTreePage { topic: string; v: number; isNew?: boolean; audits?: number; }
export interface WikiTreeGroup { project: string; pages: WikiTreePage[]; }

export const WIKI_TREE: WikiTreeGroup[] = [
  { project: 'default', pages: [
    { topic: 'Micrographia', v: 3 },
    { topic: 'Cell theory', v: 7, isNew: true, audits: 3 },
    { topic: 'Bacteria', v: 2 },
    { topic: 'Robert Hooke', v: 2 },
    { topic: 'Microscopy', v: 4 },
    { topic: 'Cell membrane', v: 3 },
    { topic: 'Organelles', v: 2 },
    { topic: 'Mitochondria', v: 1, isNew: true },
    { topic: 'Schwann & Schleiden', v: 2 },
    { topic: 'Prokaryotes', v: 1 },
    { topic: 'DNA', v: 5 },
    { topic: 'Constitutional AI', v: 1 },
  ] },
  { project: 'research-q3', pages: [
    { topic: 'Q3 themes', v: 1 },
    { topic: 'User research Q3', v: 4 },
    { topic: 'Personas', v: 2 },
    { topic: 'Churn analysis', v: 3 },
    { topic: 'Pricing study', v: 1 },
    { topic: 'Onboarding friction', v: 2 },
    { topic: 'Survey results', v: 1 },
  ] },
  { project: 'launch-docs', pages: [
    { topic: 'LLM Gateway', v: 5 },
    { topic: 'Rate limiting', v: 2 },
    { topic: 'Auth & keys', v: 3 },
    { topic: 'Routing', v: 1 },
    { topic: 'Failover', v: 1 },
    { topic: 'Observability', v: 2 },
    { topic: 'Python SDK', v: 4 },
  ] },
];

// Wikilink graph: [[A]] ↔ [[B]] edges within each vault (Obsidian-style).
// Vaults are isolated: links never cross projects.
export const WIKI_GRAPH_LINKS: Record<string, [string, string][]> = {
  'default': [
    ['Cell theory', 'Micrographia'],
    ['Cell theory', 'Bacteria'],
    ['Cell theory', 'Organelles'],
    ['Cell theory', 'Cell membrane'],
    ['Cell theory', 'Schwann & Schleiden'],
    ['Cell theory', 'Prokaryotes'],
    ['Micrographia', 'Robert Hooke'],
    ['Micrographia', 'Microscopy'],
    ['Robert Hooke', 'Microscopy'],
    ['Bacteria', 'Prokaryotes'],
    ['Bacteria', 'Cell membrane'],
    ['Organelles', 'Mitochondria'],
    ['Organelles', 'Cell membrane'],
    ['Mitochondria', 'DNA'],
    ['Prokaryotes', 'DNA'],
  ],
  'research-q3': [
    ['Q3 themes', 'User research Q3'],
    ['Q3 themes', 'Personas'],
    ['Q3 themes', 'Churn analysis'],
    ['Q3 themes', 'Pricing study'],
    ['User research Q3', 'Survey results'],
    ['User research Q3', 'Onboarding friction'],
    ['User research Q3', 'Personas'],
    ['Churn analysis', 'Pricing study'],
    ['Personas', 'Onboarding friction'],
    ['Survey results', 'Churn analysis'],
  ],
  'launch-docs': [
    ['LLM Gateway', 'Rate limiting'],
    ['LLM Gateway', 'Auth & keys'],
    ['LLM Gateway', 'Routing'],
    ['LLM Gateway', 'Failover'],
    ['LLM Gateway', 'Observability'],
    ['LLM Gateway', 'Python SDK'],
    ['Routing', 'Failover'],
    ['Auth & keys', 'Python SDK'],
    ['Observability', 'Rate limiting'],
    ['Routing', 'Observability'],
  ],
};

export interface WikiPageData {
  topic: string; project: string; version: number; updated: string; updatedBy: string;
  sources: number; concepts: number; audits: number; content: string;
}

export const WIKI_PAGE: WikiPageData = {
  topic: 'Cell theory',
  project: 'default',
  version: 7,
  updated: '1h ago',
  updatedBy: 'alice',
  sources: 3,
  concepts: 4,
  audits: 3,
  content: `# Cell theory

All living organisms are composed of one or more cells, and the cell is the basic unit of structure and organisation in all known organisms.

## Origins
Robert Hooke first described "cells" in *Micrographia* (1665) [^1]. The concept was later generalised to plants by Schleiden and to animal tissue by Schwann in 1839 [^2].

## Principles
- All living things are made of one or more cells.
- The cell is the basic structural and functional unit of life.
- All cells arise from pre-existing cells.

## Significance
Cell theory unified biology under a common framework and underpins modern fields from genetics to medicine.

[^1]: Hooke 1665.pdf, p.3
[^2]: schwann-1839.pdf, p.12`,
};

export type RevisionSource = 'user' | 'llm_audit' | 'ingest';
export interface WikiRevision { v: number; t: string; who: string; source: RevisionSource; label: string; }

export const WIKI_REVISIONS: WikiRevision[] = [
  { v: 7, t: '1h ago', who: 'alice', source: 'user', label: 'alice' },
  { v: 6, t: '3h ago', who: 'alice', source: 'llm_audit', label: 'LLM audit (alice ✓)' },
  { v: 5, t: '2d ago', who: 'alice', source: 'user', label: 'alice' },
  { v: 4, t: '4d ago', who: 'system', source: 'ingest', label: 'ingest · Hooke pdf' },
  { v: 3, t: '4d ago', who: 'system', source: 'ingest', label: 'ingest · Wikipedia' },
  { v: 2, t: '4d ago', who: 'alice', source: 'user', label: 'alice' },
  { v: 1, t: '4d ago', who: 'alice', source: 'user', label: 'initial' },
];

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

export const AUDIT_SUGGESTIONS: Suggestion[] = [
  {
    id: 'sg1', section: 'Origins', cited: true, sourcesCited: ['Hooke 1665.pdf'],
    diff: [
      { type: 'del', text: 'first described "cells" in 1665.' },
      { type: 'add', text: 'first described "cells" in *Micrographia* (1665) [^1].' },
    ],
    why: 'Adds the work title and a page-level citation, supported by Hooke 1665.pdf p.3.',
  },
  {
    id: 'sg2', section: 'Principles', cited: true, sourcesCited: ['schwann-1839.pdf'],
    diff: [
      { type: 'del', text: 'New cells come from cells.' },
      { type: 'add', text: 'All cells arise from pre-existing cells.' },
    ],
    why: 'Tightens wording to the canonical phrasing used in Schwann (1839), p.12.',
  },
  {
    id: 'sg3', section: 'Origins', cited: false, sourcesCited: [],
    diff: [
      { type: 'add', text: 'Schwann generalised the theory to animal tissue in 1839.' },
    ],
    why: 'Suggested addition for completeness — but no cited source was found among the 3 page sources.',
  },
];

export interface WikiPageSource { name: string; type: 'pdf' | 'img'; detail: string; id: string; }
export const WIKI_PAGE_SOURCES: WikiPageSource[] = [
  { name: 'Hooke 1665.pdf', type: 'pdf', detail: 'p.1–3 · Origins', id: 'src_8fa21c' },
  { name: 'schwann-1839.pdf', type: 'pdf', detail: 'p.12 · Principles', id: 'src_92a7fb' },
  { name: 'cell-diagram.png', type: 'img', detail: 'figure', id: 'src_07e3aa' },
];

export interface AuditLogEntry { t: string; who: string; agent: string; accepted: number; dismissed: number; }
export const AUDIT_LOG: AuditLogEntry[] = [
  { t: '3h ago', who: 'alice', agent: 'Editor', accepted: 2, dismissed: 1 },
  { t: '2d ago', who: 'alice', agent: 'Researcher', accepted: 1, dismissed: 0 },
];

export const WIKI_PAGES_FLAT = WIKI_TREE.flatMap((g) => g.pages.map((p) => ({ ...p, project: g.project })));
