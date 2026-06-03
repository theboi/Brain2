/* Brain2 Console — Wiki page dummy data. */

const WIKI_TREE = [
  { project: 'default', pages: [
    { topic: 'Micrographia', v: 3 },
    { topic: 'Cell theory', v: 7, isNew: true, audits: 3 },
    { topic: 'Bacteria', v: 2 },
    { topic: 'Constitutional AI', v: 1 },
  ] },
  { project: 'research-q3', pages: [
    { topic: 'Q3 themes', v: 1 },
    { topic: 'User research Q3', v: 4 },
  ] },
  { project: 'launch-docs', pages: [
    { topic: 'LLM Gateway', v: 5 },
  ] },
];

const WIKI_PAGE = {
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

const WIKI_REVISIONS = [
  { v: 7, t: '1h ago', who: 'alice', source: 'user', label: 'alice' },
  { v: 6, t: '3h ago', who: 'alice', source: 'llm_audit', label: 'LLM audit (alice ✓)' },
  { v: 5, t: '2d ago', who: 'alice', source: 'user', label: 'alice' },
  { v: 4, t: '4d ago', who: 'system', source: 'ingest', label: 'ingest · Hooke pdf' },
  { v: 3, t: '4d ago', who: 'system', source: 'ingest', label: 'ingest · Wikipedia' },
  { v: 2, t: '4d ago', who: 'alice', source: 'user', label: 'alice' },
  { v: 1, t: '4d ago', who: 'alice', source: 'user', label: 'initial' },
];

// diff hunks keyed by "from-to"
const WIKI_DIFFS = {
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

const AUDIT_SUGGESTIONS = [
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

const WIKI_PAGE_SOURCES = [
  { name: 'Hooke 1665.pdf', type: 'pdf', detail: 'p.1–3 · Origins', id: 'src_8fa21c' },
  { name: 'schwann-1839.pdf', type: 'pdf', detail: 'p.12 · Principles', id: 'src_92a7fb' },
  { name: 'cell-diagram.png', type: 'img', detail: 'figure', id: 'src_07e3aa' },
];

const AUDIT_LOG = [
  { t: '3h ago', who: 'alice', agent: 'Editor', accepted: 2, dismissed: 1 },
  { t: '2d ago', who: 'alice', agent: 'Researcher', accepted: 1, dismissed: 0 },
];

Object.assign(window, { WIKI_TREE, WIKI_PAGE, WIKI_REVISIONS, WIKI_DIFFS, AUDIT_SUGGESTIONS, WIKI_PAGE_SOURCES, AUDIT_LOG });
