import { useState, useEffect } from 'react';
import { BRIEFING } from '@/lib/mockData';

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
  icon: string;
  group: string;
  groupKey: string;
  tone: string;
  title: string;
  meta: string;
  itemTone: string;
}

export function inboxItems(): InboxItem[] {
  const out: InboxItem[] = [];
  BRIEFING.forEach((g) =>
    g.items.forEach((it, i) =>
      out.push({ id: g.key + ':' + i, icon: g.icon, group: g.title, groupKey: g.key, tone: g.tone, title: it.title, meta: it.meta, itemTone: it.tone }),
    ),
  );
  return out;
}

export function groupedInbox(): { key: string; title: string; icon: string; tone: string; items: InboxItem[] }[] {
  const order: string[] = [];
  const map: Record<string, { key: string; title: string; icon: string; tone: string; items: InboxItem[] }> = {};
  inboxItems().forEach((it) => {
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
    markAll: () => persist(inboxItems().map((it) => it.id)),
    markRead: (id: string) => persist([...readInboxIds(), id]),
    markUnread: (id: string) => persist(readInboxIds().filter((x) => x !== id)),
    reset: () => persist([]),
  };
}
