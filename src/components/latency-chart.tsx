import type { ChartPoint } from "@/server/queries";
import { formatMs } from "@/lib/rules";
import { fmtDate, fmtTime } from "@/lib/time";

const W = 1000;
const H = 200;

function niceMax(v: number) {
  const steps = [100, 200, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10_000, 15_000, 30_000];
  return steps.find((s) => s >= v * 1.1) ?? Math.ceil(v / 10_000) * 10_000;
}

/**
 * Response time over the chosen range. A failed check has no response time,
 * so failures are drawn as vermilion ticks on the baseline instead of zeros
 * that would pull the line down and lie about speed.
 */
export function LatencyChart({ points, from, to, tz, slowMs, sampleBefore }: { points: ChartPoint[]; from: Date; to: Date; tz: string; slowMs: number; sampleBefore?: Date | null }) {
  const span = to.getTime() - from.getTime();
  const x = (d: Date) => ((d.getTime() - from.getTime()) / span) * W;
  const values = points.flatMap((p) => [p.ms, p.max ?? null]).filter((v): v is number => v != null);
  const max = niceMax(Math.max(slowMs * 0.6, ...values, 100));
  const y = (ms: number) => H - (ms / max) * (H - 8);

  // Break the line where checks are missing or failed, so gaps read as gaps.
  const segments: ChartPoint[][] = [];
  let cur: ChartPoint[] = [];
  const steps = points.slice(1).map((p, i) => p.at.getTime() - points[i].at.getTime()).sort((a, b) => a - b);
  const gap = steps.length ? steps[Math.floor(steps.length / 2)] * 3 : Infinity;
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (p.ms == null || (prev && p.at.getTime() - prev.at.getTime() > gap)) {
      if (cur.length) segments.push(cur);
      cur = [];
    }
    if (p.ms != null) cur.push(p);
  });
  if (cur.length) segments.push(cur);

  const failures = points.filter((p) => !p.ok);
  const showDates = span > 36 * 3_600_000;
  const ticks = Array.from({ length: 5 }, (_, i) => new Date(from.getTime() + (span * i) / 4));
  const sampleX = sampleBefore && sampleBefore > from ? Math.min(W, x(sampleBefore)) : 0;

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-52 w-full" role="img" aria-label="Response time chart">
          {sampleX > 0 ? (
            <>
              <defs>
                <pattern id="sample-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="8" stroke="#d8dde3" strokeWidth="2" />
                </pattern>
              </defs>
              <rect x="0" y="0" width={sampleX} height={H} fill="url(#sample-hatch)" opacity="0.6" />
            </>
          ) : null}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1="0" x2={W} y1={y(max * f)} y2={y(max * f)} stroke="#e6eaee" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {slowMs < max ? (
            <line x1="0" x2={W} y1={y(slowMs)} y2={y(slowMs)} stroke="#b2741a" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.7" />
          ) : null}
          {segments.map((seg, i) => {
            const line = seg.map((p) => `${x(p.at).toFixed(1)},${y(p.ms!).toFixed(1)}`).join(" ");
            const area = `${x(seg[0].at).toFixed(1)},${H} ${line} ${x(seg[seg.length - 1].at).toFixed(1)},${H}`;
            const band = seg.some((p) => p.max != null)
              ? `${seg.map((p) => `${x(p.at).toFixed(1)},${y(p.max ?? p.ms!).toFixed(1)}`).join(" ")} ${[...seg].reverse().map((p) => `${x(p.at).toFixed(1)},${y(p.ms!).toFixed(1)}`).join(" ")}`
              : null;
            return (
              <g key={i}>
                {band ? <polygon points={band} fill="#14181e" opacity="0.07" /> : null}
                <polygon points={area} fill="#13834f" opacity="0.08" />
                <polyline points={line} fill="none" stroke="#13834f" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              </g>
            );
          })}
          {failures.map((p) => (
            <rect key={p.at.getTime()} x={x(p.at) - 1.5} y={H - 14} width="3" height="14" fill="#d6391f" />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-y-0 end-0 flex flex-col justify-between py-0.5 text-end text-[11px] text-faint tnum">
          <span>{formatMs(max)}</span>
          <span>{formatMs(max / 2)}</span>
          <span className="opacity-0">0</span>
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[11.5px] text-faint tnum">
        {ticks.map((t) => (
          <span key={t.getTime()}>{showDates ? fmtDate(t, tz) : fmtTime(t, tz)}</span>
        ))}
      </div>
    </div>
  );
}
