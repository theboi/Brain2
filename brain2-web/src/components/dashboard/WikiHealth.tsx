/* WikiHealth — provenance score + health rows. */
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import type { WikiHealthRow } from '@/lib/mockData';
import type { IconName } from '@/components/ui/Icon';

interface WikiHealthProps {
  score: number;
  label: string;
  coverage: number;
  rows: WikiHealthRow[];
}

export function WikiHealth({ score, label, coverage, rows }: WikiHealthProps) {
  return (
    <Panel
      title="Wiki health"
      action={
        <Badge tone="success" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 7 }}>
          <Icon name="check" size={12} /> {label} · {score}
        </Badge>
      }
    >
      {/* Coverage bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 6 }}>
          <span>Provenance coverage</span>
          <span style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{coverage}%</span>
        </div>
        <div style={{ height: 7, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
          <div style={{ width: `${coverage}%`, height: '100%', borderRadius: 4, background: 'var(--accent)' }} />
        </div>
      </div>

      {/* Health rows */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => {
          const iconColor = r.tone === 'success' ? 'var(--success)' : r.tone === 'warning' ? 'var(--warning)' : 'var(--fg-muted)';
          return (
            <div
              key={r.label}
              style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: i ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
            >
              <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: iconColor }}>
                <Icon name={r.icon as IconName} size={14} />
              </span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)' }}>{r.label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
              <Icon name="chevRight" size={14} color="var(--fg-faint)" />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
