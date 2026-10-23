// The demo account monitors a page on Nabd itself that misbehaves on a fixed
// schedule, so anyone opening the demo can see an incident open and close.
// Pure and clock-driven, so the seed's sample history follows the same rules.

export type TargetMode = "ok" | "slow" | "down";

/** Down for 20 minutes twice a day (01:20 and 13:20 UTC); slow for 10 minutes every three hours. */
export function demoTargetMode(at: Date): TargetMode {
  const h = at.getUTCHours();
  const m = at.getUTCMinutes();
  if (h % 12 === 1 && m >= 20 && m < 40) return "down";
  if (h % 3 === 0 && m >= 45 && m < 55) return "slow";
  return "ok";
}

/** Every outage window that fits between two instants (for the seed's sample incidents). */
export function demoOutagesBetween(from: Date, to: Date): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (; day < to; day.setUTCDate(day.getUTCDate() + 1)) {
    for (const h of [1, 13]) {
      const start = new Date(day.getTime() + h * 3_600_000 + 20 * 60_000);
      const end = new Date(start.getTime() + 20 * 60_000);
      if (start >= from && end <= to) out.push({ start, end });
    }
  }
  return out;
}

export const DEMO_TARGET_SLOW_MS = 2600;
export const DEMO_TARGET_KEYWORD = "Booking is open";
