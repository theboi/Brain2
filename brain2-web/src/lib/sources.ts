/*
 * Brain2 Console — Sources page data + selectors.
 * Faithful port of docs/design/v1/project/sources-data.js + the filter/chip
 * helpers from sources.jsx, typed for the brain2-web codebase.
 */
import type { IconName } from '@/components/ui/Icon';

export type SourceType = 'pdf' | 'md' | 'url' | 'img' | 'code' | 'audio';
export type IngestStatus = 'pending' | 'running' | 'done' | 'failed';
export type Tone = 'accent' | 'success' | 'warning' | 'destructive' | 'muted';

export interface Source {
  id: string;
  project: string;
  name: string;
  type: SourceType;
  size: string;
  status: IngestStatus;
  topic: string | null;
  tags: string[];
  provenance: string;
  uploader: string;
  created: string;
  updated: string;
  mime: string;
  words: number;
  tokens: number;
  extracted: string;
  error?: string;
  url?: string;
}

export interface StatusTreeRow { id: IngestStatus; label: string; count: number; icon: IconName; tone: Tone; }

export const SOURCE_TREE: {
  projects: { label: string; count: number }[];
  tags: { label: string; count: number }[];
  status: StatusTreeRow[];
  total: number;
} = {
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

export const TYPE_ICON: Record<SourceType, IconName> = {
  pdf: 'file', md: 'hash', url: 'globe', img: 'image', code: 'code', audio: 'sparkles',
};

export const STATUS_CHIP: Record<IngestStatus, { icon: IconName; tone: Tone; label: string }> = {
  done: { icon: 'check', tone: 'success', label: 'ingested' },
  running: { icon: 'loader', tone: 'accent', label: 'running' },
  pending: { icon: 'clock', tone: 'muted', label: 'pending' },
  failed: { icon: 'alert', tone: 'warning', label: 'extraction error' },
};

// Files shown in the ingest modal (the simulated drop payload).
export interface DroppedFile { name: string; type: string; size: string; project: string; topic: string; collision?: boolean; mode: 'wiki' | 'dynamic' | 'static'; }
export const DROPPED: DroppedFile[] = [
  { name: 'darwin-1859.pdf', type: 'pdf', size: '11.2 MB', project: 'research-q3', topic: 'Origin of Species', mode: 'wiki' },
  { name: 'mendel-1866.pdf', type: 'pdf', size: '2.1 MB', project: 'default', topic: 'Cell theory', collision: true, mode: 'wiki' },
  { name: 'schwann-1839.pdf', type: 'pdf', size: '5.1 MB', project: 'default', topic: 'Cell theory', mode: 'wiki' },
  { name: 'lab-readings.csv', type: 'file', size: '420 KB', project: 'default', topic: 'Microscopy', mode: 'dynamic' },
  { name: 'gateway.py', type: 'code', size: '18 KB', project: 'launch-docs', topic: 'LLM Gateway', mode: 'static' },
];

export interface SourceFilter { project: string; tag: string; status: string; }
