/* StackedArea — multi-series stacked area chart. */
interface StackedAreaProps {
  series: Record<string, number[]>;
  colors: string[];
  w?: number;
  h?: number;
  id?: string;
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

export function StackedArea({ series, colors, w = 360, h = 150 }: StackedAreaProps) {
  const pad = 10;
  const keys = Object.keys(series);
  const n = series[keys[0]].length;

  const stacks: Record<string, number>[] = [];
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const col: Record<string, number> = {};
    keys.forEach((k) => { acc += series[k][i]; col[k] = acc; });
    stacks.push(col);
  }

  const max = Math.max(...stacks.map((s) => s[keys[keys.length - 1]])) || 1;
  const stepX = (w - pad * 2) / (n - 1);
  const yOf = (v: number) => h - pad - (v / max) * (h - pad * 2);

  const layers = keys.map((k, ki) => {
    const top = stacks.map((s, i): [number, number] => [pad + i * stepX, yOf(s[k])]);
    const belowKey = ki === 0 ? null : keys[ki - 1];
    const bottom: [number, number][] = belowKey
      ? stacks.map((s, i): [number, number] => [pad + i * stepX, yOf(s[belowKey])]).reverse()
      : [[w - pad, h - pad], [pad, h - pad]];
    const d = `${smooth(top)} L ${bottom.map((p) => `${p[0]},${p[1]}`).join(' L ')} Z`;
    return { k, d, color: colors[ki % colors.length] };
  });

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', height: h }}>
      {layers.map((l) => (
        <path key={l.k} d={l.d} fill={l.color} fillOpacity="0.55" stroke={l.color} strokeWidth="1" />
      ))}
    </svg>
  );
}
