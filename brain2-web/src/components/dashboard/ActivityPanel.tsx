/* ActivityPanel — live-feed variant with pulsing green dot. */
import { Icon } from '@/components/ui/Icon';
import { MoreLink } from '@/components/ui/Panel';
import type { ActivityItem } from '@/lib/mockData';
import type { IconName } from '@/components/ui/Icon';

const TONE_COLOR: Record<string, string> = {
  accent:  'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  muted:   'var(--fg-muted)',
};

interface ActivityPanelProps {
  rows: ActivityItem[];
  onViewAll?: () => void;
}

export function ActivityPanel({ rows, onViewAll }: ActivityPanelProps) {
  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ position: 'relative', width: 8, height: 8, display: 'inline-flex', flexShrink: 0 }}>
          <span className="b2-pulse" style={{ position: 'absolute', inset: -1, borderRadius: '50%', background: 'var(--success)', opacity: 0.4 }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }} />
        </span>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Recent activity</h3>
        <span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', color: 'var(--success)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>live</span>
        <span style={{ marginLeft: 'auto' }}>
          <MoreLink onClick={onViewAll}>View all</MoreLink>
        </span>
      </div>
      <div style={{ padding: '4px 16px 10px' }}>
        {rows.length === 0 && (
          <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--fg-faint)' }}>
            No activity yet.
          </div>
        )}
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-faint)', width: 38, flexShrink: 0 }}>{r.t}</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: TONE_COLOR[r.tone] }}>
              <Icon name={r.icon as IconName} size={14} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.text}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{r.meta}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
