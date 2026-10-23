import type { Beat, DayBar } from "@/server/queries";
import { formatMs, formatPct } from "@/lib/rules";
import { fmtDay, fmtTime, type Lang } from "@/lib/time";
import { cn } from "./ui";

/**
 * The signature of the product: one tick per check, newest on the right.
 * Height follows response time on a log scale (so 120 ms and 2 s are both
 * readable), colour follows the result. Empty slots on the left mean the
 * monitor is newer than the strip.
 */
export function BeatStrip({
  beats,
  slots = 48,
  slowMs = 2000,
  tz,
  sampleBefore,
  className,
  tall,
  now,
}: {
  beats: Beat[];
  slots?: number;
  slowMs?: number;
  tz: string;
  sampleBefore?: Date | null;
  className?: string;
  tall?: boolean;
  /** When given, a check from the last 90 seconds grows in as it arrives. */
  now?: Date;
}) {
  const shown = beats.slice(-slots);
  const pad = slots - shown.length;
  const h = (ms: number | null) => {
    if (ms == null) return 100;
    const v = Math.log10(Math.max(40, Math.min(ms, 10_000)));
    return Math.round(28 + ((v - Math.log10(40)) / (Math.log10(10_000) - Math.log10(40))) * 72);
  };
  return (
    <div
      className={cn("grid items-end gap-[2px]", tall ? "h-12" : "h-7", className)}
      style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
      role="img"
      aria-label={`Last ${shown.length} checks: ${shown.filter((b) => !b.ok).length} failed`}
    >
      {Array.from({ length: pad }, (_, i) => (
        <span key={`p${i}`} className="h-[3px] rounded-[1px] bg-rule" />
      ))}
      {shown.map((b, i) => {
        const sample = !!sampleBefore && b.at < sampleBefore;
        const color = !b.ok ? "bg-down" : b.latencyMs != null && b.latencyMs > slowMs ? "bg-slow" : "bg-up";
        const fresh = !!now && i === shown.length - 1 && now.getTime() - b.at.getTime() < 90_000;
        return (
          <span
            key={b.at.getTime()}
            title={`${fmtTime(b.at, tz)}  ${b.ok ? formatMs(b.latencyMs) : (b.error ?? "Failed")}${sample ? "  (sample)" : ""}`}
            className={cn("origin-bottom rounded-[1px]", color, sample && "opacity-45", fresh && "animate-tick-in")}
            style={{ height: `${b.ok ? h(b.latencyMs) : 100}%` }}
          />
        );
      })}
    </div>
  );
}

/** Ninety days at a glance: one cell per local day, coloured by that day's uptime. */
export function DayBars({ bars, sampleDay, lang = "en", className }: { bars: DayBar[]; sampleDay?: string | null; lang?: Lang; className?: string }) {
  return (
    <div className={cn("flex h-8 items-stretch gap-[2px]", className)} role="img" aria-label={lang === "ar" ? "التوفر خلال آخر 90 يومًا" : "Uptime over the last 90 days"}>
      {bars.map((b) => {
        const color = b.pct == null ? "bg-rule" : b.failures === 0 ? "bg-up" : b.pct >= 99 ? "bg-slow" : "bg-down";
        const sample = !!sampleDay && b.day < sampleDay;
        const label =
          b.pct == null
            ? `${fmtDay(b.day, lang)}: ${lang === "ar" ? "لا توجد بيانات" : "no data"}`
            : `${fmtDay(b.day, lang)}: ${formatPct(b.pct)}${b.failures ? (lang === "ar" ? `، ${b.failures} فحص فاشل` : `, ${b.failures} failed check${b.failures === 1 ? "" : "s"}`) : ""}${sample ? (lang === "ar" ? " (بيانات تجريبية)" : " (sample)") : ""}`;
        return <span key={b.day} title={label} className={cn("min-w-0 flex-1 rounded-[1.5px]", color, sample && "opacity-45")} />;
      })}
    </div>
  );
}
