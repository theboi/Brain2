/* Brain2 Console — Agent Chat dummy data. */

const CHAT_AGENTS = [
  { id: 'researcher', name: 'Researcher', model: 'Claude 3.5 Sonnet', status: 'active' },
  { id: 'coder', name: 'Coder', model: 'GPT-4o-mini', status: 'ready' },
  { id: 'editor', name: 'Editor', model: 'llama3 · 8B', status: 'active' },
  { id: 'summariser', name: 'Summariser', model: 'gemini-1.5-flash', status: 'idle' },
];

const CONVERSATIONS = {
  researcher: [
    { id: 'c1', title: 'Where are mitochondria described?', time: '2h', streaming: true },
    { id: 'c2', title: 'Summary of Q3 sources', time: '1d' },
    { id: 'c3', title: 'Hooke vs Schwann — who said what', time: '3d' },
  ],
  coder: [
    { id: 'c4', title: 'Refactor the run_query op', time: '5h' },
  ],
  editor: [
    { id: 'c5', title: 'Tighten the Origins section', time: '1d' },
  ],
  summariser: [],
};

const MESSAGES = {
  c1: [
    { role: 'user', text: 'Compare the **Cell theory** page to its sources and tell me if anything is unsupported.' },
    {
      role: 'assistant',
      tools: [
        { name: 'wiki:get', args: '"Cell theory"', result: 'got 3.1 KB · v7' },
        { name: 'sources:list_for_topic', args: '"Cell theory"', result: '3 sources' },
        { name: 'sources:get', args: '"Hooke 1665"', result: '18 KB extracted' },
      ],
      text: `Most of the page is well supported by its three cited sources. I found **one claim that I can't trace** to any of them:

> "Schwann generalised the theory to animal tissue in 1839."

None of the 3 cited sources (Hooke 1665, schwann-1839.pdf, cell-diagram.png) contain text supporting the *1839* date in that exact framing [#1].

Want me to:
- Open an **Audit** on the Origins section, or
- Search the wider source library for a citing document?`,
      footer: { latency: '3.1s', tokens: '1,840 tok', cost: '$0.014' },
    },
  ],
  c2: [
    { role: 'user', text: 'Give me a 3-bullet summary of the research-q3 sources.' },
    { role: 'assistant', text: `Here's the gist of the **research-q3** project:
- Ingestion and the audit trail are the most-used surfaces.
- Users want raw sources treated as first-class objects.
- Local (Ollama) models are preferred for cost-sensitive tasks.`, footer: { latency: '2.2s', tokens: '910 tok', cost: '$0.006' } },
  ],
  c3: [{ role: 'user', text: 'Who first described cells, Hooke or Schwann?' }, { role: 'assistant', text: '**Robert Hooke** first used the word *cells* in *Micrographia* (1665). Schwann came later, extending the idea to animal tissue.', footer: { latency: '1.4s', tokens: '420 tok', cost: '$0.003' } }],
  c4: [{ role: 'user', text: 'How would you make run_query idempotent?' }, { role: 'assistant', text: 'Attach an `Idempotency-Key` header per mutation and dedupe on it in the task queue — the Store already supports this path.', footer: { latency: '1.9s', tokens: '680 tok', cost: '$0.001' } }],
  c5: [{ role: 'user', text: 'Tighten the Origins paragraph.' }, { role: 'assistant', text: 'Suggested edit applied as an audit suggestion on the **Cell theory** page — accept it from the Wiki → Audit drawer.', footer: { latency: '0.9s', tokens: '210 tok', cost: 'local' } }],
};

const COMPOSER_TOOLS = [
  { id: 'wiki', label: 'wiki', on: true },
  { id: 'sources', label: 'sources', on: true },
  { id: 'run_query', label: 'run_query', on: true },
];

Object.assign(window, { CHAT_AGENTS, CONVERSATIONS, MESSAGES, COMPOSER_TOOLS });
