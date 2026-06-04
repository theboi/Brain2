/* Brain2 Console — Sources page dummy data. */

const SOURCES = [
  {
    id: 'src_8fa21c', project: 'default', name: 'Hooke 1665.pdf', type: 'pdf', size: '8.4 MB', status: 'done',
    topic: 'Micrographia', tags: ['paper'], provenance: 'File upload', uploader: 'alice',
    created: '4d ago', updated: '4d ago', mime: 'application/pdf', words: 4120, tokens: 5380,
    extracted: `# Micrographia

Observations made by **Robert Hooke** with magnifying glasses, touching the minute structure of natural bodies.

## Cells
Examining a thin slice of cork, Hooke observed that it was "all perforated and porous, much like a Honey-comb." He named these pores *cells* — the first recorded use of the term in biology.

## Method
The specimens were prepared with a sharp pen-knife and observed under a compound microscope of Hooke's own design, illuminated by an oil lamp and a water-filled globe to focus the light.

> "I could exceedingly plainly perceive it to be all perforated and porous."`,
  },
  {
    id: 'src_1b77de', project: 'default', name: 'standup-04-12.md', type: 'md', size: '12 KB', status: 'failed',
    topic: null, tags: ['transcript'], provenance: 'File upload', uploader: 'alice',
    created: '6h ago', updated: '2h ago', mime: 'text/markdown', words: 0, tokens: 0,
    error: 'Extraction failed — file appears truncated at byte 8192. The markdown parser hit an unterminated code fence.',
    extracted: '',
  },
  {
    id: 'src_44c019', project: 'research-q3', name: 'anthropic.com/research', type: 'url', size: '— ', status: 'done',
    topic: 'Constitutional AI', tags: ['web'], provenance: 'URL capture', uploader: 'alice',
    created: '2h ago', updated: '2h ago', mime: 'text/html', words: 1880, tokens: 2410,
    url: 'https://www.anthropic.com/research',
    extracted: `# Research overview

A snapshot captured from the web. Links resolve to local citations where possible.

## Highlights
- Scaling interpretability to frontier models
- Measuring and reducing sycophancy
- Constitutional methods for alignment`,
  },
  {
    id: 'src_92a7fb', project: 'default', name: 'schwann-1839.pdf', type: 'pdf', size: '5.1 MB', status: 'done',
    topic: 'Cell theory', tags: ['paper'], provenance: 'File upload', uploader: 'bob',
    created: '4d ago', updated: '4d ago', mime: 'application/pdf', words: 3200, tokens: 4100,
    extracted: `# Microscopical Researches

Theodor Schwann extends the cell concept from plants to animal tissue, proposing that all living things are composed of cells and cell products.`,
  },
  {
    id: 'src_07e3aa', project: 'default', name: 'cell-diagram.png', type: 'img', size: '1.2 MB', status: 'done',
    topic: 'Cell theory', tags: [], provenance: 'File upload', uploader: 'alice',
    created: '4d ago', updated: '4d ago', mime: 'image/png', words: 12, tokens: 30,
    extracted: `# cell-diagram.png\n\nAlt text / OCR: "Labelled diagram of a plant cell — wall, membrane, nucleus, chloroplast, vacuole."`,
  },
  {
    id: 'src_5d12c8', project: 'research-q3', name: 'q3-roadmap.md', type: 'md', size: '34 KB', status: 'running',
    topic: null, tags: ['untagged'], provenance: 'Paste text', uploader: 'alice',
    created: '1m ago', updated: 'now', mime: 'text/markdown', words: 0, tokens: 0,
    extracted: '',
  },
  {
    id: 'src_a8810f', project: 'launch-docs', name: 'gateway.py', type: 'code', size: '18 KB', status: 'done',
    topic: 'LLM Gateway', tags: [], provenance: 'File upload', uploader: 'bob',
    created: '1d ago', updated: '1d ago', mime: 'text/x-python', words: 640, tokens: 2200,
    extracted: '# gateway.py\n\nA per-tenant LLM gateway with a circuit breaker and concurrency semaphore. Routes to Anthropic, Gemini and Ollama providers.',
  },
  {
    id: 'src_3f0b6e', project: 'research-q3', name: 'interview-jane.m4a', type: 'audio', size: '22 MB', status: 'done',
    topic: 'User research Q3', tags: ['transcript'], provenance: 'File upload', uploader: 'alice',
    created: '3d ago', updated: '3d ago', mime: 'audio/m4a', words: 5400, tokens: 7100,
    extracted: '# Interview — Jane (transcript)\n\nSpeaker A: …so the ingestion flow is the part we lean on most.\nSpeaker B: Right, and the audit trail is what sold the team.',
  },
  {
    id: 'src_6c2d90', project: 'research-q3', name: 'pasteur-1861.pdf', type: 'pdf', size: '3.8 MB', status: 'pending',
    topic: null, tags: ['paper'], provenance: 'File upload', uploader: 'alice',
    created: '5m ago', updated: '5m ago', mime: 'application/pdf', words: 0, tokens: 0,
    extracted: '',
  },
];

const SOURCE_TREE = {
  projects: [
    { label: 'default', count: 820 },
    { label: 'research-q3', count: 412 },
    { label: 'launch-docs', count: 52 },
  ],
  tags: [
    { label: 'paper', count: 410 },
    { label: 'transcript', count: 88 },
    { label: 'web', count: 132 },
    { label: 'untagged', count: 654 },
  ],
  status: [
    { id: 'pending', label: 'pending', count: 3, icon: 'dot', tone: 'muted' },
    { id: 'running', label: 'running', count: 1, icon: 'loader', tone: 'accent' },
    { id: 'done', label: 'done', count: 1273, icon: 'check', tone: 'success' },
    { id: 'failed', label: 'failed', count: 7, icon: 'x', tone: 'destructive' },
  ],
  total: 1284,
};

const TYPE_ICON = { pdf: 'file', md: 'hash', url: 'globe', img: 'image', code: 'code', audio: 'sparkles' };
const STATUS_CHIP = {
  done: { icon: 'check', tone: 'success', label: 'ingested' },
  running: { icon: 'loader', tone: 'accent', label: 'running' },
  pending: { icon: 'clock', tone: 'muted', label: 'pending' },
  failed: { icon: 'alert', tone: 'warning', label: 'extraction error' },
};

Object.assign(window, { SOURCES, SOURCE_TREE, TYPE_ICON, STATUS_CHIP });
