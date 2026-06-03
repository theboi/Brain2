/* BarsH — horizontal bar chart for top-N category comparison. */
interface BarsDatum {
  label: string;
  value: number;
}

interface BarsHProps {
  data: BarsDatum[];
  accent?: string;
}

export function BarsH({ data, accent = 'var(--accent)' }: BarsHProps) {
  const max = Math.max(...data.map((d) => d.value)) || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d) => (
        <div
          key={d.label}
          style={{ display: 'grid', gridTemplateColumns: '88px 1fr 36px', alignItems: 'center', gap: 10 }}
        >
          <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {d.label}
          </span>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', borderRadius: 4, background: accent }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--fg)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {d.value}
          </span>
        </div>
      ))}
    </div>
  );
}
