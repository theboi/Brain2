/* Brain2 Console — lightweight SVG charts (no chart lib).
   All colors come from CSS vars on the hosting theme scope. */

function nicePath(values, w, h, pad) {
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  return values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y];
  });
}

function smooth(points) {
  if (points.length < 2) return '';
  let d = `M ${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

// Line chart with faint gridlines + dot on last point.
function LineChart({ data, w = 360, h = 150, stroke = 'var(--accent)' }) {
  const pad = 10;
  const pts = nicePath(data, w, h, pad);
  const last = pts[pts.length - 1];
  const grid = [0.25, 0.5, 0.75];
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', height: h }}>
      {grid.map((g, i) => (
        <line key={i} x1={pad} x2={w - pad} y1={pad + g * (h - pad * 2)} y2={pad + g * (h - pad * 2)}
          stroke="var(--border)" strokeWidth="1" />
      ))}
      <path d={smooth(pts)} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={stroke} />
      <circle cx={last[0]} cy={last[1]} r="6.5" fill={stroke} opacity="0.18" />
    </svg>
  );
}

// Area chart — single series with gradient fill.
function AreaChart({ data, w = 360, h = 150, stroke = 'var(--accent)', id = 'a' }) {
  const pad = 10;
  const pts = nicePath(data, w, h, pad);
  const area = `${smooth(pts)} L ${pts[pts.length - 1][0]},${h - pad} L ${pts[0][0]},${h - pad} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', height: h }}>
      <defs>
        <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#area-${id})`} />
      <path d={smooth(pts)} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Stacked area — multiple series, returns clickable legend handled by parent.
function StackedArea({ series, colors, w = 360, h = 150, id = 's' }) {
  const pad = 10;
  const keys = Object.keys(series);
  const n = series[keys[0]].length;
  const stacks = [];
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const col = {};
    keys.forEach((k) => { acc += series[k][i]; col[k] = acc; });
    stacks.push(col);
  }
  const max = Math.max(...stacks.map((s) => s[keys[keys.length - 1]])) || 1;
  const stepX = (w - pad * 2) / (n - 1);
  const yOf = (v) => h - pad - (v / max) * (h - pad * 2);
  const layers = keys.map((k, ki) => {
    const top = stacks.map((s, i) => [pad + i * stepX, yOf(s[k])]);
    const belowKey = ki === 0 ? null : keys[ki - 1];
    const bottom = belowKey
      ? stacks.map((s, i) => [pad + i * stepX, yOf(s[belowKey])]).reverse()
      : [[w - pad, h - pad], [pad, h - pad]];
    const d = `${smooth(top)} L ${bottom.map((p) => `${p[0]},${p[1]}`).join(' L ')} Z`;
    return { k, d, color: colors[ki % colors.length] };
  });
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', height: h }}>
      {layers.map((l) => <path key={l.k} d={l.d} fill={l.color} fillOpacity="0.55" stroke={l.color} strokeWidth="1" />)}
    </svg>
  );
}

// Horizontal bars — top-N categories.
function BarsH({ data, accent = 'var(--accent)', rowH = 30 }) {
  const max = Math.max(...data.map((d) => d.value)) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: 'grid', gridTemplateColumns: '88px 1fr 36px', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', borderRadius: 4, background: accent }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--fg)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}

// Sparkline — tiny inline trend.
function Sparkline({ data, w = 120, h = 26, stroke = 'var(--accent)', fill = false }) {
  const pad = 3;
  const pts = nicePath(data, w, h, pad);
  const area = `${smooth(pts)} L ${pts[pts.length - 1][0]},${h - pad} L ${pts[0][0]},${h - pad} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <path d={area} fill={stroke} opacity="0.12" />}
      <path d={smooth(pts)} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

Object.assign(window, { LineChart, AreaChart, StackedArea, BarsH, Sparkline });
