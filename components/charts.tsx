import { nok } from '@/lib/format';

const Defs = () => (
  <defs>
    <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e0c48e" /><stop offset="100%" stopColor="#8f7445" /></linearGradient>
  </defs>
);

/** Vertical bar chart (server-rendered SVG, no client JS). Optional second series is stacked. */
export function BarChart({ data, height = 200, money = false }: { data: { label: string; value: number; value2?: number }[]; height?: number; money?: boolean }) {
  const W = 640, H = height, pad = { l: 8, r: 8, t: 22, b: 26 };
  const max = Math.max(1, ...data.map(d => d.value + (d.value2 ?? 0)));
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (v: number) => (H - pad.t - pad.b) * (v / max);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      <Defs />
      {[0.25, 0.5, 0.75, 1].map(f => <line key={f} className="grid-line" x1={pad.l} x2={W - pad.r} y1={H - pad.b - (H - pad.t - pad.b) * f} y2={H - pad.b - (H - pad.t - pad.b) * f} strokeDasharray="2 4" />)}
      {data.map((d, i) => {
        const x = pad.l + i * bw + bw * 0.22, w = bw * 0.56, h1 = y(d.value), h2 = y(d.value2 ?? 0);
        return (
          <g key={d.label}>
            <rect className="c-bar" x={x} y={H - pad.b - h1} width={w} height={Math.max(h1, d.value ? 2 : 0)} rx={3} />
            {d.value2 ? <rect className="c-bar2" x={x} y={H - pad.b - h1 - h2} width={w} height={h2} rx={3} /> : null}
            {(d.value + (d.value2 ?? 0)) > 0 && <text className="val" x={x + w / 2} y={H - pad.b - h1 - h2 - 6} textAnchor="middle">{money ? nok(d.value).replace(/\s?kr/, '') : d.value + (d.value2 ?? 0)}</text>}
            <text x={x + w / 2} y={H - 8} textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Ring showing a share (0–1) with a centred label. */
export function Ring({ value, label, sub }: { value: number; label: string; sub?: string }) {
  const r = 52, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value));
  return (
    <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label={label}>
      <Defs />
      <circle cx="70" cy="70" r={r} fill="none" stroke="#2c2b26" strokeWidth="8" />
      <circle cx="70" cy="70" r={r} fill="none" stroke="url(#goldGrad)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 70 70)" />
      <text x="70" y="74" textAnchor="middle" className="donut-label">{label}</text>
      {sub && <text x="70" y="96" textAnchor="middle" style={{ fill: '#8b8577', fontSize: 9, letterSpacing: '.15em' }}>{sub}</text>}
    </svg>
  );
}
