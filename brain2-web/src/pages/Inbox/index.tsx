/*
 * Inbox page — full list of briefing items with read/unread state.
 * Matches the design spec: search + type filter + All/Unread tabs + item list.
 */
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { inboxItems, groupedInbox, useInboxRead, INBOX_TONE, INBOX_TONE_SOFT, type InboxItem } from '@/lib/inbox';

// ── Category tag metadata ─────────────────────────────────────────────────────
const INBOX_TAG: Record<string, { label: string; tone: string }> = {
  digests: { label: 'Digest',         tone: 'accent' },
  errors:  { label: 'Critical error', tone: 'destructive' },
  queries: { label: 'Customer query', tone: 'warning' },
};

function inboxTag(it: InboxItem) {
  return INBOX_TAG[it.groupKey] ?? { label: it.group, tone: it.tone };
}

// ── FilterTab ─────────────────────────────────────────────────────────────────
function FilterTab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 12px', borderRadius: 8,
        border: 'none', background: active ? 'var(--surface)' : 'transparent', cursor: 'pointer',
        fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: active ? 600 : 500,
        color: active ? 'var(--fg)' : 'var(--fg-muted)',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.18)' : 'none',
      }}
    >
      {label}
      <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: active ? 'var(--fg-muted)' : 'var(--fg-faint)' }}>{count}</span>
    </button>
  );
}

// ── TypeFilter dropdown ───────────────────────────────────────────────────────
interface TypeOption { key: string; label: string; tone?: string; count: number }

function TypeFilter({ types, total, value, onPick }: { types: TypeOption[]; total: number; value: string; onPick: (k: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const current = value === 'all' ? { label: 'All types', tone: undefined } : types.find((t) => t.key === value) ?? { label: 'All types', tone: undefined };
  const opts: TypeOption[] = [{ key: 'all', label: 'All types', count: total }, ...types];
  const shown = opts.filter((t) => t.label.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 12px', borderRadius: 10, cursor: 'pointer',
          fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
          background: value === 'all' ? 'var(--surface)' : (INBOX_TONE_SOFT[current.tone ?? ''] ?? 'var(--surface)'),
          color: value === 'all' ? 'var(--fg-muted)' : (INBOX_TONE[current.tone ?? ''] ?? 'var(--fg)'),
        }}
      >
        <Icon name="filter" size={14} />
        <span>{current.label}</span>
        <Icon name="chevDown" size={13} />
      </button>
      {open && (
        <>
          <div onClick={() => { setOpen(false); setQ(''); }} style={{ position: 'fixed', inset: 0, zIndex: 80 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, width: 256, zIndex: 81, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 14px 44px rgba(0,0,0,0.34)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderBottom: '1px solid var(--border)' }}>
              <Icon name="search" size={15} color="var(--fg-muted)" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter types…"
                style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13 }}
              />
            </div>
            <div style={{ maxHeight: 256, overflowY: 'auto', padding: 6 }}>
              {shown.map((t) => {
                const active = value === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => { onPick(t.key); setOpen(false); setQ(''); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '8px 9px', borderRadius: 8,
                      border: 'none', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: active ? 600 : 500,
                      background: active ? 'var(--surface-2)' : 'transparent', color: 'var(--fg)',
                    }}
                    onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                    onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: t.tone ? (INBOX_TONE[t.tone] ?? 'var(--fg-muted)') : 'var(--fg-faint)' }} />
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</span>
                    <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{t.count}</span>
                    {active && <Icon name="check" size={14} color="var(--accent)" />}
                  </button>
                );
              })}
              {!shown.length && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 12.5 }}>No types match "{q}"</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── TagChip ───────────────────────────────────────────────────────────────────
function TagChip({ tone, icon, label }: { tone: string; icon: string; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, height: 20, padding: '0 8px',
      borderRadius: 999, background: INBOX_TONE_SOFT[tone] ?? 'var(--surface-2)', color: INBOX_TONE[tone] ?? 'var(--fg-muted)',
      fontSize: 11, fontWeight: 600, fontFamily: 'var(--ui-font)', whiteSpace: 'nowrap',
    }}>
      <Icon name={icon as IconName} size={11} /> {label}
    </span>
  );
}

