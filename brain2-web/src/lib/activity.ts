/* Map generic event_outbox events into the dashboard ActivityItem shape. */
import type { ActivityItem } from '@/lib/mockData';

export interface ActivityEvent {
  id: string;
  type: string;
  entity_id: string | null;
  ts: string;
  payload: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  actor_id: string | null;
  action: string | null;
  resource_id: string | null;
  ts: string;
  payload: Record<string, unknown>;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function humanize(s: string): string {
  return s.replace(/[_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function classify(label: string): { icon: string; tone: ActivityItem['tone'] } {
  const l = label.toLowerCase();
  if (/(delete|remove|revoke|fail)/.test(l)) return { icon: 'alert', tone: 'warning' };
  if (/(ingest|source|upload|file)/.test(l)) return { icon: 'file', tone: 'muted' };
  if (/(page|wiki|compile|merge)/.test(l)) return { icon: 'check', tone: 'success' };
  if (/(audit|guard|cite)/.test(l)) return { icon: 'shield', tone: 'warning' };
  return { icon: 'sparkles', tone: 'accent' };
}

export function eventToActivityItem(e: ActivityEvent): ActivityItem {
  const action = typeof e.payload?.action === 'string' ? e.payload.action : null;
  const label = action ?? e.type;
  const { icon, tone } = classify(label);
  const meta = e.entity_id ? String(e.entity_id).slice(0, 28) : e.type;
  return { t: hhmm(e.ts), icon, text: humanize(label), meta, tone };
}

/** 'Today' | 'Yesterday' | localized date - for grouping in the activity modal. */
export function eventDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Earlier';
  const dayUTC = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diffDays = Math.round((dayUTC(now) - dayUTC(d)) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
