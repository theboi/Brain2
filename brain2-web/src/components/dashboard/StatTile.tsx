/* StatTile — big-number stat card with sparkline/area chart underneath. */
import { Panel } from '@/components/ui/Panel';
import { AreaChart } from '@/components/charts/AreaChart';

interface StatTileProps {
  label: string;
  value: string;
  delta?: string;
  deltaUp?: boolean;
  data: number[];
  id?: string;
}

export function StatTile({ label, value, delta, deltaUp = true, data, id = 'st' }: StatTileProps) {
  return (
    <Panel pad={16} style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>{label}</span>
        {delta && (
          <span style={{ fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--mono-font)', color: deltaUp ? 'var(--success)' : 'var(--fg-muted)' }}>
            {deltaUp ? '↑' : '↓'} {delta}
          </span>
        )}
      </div>
      <div style={{
        fontSize: 28, fontWeight: 700, color: 'var(--fg)',
        fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)',
        marginTop: 4, fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
      <div style={{ marginTop: 10 }}>
        <AreaChart data={data} h={48} id={id} />
      </div>
    </Panel>
  );
}

/* Legend — series legend for stacked charts */
interface LegendItem { label: string; color: string; }

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-muted)', cursor: 'pointer' }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: it.color, flexShrink: 0 }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
