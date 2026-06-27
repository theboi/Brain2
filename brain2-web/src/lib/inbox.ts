import { useState, useEffect } from 'react';
import type { IconName } from '@/components/ui/Icon';
import type { Notification } from '@/hooks/useNotifications';

export const INBOX_TONE: Record<string, string> = {
  accent: 'var(--accent)', destructive: 'var(--destructive)',
  warning: 'var(--warning)', success: 'var(--success)', muted: 'var(--fg-muted)',
};

export const INBOX_TONE_SOFT: Record<string, string> = {
  accent: 'var(--accent-soft)', destructive: 'var(--destructive-soft)',
  warning: 'var(--warning-soft)', success: 'var(--success-soft)', muted: 'var(--surface-2)',
};

export interface InboxItem {
  id: string;
  icon: IconName;
  group: string;
  groupKey: string;
  tone: string;
  title: string;
  meta: string;
  itemTone: string;
}

const TYPE_META: Record<string, { label: string; tone: string; icon: IconName }> = {
  report_done: { label: 'Report ready', tone: 'success', icon: 'file' },
  report_failed: { label: 'Report error', tone: 'destructive', icon: 'alert' },
  source_done: { label: 'Source ingested', tone: 'accent', icon: 'sources' },
  source_failed: { label: 'Source error', tone: 'destructive', icon: 'alert' },
  wiki_suggestion: { label: 'Wiki update', tone: 'warning', icon: 'wiki' },
  invite_accepted: { label: 'Team', tone: 'success', icon: 'users' },
};

const DEFAULT_META = { label: 'Notification', tone: 'muted', icon: 'bell' } as const;

function formatNotificationDate(createdAt: string): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

export function notificationToInboxItem(notification: Notification): InboxItem {
  const meta = TYPE_META[notification.type] ?? DEFAULT_META;
  return {
    id: notification.notification_id,
    icon: meta.icon,
    group: meta.label,
    groupKey: notification.type,
    tone: meta.tone,
    title: notification.title,
    meta: formatNotificationDate(notification.created_at),
    itemTone: meta.tone,
  };
}

export function groupedInbox(items: InboxItem[]): { key: string; title: string; icon: IconName; tone: string; items: InboxItem[] }[] {
  const order: string[] = [];
  const map: Record<string, { key: string; title: string; icon: IconName; tone: string; items: InboxItem[] }> = {};
  items.forEach((it) => {
    if (!map[it.groupKey]) { map[it.groupKey] = { key: it.groupKey, title: it.group, icon: it.icon, tone: it.tone, items: [] }; order.push(it.groupKey); }
    map[it.groupKey].items.push(it);
  });
  return order.map((k) => map[k]);
}

const INBOX_STORAGE_KEY = 'b2-inbox-read';

function readInboxIds(): string[] {
  try { return JSON.parse(localStorage.getItem(INBOX_STORAGE_KEY) || '[]'); } catch { return []; }
}

export function useInboxRead() {
  const [ids, setIds] = useState<string[]>(readInboxIds);

  useEffect(() => {
    const on = () => setIds(readInboxIds());
    window.addEventListener('storage', on);
    window.addEventListener('b2-inbox', on);
    return () => { window.removeEventListener('storage', on); window.removeEventListener('b2-inbox', on); };
  }, []);

  const persist = (next: string[]) => {
    const uniq = [...new Set(next)];
    try { localStorage.setItem(INBOX_STORAGE_KEY, JSON.stringify(uniq)); } catch {}
    setIds(uniq);
    window.dispatchEvent(new Event('b2-inbox'));
  };

  return {
    ids,
    isRead: (id: string) => ids.includes(id),
    markAll: (ids: string[]) => persist(ids),
    markRead: (id: string) => persist([...readInboxIds(), id]),
    markUnread: (id: string) => persist(readInboxIds().filter((x) => x !== id)),
    reset: () => persist([]),
  };
}
