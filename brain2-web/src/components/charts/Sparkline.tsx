/* Sparkline — tiny inline trend chart (no axes, no labels). */
interface SparklineProps {
  data: number[];
  w?: number;
  h?: number;
  stroke?: string;
  fill?: boolean;
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

export function Sparkline({ data, w = 120, h = 26, stroke = 'var(--accent)', fill = false }: SparklineProps) {
  const pad = 3;
  const pts = nicePath(data, w, h, pad);
  const linePath = smooth(pts);
  const areaPath = `${linePath} L ${pts[pts.length - 1][0]},${h - pad} L ${pts[0][0]},${h - pad} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <path d={areaPath} fill={stroke} opacity="0.12" />}
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
