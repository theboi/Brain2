/* AreaChart — single-series area chart with gradient fill + faint gridlines. */
interface AreaChartProps {
  data: number[];
  w?: number;
  h?: number;
  stroke?: string;
  id?: string;
}

function nicePath(values: number[], w: number, h: number, pad: number) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  return values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y] as [number, number];
  });
}

function smooth(points: [number, number][]) {
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

export function AreaChart({ data, w = 360, h = 150, stroke = 'var(--accent)', id = 'a' }: AreaChartProps) {
  const pad = 10;
  const pts = nicePath(data, w, h, pad);
  const linePath = smooth(pts);
  const areaPath = `${linePath} L ${pts[pts.length - 1][0]},${h - pad} L ${pts[0][0]},${h - pad} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', height: h }}>
      <defs>
        <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#area-${id})`} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
