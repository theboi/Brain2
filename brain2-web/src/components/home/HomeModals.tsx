/*
 * Home page modals. Agent creation and management live on /agents.
 *
 * (The ingest overlay is the canonical IngestModal in @/pages/Sources/IngestModal.)
 */
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { eventDayLabel, eventToActivityItem, type ActivityEvent } from '@/lib/activity';
import { Modal } from '@/components/ui/Modal';

const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px',
  borderRadius: 8, border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px',
  borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff',
  fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'accent', label: 'Agents', icon: 'sparkles' as IconName },
  { id: 'muted', label: 'Sources', icon: 'file' as IconName },
  { id: 'success', label: 'Wiki', icon: 'check' as IconName },
  { id: 'warning', label: 'Alerts', icon: 'alert' as IconName },
];

const TONE_COLOR: Record<string, string> = {
  accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', muted: 'var(--fg-muted)',
};

export function ActivityModal({ events, onClose }: { events: ActivityEvent[]; onClose: () => void }) {
  const [filter, setFilter] = useState('all');

  const mapped = events.map((e) => ({ ...eventToActivityItem(e), day: eventDayLabel(e.ts) }));
  const rows = filter === 'all' ? mapped : mapped.filter((r) => r.tone === filter);
  const days = [...new Set(rows.map((r) => r.day))];

  return (
    <Modal
      icon="history"
      title="Activity"
      width={720}
      onClose={onClose}
      footer={
        <>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            Showing <b style={{ color: 'var(--fg)' }}>{rows.length}</b> of {mapped.length} events
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button style={ghostBtn} onClick={onClose}><Icon name="external" size={14} /> Open audit log</button>
            <button style={primaryBtn} onClick={onClose}>Done</button>
          </span>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {ACTIVITY_FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px',
                borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600,
                border: on ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: on ? 'var(--accent-soft)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--fg-muted)',
              }}
            >
              {f.icon && <Icon name={f.icon} size={13} color={on ? 'var(--accent)' : 'var(--fg-muted)'} />}
              {f.label}
            </button>
          );
        })}
      </div>

      {days.map((day) => {
        const list = rows.filter((r) => r.day === day);
        return (
          <div key={day}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', margin: '2px 0 6px 2px' }}>
              {day}
            </div>
            <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', overflow: 'hidden' }}>
              {list.map((r, i) => (
                <button
                  key={r.day + r.t + i}
                  style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left', padding: '11px 10px', border: 'none', borderTop: i ? '1px solid var(--border)' : 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--surface-2)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-faint)', width: 40, flexShrink: 0 }}>{r.t}</span>
                  <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: TONE_COLOR[r.tone] }}>
                    <Icon name={r.icon as IconName} size={15} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.text}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 2 }}>{r.meta}</span>
                  </span>
                  <Icon name="chevRight" size={15} color="var(--fg-faint)" />
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {!rows.length && (
        <div style={{ textAlign: 'center', color: 'var(--fg-faint)', padding: '30px 0', fontSize: 13 }}>
          {mapped.length ? 'No events match this filter.' : 'No activity yet.'}
        </div>
      )}
    </Modal>
  );
}
