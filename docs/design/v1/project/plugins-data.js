/* Brain2 Console — plugin catalog. First-party only (for now). */

const PLUGINS = [
  {
    id: 'reports', name: 'Reports', icon: 'file', category: 'Operations',
    author: 'Brain2', firstParty: true, version: '1.1.0', installs: '—',
    tagline: 'Generate financial, sales and operations reports on demand or on a schedule, grounded in your sources.',
    long: 'Reports assembles board-ready documents from the numbers and notes already in your workspace. Ask for a quarter, a team or a metric and it pulls the cited figures, writes the narrative and exports a clean PDF — the same reports show up as one-tap actions on Home.',
    permissions: ['sources:read', 'wiki:get'],
    features: [
      'On-demand report generation with cited figures',
      'Quarterly and monthly scheduled runs',
      'Exports to PDF, ready to forward',
    ],
    actions: [
      { title: 'Generate financial report · Q2', est: 'PDF · ~2 min' },
      { title: 'Sales summary · this month', est: 'PDF' },
      { title: 'Headcount & cost snapshot', est: 'PDF' },
    ],
    installed: true, enabled: true,
  },
  {
    id: 'query-desk', name: 'Query Desk', icon: 'users', category: 'Operations',
    author: 'Brain2', firstParty: true, version: '0.7.1', installs: '—',
    tagline: 'Triage waiting customer questions and draft sourced replies your team can approve and send.',
    long: 'Query Desk watches the inbound question queue, matches each one to cited wiki pages and sources, and drafts a reply for a human to approve. Owners can clear the whole queue from a single Home action.',
    permissions: ['wiki:get', 'sources:read'],
    features: [
      'Routes each question to the right cited pages',
      'Drafts replies for one-click approval',
      'Flags questions with no supporting source',
    ],
    actions: [
      { title: 'Draft replies to waiting queries', est: '7 in queue' },
      { title: 'Summarise unanswered questions', est: 'weekly' },
    ],
    installed: true, enabled: true,
  },
  {
    id: 'concepts', name: 'Concepts', icon: 'hash', category: 'Knowledge',
    author: 'Brain2', firstParty: true, version: '1.4.0', installs: '—',
    tagline: 'Extract and link key concepts across your sources and wiki into a navigable concept graph.',
    long: 'Concepts runs over every ingested source and wiki page, lifts the entities and ideas that matter, and connects them into a graph you can browse. Agents query the graph to ground answers and to surface related pages while you read.',
    permissions: ['sources:read', 'wiki:get', 'wiki:put'],
    features: [
      'Auto-extracts entities and ideas on every ingest',
      'Links concepts to the sources that mention them',
      'Adds a “Related concepts” rail to wiki pages',
      'Exposes a concepts:query tool to your agents',
    ],
    actions: [
      { title: 'Rebuild the concept graph', est: 'all sources' },
    ],
    installed: true, enabled: true,
  },
  {
    id: 'citations-guard', name: 'Citations Guard', icon: 'shield', category: 'Quality',
    author: 'Brain2', firstParty: true, version: '0.9.2', installs: '—',
    tagline: 'Verify that every wiki claim resolves to a cited source, and flag drift over time.',
    long: 'Citations Guard watches wiki edits and re-checks each factual claim against the sources cited for it. Uncited or contradicted claims are flagged for review, and a coverage score is reported back to the Home briefing.',
    permissions: ['wiki:get', 'sources:read'],
    features: [
      'Blocks accepting an uncited LLM suggestion',
      'Nightly drift sweep across all pages',
      'Coverage score in Home → Wiki health',
    ],
    actions: [
      { title: 'Audit wiki for unsupported claims', est: '312 pages' },
    ],
    installed: false, enabled: false,
  },
  {
    id: 'web-crawler', name: 'Web Crawler', icon: 'globe', category: 'Ingestion',
    author: 'Brain2', firstParty: true, version: '2.1.0', installs: '—',
    tagline: 'Ingest URLs and re-crawl them on a schedule so the wiki stays current.',
    long: 'Point Web Crawler at a list of URLs or a sitemap. It fetches, cleans and ingests each page, then re-crawls on the cadence you set and re-ingests only what changed.',
    permissions: ['sources:ingest', 'sources:read'],
    features: [
      'Scheduled re-crawls (hourly → weekly)',
      'Diff-aware: only re-ingests changed pages',
      'Respects robots.txt and rate limits',
    ],
    actions: [
      { title: 'Re-crawl tracked sources', est: '1,284 sources' },
    ],
    installed: false, enabled: false,
  },
  {
    id: 'pdf-ocr', name: 'PDF OCR', icon: 'file', category: 'Ingestion',
    author: 'Brain2', firstParty: true, version: '1.0.4', installs: '—',
    tagline: 'Extract text and tables from scanned PDFs and images before they are ingested.',
    long: 'PDF OCR adds an optical-character-recognition step to the ingest pipeline so scanned documents, screenshots and image-only PDFs become searchable, citable sources.',
    permissions: ['sources:ingest'],
    features: [
      'Layout-aware text + table extraction',
      'Runs locally — no document leaves your runtime',
      'Falls back automatically for image-only PDFs',
    ],
    installed: false, enabled: false,
  },
  {
    id: 'digest', name: 'Digest', icon: 'mail', category: 'Delivery',
    author: 'Brain2', firstParty: true, version: '1.2.1', installs: '—',
    tagline: 'Scheduled summaries of ingests, audits and agent activity to email or Telegram.',
    long: 'Digest compiles what happened across the workspace and sends a clean summary on the schedule you choose. The same digests appear in your Home briefing.',
    permissions: ['wiki:get', 'sources:read'],
    features: [
      'Daily and weekly cadences',
      'Delivers to email or a linked Telegram bot',
      'Per-project and per-agent breakdowns',
    ],
    actions: [
      { title: 'Send the weekly exec digest', est: 'to 4 people' },
    ],
    installed: false, enabled: false,
  },
  {
    id: 'glossary', name: 'Glossary', icon: 'tag', category: 'Knowledge',
    author: 'Brain2', firstParty: true, version: '0.6.0', installs: '—',
    tagline: 'Auto-build a glossary of terms from your sources, with definitions and provenance.',
    long: 'Glossary detects domain terms across your corpus, drafts short definitions grounded in the sources, and keeps a single canonical entry per term that agents and readers can reference.',
    permissions: ['sources:read', 'wiki:put'],
    features: [
      'One canonical entry per term',
      'Definitions cite their source passages',
      'Inline term tooltips on wiki pages',
    ],
    installed: false, enabled: false,
  },
  {
    id: 'dedupe', name: 'Dedupe', icon: 'copy', category: 'Quality',
    author: 'Brain2', firstParty: true, version: '0.8.3', installs: '—',
    tagline: 'Detect near-duplicate sources and merge them to keep the corpus clean.',
    long: 'Dedupe fingerprints every source and surfaces near-duplicates — re-uploads, mirrored pages, lightly edited copies — so you can merge them and keep citations pointing at one canonical version.',
    permissions: ['sources:read', 'sources:ingest'],
    features: [
      'Similarity clustering across the corpus',
      'Side-by-side merge with citation rewrite',
      'Runs on every new ingest',
    ],
    installed: false, enabled: false,
  },
];

const PLUGIN_CATEGORIES = ['All', 'Operations', 'Knowledge', 'Ingestion', 'Quality', 'Delivery'];

Object.assign(window, { PLUGINS, PLUGIN_CATEGORIES });