// ── InboxRow ──────────────────────────────────────────────────────────────────
function InboxRow({ it, read, onToggle }: { it: InboxItem; read: boolean; onToggle: () => void }) {
  const [hover, setHover] = useState(false);
  const tag = inboxTag(it);
  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, padding: '8px 12px', cursor: 'pointer',
        background: hover ? 'var(--surface-2)' : 'transparent', borderRadius: 9,
        opacity: read ? 0.5 : 1, transition: 'opacity .15s, background .12s',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: read ? 'transparent' : 'var(--accent)' }} />
      <TagChip tone={tag.tone} icon={it.icon} label={tag.label} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: read ? 500 : 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {it.title}
      </span>
      <span style={{ flexShrink: 0, fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap' }}>
        {it.meta}
      </span>
      <span
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        title={read ? 'Mark as unread' : 'Mark as read'}
        style={{
          flexShrink: 0, width: 24, height: 24, borderRadius: 7,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: read ? 'var(--fg-faint)' : 'var(--accent)',
          background: hover ? 'var(--surface)' : 'transparent',
          opacity: hover ? 1 : (read ? 0.5 : 0), transition: 'opacity .12s',
        }}
      >
        <Icon name={read ? 'history' : 'check'} size={14} />
      </span>
    </div>
  );
}

// ── InboxPage ─────────────────────────────────────────────────────────────────
export function InboxPage() {
  const { isRead, markRead, markUnread, markAll, reset } = useInboxRead();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');

  const groups = groupedInbox();
  const all = inboxItems();
  const unreadCount = all.filter((it) => !isRead(it.id)).length;

  const query = q.trim().toLowerCase();
  const filtered = all.filter((it) => {
    if (tab === 'unread' && isRead(it.id)) return false;
    if (cat !== 'all' && it.groupKey !== cat) return false;
    if (query && !(it.title + ' ' + it.meta).toLowerCase().includes(query)) return false;
    return true;
  });

  const toggle = (id: string) => (isRead(id) ? markUnread(id) : markRead(id));
  const hasFilters = query || cat !== 'all';

  const typeOptions = groups.map((g) => ({
    key: g.key,
    label: INBOX_TAG[g.key]?.label ?? g.title,
    tone: INBOX_TAG[g.key]?.tone ?? g.tone,
    count: g.items.length,
  }));

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', scrollbarGutter: 'stable', paddingBottom: 60 }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '34px 22px 60px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 28, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>
              Inbox
            </h1>
            <p style={{ margin: '7px 0 0', fontSize: 13.5, color: 'var(--fg-muted)' }}>
              {unreadCount > 0
                ? <><strong style={{ color: 'var(--fg)', fontWeight: 600 }}>{unreadCount} unread</strong> · {all.length} total</>
                : <>You're all caught up · {all.length} total</>}
            </p>
          </div>
          <button
            onClick={markAll}
            disabled={!unreadCount}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 15px', borderRadius: 9, border: 'none',
              background: unreadCount ? 'var(--accent)' : 'var(--surface-2)',
              color: unreadCount ? '#fff' : 'var(--fg-faint)',
              fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600,
              cursor: unreadCount ? 'pointer' : 'default',
            }}
          >
            <Icon name="check" size={15} color={unreadCount ? '#fff' : 'var(--fg-faint)'} /> Mark all as read
          </button>
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 9, height: 38, padding: '0 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <Icon name="search" size={16} color="var(--fg-muted)" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search inbox…"
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5 }}
            />
            {q && (
              <button onClick={() => setQ('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--fg-muted)', display: 'flex', padding: 0 }}>
                <Icon name="x" size={15} />
              </button>
            )}
          </div>
          <TypeFilter types={typeOptions} total={all.length} value={cat} onPick={setCat} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: 11, background: 'var(--surface-2)', flexShrink: 0 }}>
            <FilterTab label="All" count={all.length} active={tab === 'all'} onClick={() => setTab('all')} />
            <FilterTab label="Unread" count={unreadCount} active={tab === 'unread'} onClick={() => setTab('unread')} />
          </div>
        </div>

        {/* Item list */}
        {filtered.length > 0 ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 5 }}>
            {filtered.map((it, i) => (
              <div key={it.id}>
                {i > 0 && <div style={{ height: 1, background: 'var(--border)', margin: '0 12px' }} />}
                <InboxRow it={it} read={isRead(it.id)} onToggle={() => toggle(it.id)} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '56px 20px', color: 'var(--fg-faint)' }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14, background: 'var(--surface-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
              color: hasFilters ? 'var(--fg-muted)' : 'var(--success)',
            }}>
              <Icon name={hasFilters ? 'search' : 'check'} size={24} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>
              {hasFilters ? 'No matching items' : 'Inbox zero'}
            </div>
            <div style={{ fontSize: 13, marginTop: 5 }}>
              {hasFilters ? 'Try a different search or filter.' : 'No unread items. Nice.'}
            </div>
            {hasFilters && (
              <button
                onClick={() => { setQ(''); setCat('all'); setTab('all'); }}
                style={{ marginTop: 18, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', borderRadius: 8, height: 32, padding: '0 13px', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}
              >
                Clear filters
              </button>
            )}
            {!hasFilters && tab === 'unread' && (
              <button
                onClick={reset}
                style={{ marginTop: 18, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', borderRadius: 8, height: 32, padding: '0 13px', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}
              >
                Restore all as unread
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
