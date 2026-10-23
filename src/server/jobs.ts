import "server-only";
import { after } from "next/server";
import { getConnection, type Connection } from "@/db";
import { rawQuery } from "@/db/raw";
import { allowPrivateTargets } from "@/lib/app-url";
import { deliverAlerts } from "./alerts";
import { runDueChecks } from "./engine";

/**
 * Claims the right to run a job. Returns false when it ran within the last
 * `everySec` seconds, so bursts of traffic never fan out into duplicate work.
 * Also used as a simple rate limit ("check now" at most every 30 s).
 */
export async function claim(conn: Connection, key: string, everySec: number, force = false) {
  const rows = await rawQuery<{ key: string }>(
    conn.raw,
    `INSERT INTO nabd.app_jobs (key, ran_at) VALUES ($1, now())
     ON CONFLICT (key) DO UPDATE SET ran_at = excluded.ran_at
     WHERE $3::boolean OR nabd.app_jobs.ran_at < now() - make_interval(secs => $2::int)
     RETURNING key`,
    [key, everySec, force],
  );
  return rows.length > 0;
}

export type TickResult = { ran: boolean; checked: number; opened: number; resolved: number; alerts: number; purged: number };

/**
 * One heartbeat of the whole system: run due checks, deliver alerts, and once
 * an hour drop raw checks older than 48 hours (hourly rollups keep 90 days).
 * Called by GitHub Actions every fifteen minutes, by Vercel Cron as a backstop,
 * and after page views.
 */
export async function tick(opts: { force?: boolean; conn?: Connection } = {}): Promise<TickResult> {
  const conn = opts.conn ?? (await getConnection());
  const empty: TickResult = { ran: false, checked: 0, opened: 0, resolved: 0, alerts: 0, purged: 0 };
  if (!(await claim(conn, "tick", 55, !!opts.force))) return empty;
  const r = await runDueChecks(conn, { allowPrivate: allowPrivateTargets(), deadline: Date.now() + 40_000 });
  const a = await deliverAlerts(conn);
  let purged = 0;
  if (await claim(conn, "purge", 3600)) {
    const old = await rawQuery<{ n: number }>(
      conn.raw,
      `WITH d AS (DELETE FROM nabd.checks WHERE checked_at < now() - interval '48 hours' RETURNING 1) SELECT count(*)::int AS n FROM d`,
    );
    await rawQuery(conn.raw, `DELETE FROM nabd.check_hours WHERE hour < now() - interval '95 days'`);
    // Rate-limit stamps ("check now", test alerts) only matter for a few seconds.
    await rawQuery(conn.raw, `DELETE FROM nabd.app_jobs WHERE ran_at < now() - interval '1 day' AND key NOT IN ('tick', 'purge')`);
    purged = old[0]?.n ?? 0;
  }
  return { ran: true, ...r, alerts: a.sent, purged };
}

/** Lets page views keep the monitors fresh between scheduled runs, without slowing the page. */
export function kickTick() {
  after(async () => {
    try {
      await tick();
    } catch (e) {
      console.error("[tick]", e);
    }
  });
}
