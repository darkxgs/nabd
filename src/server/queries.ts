import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Connection } from "@/db";
import { rawQuery } from "@/db/raw";
import { alerts, channels, incidentUpdates, incidents, monitors, statusPageMonitors, statusPages, workspaces, type Monitor, type MonitorState } from "@/db/schema";
import { uptimePct } from "@/lib/rules";
import { addDays, localDay } from "@/lib/time";

export type Beat = { at: Date; ok: boolean; latencyMs: number | null; status: number | null; error: string | null };
export type Windows = { d1: number | null; d7: number | null; d30: number | null; d90: number | null; avg1: number | null };

const asDate = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

/** The last `n` checks per monitor, oldest first: the beat strip. */
export async function beats(conn: Connection, ids: string[], n = 48): Promise<Map<string, Beat[]>> {
  const out = new Map<string, Beat[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const rows = await rawQuery<{ monitor_id: string; checked_at: string; ok: boolean; latency_ms: number | null; status_code: number | null; error: string | null }>(
    conn.raw,
    `SELECT monitor_id, checked_at, ok, latency_ms, status_code, error FROM (
       SELECT c.*, row_number() OVER (PARTITION BY monitor_id ORDER BY checked_at DESC) AS rn
       FROM nabd.checks c WHERE monitor_id = ANY($1::text[]) AND checked_at > now() - interval '30 hours') x
     WHERE rn <= $2 ORDER BY checked_at`,
    [ids, n],
  );
  for (const r of rows) {
    out.get(r.monitor_id)?.push({ at: asDate(r.checked_at), ok: r.ok, latencyMs: r.latency_ms == null ? null : Number(r.latency_ms), status: r.status_code, error: r.error });
  }
  return out;
}

/** Uptime over 24 hours, 7, 30 and 90 days, plus the 24-hour average response time. */
export async function windows(conn: Connection, ids: string[]): Promise<Map<string, Windows>> {
  const out = new Map<string, Windows>();
  if (!ids.length) return out;
  const rows = await rawQuery<Record<string, number | string | null>>(
    conn.raw,
    `SELECT monitor_id,
       sum(total) FILTER (WHERE hour >= now() - interval '24 hours')::int AS t1, sum(failures) FILTER (WHERE hour >= now() - interval '24 hours')::int AS f1,
       sum(total) FILTER (WHERE hour >= now() - interval '7 days')::int AS t7, sum(failures) FILTER (WHERE hour >= now() - interval '7 days')::int AS f7,
       sum(total) FILTER (WHERE hour >= now() - interval '30 days')::int AS t30, sum(failures) FILTER (WHERE hour >= now() - interval '30 days')::int AS f30,
       sum(total)::int AS t90, sum(failures)::int AS f90,
       (sum(latency_sum) FILTER (WHERE hour >= now() - interval '24 hours') / nullif(sum(latency_n) FILTER (WHERE hour >= now() - interval '24 hours'), 0))::int AS avg1
     FROM nabd.check_hours WHERE monitor_id = ANY($1::text[]) AND hour >= now() - interval '90 days'
     GROUP BY monitor_id`,
    [ids],
  );
  for (const r of rows) {
    const n = (k: string) => Number(r[k] ?? 0);
    out.set(String(r.monitor_id), {
      d1: uptimePct(n("t1"), n("f1")),
      d7: uptimePct(n("t7"), n("f7")),
      d30: uptimePct(n("t30"), n("f30")),
      d90: uptimePct(n("t90"), n("f90")),
      avg1: r.avg1 == null ? null : Number(r.avg1),
    });
  }
  return out;
}

export type DayBar = { day: string; total: number; failures: number; pct: number | null; avgMs: number | null };

/** One bar per local day for the last `days` days, including days with no data. */
export async function dailyBars(conn: Connection, ids: string[], tz: string, days = 90): Promise<Map<string, DayBar[]>> {
  const today = localDay(new Date(), tz);
  const first = addDays(today, -(days - 1));
  const rows = ids.length
    ? await rawQuery<{ monitor_id: string; day: string; total: number; failures: number; avg: number | null }>(
        conn.raw,
        `SELECT monitor_id, to_char(hour AT TIME ZONE $2, 'YYYY-MM-DD') AS day, sum(total)::int AS total, sum(failures)::int AS failures,
           (sum(latency_sum) / nullif(sum(latency_n), 0))::int AS avg
         FROM nabd.check_hours WHERE monitor_id = ANY($1::text[]) AND hour >= now() - make_interval(days => $3::int + 1)
         GROUP BY 1, 2`,
        [ids, tz, days],
      )
    : [];
  const out = new Map<string, DayBar[]>();
  for (const id of ids) {
    const mine = new Map(rows.filter((r) => r.monitor_id === id).map((r) => [r.day, r]));
    const bars: DayBar[] = [];
    for (let d = first; d <= today; d = addDays(d, 1)) {
      const r = mine.get(d);
      const total = r ? Number(r.total) : 0;
      const failures = r ? Number(r.failures) : 0;
      bars.push({ day: d, total, failures, pct: uptimePct(total, failures), avgMs: r?.avg == null ? null : Number(r.avg) });
    }
    out.set(id, bars);
  }
  return out;
}

export type MonitorRow = Monitor & { beats: Beat[]; up: Windows | undefined };

export async function listMonitors(conn: Connection, workspaceId: string): Promise<MonitorRow[]> {
  const ms = await conn.db.select().from(monitors).where(eq(monitors.workspaceId, workspaceId)).orderBy(asc(monitors.position), asc(monitors.createdAt));
  const ids = ms.map((m) => m.id);
  const [b, w] = await Promise.all([beats(conn, ids), windows(conn, ids)]);
  return ms.map((m) => ({ ...m, beats: b.get(m.id) ?? [], up: w.get(m.id) }));
}

export const effectiveState = (m: Pick<Monitor, "paused" | "state">): MonitorState | "paused" => (m.paused ? "paused" : m.state);

export async function openIncidents(conn: Connection, workspaceId: string) {
  return conn.db
    .select({ incident: incidents, monitorName: monitors.name })
    .from(incidents)
    .leftJoin(monitors, eq(monitors.id, incidents.monitorId))
    .where(and(eq(incidents.workspaceId, workspaceId), isNull(incidents.resolvedAt)))
    .orderBy(desc(incidents.startedAt));
}

export async function listIncidents(conn: Connection, workspaceId: string, limit = 120) {
  return conn.db
    .select({ incident: incidents, monitorName: monitors.name })
    .from(incidents)
    .leftJoin(monitors, eq(monitors.id, incidents.monitorId))
    .where(eq(incidents.workspaceId, workspaceId))
    .orderBy(desc(incidents.startedAt))
    .limit(limit);
}

export async function incidentWithUpdates(conn: Connection, workspaceId: string, id: string) {
  const [row] = await conn.db
    .select({ incident: incidents, monitor: monitors })
    .from(incidents)
    .leftJoin(monitors, eq(monitors.id, incidents.monitorId))
    .where(and(eq(incidents.id, id), eq(incidents.workspaceId, workspaceId)));
  if (!row) return null;
  const updates = await conn.db.select().from(incidentUpdates).where(eq(incidentUpdates.incidentId, id)).orderBy(asc(incidentUpdates.createdAt));
  const sent = await conn.db
    .select({ alert: alerts, channelName: channels.name, channelKind: channels.kind })
    .from(alerts)
    .leftJoin(channels, eq(channels.id, alerts.channelId))
    .where(eq(alerts.incidentId, id))
    .orderBy(asc(alerts.createdAt));
  return { ...row, updates, alerts: sent };
}

export type ChartPoint = { at: Date; ms: number | null; max?: number | null; ok: boolean; failures?: number; total?: number };

/** Response times for a monitor: every check for 24 hours, hourly averages for longer ranges. */
export async function responseSeries(conn: Connection, monitorId: string, range: "24h" | "7d" | "30d"): Promise<ChartPoint[]> {
  if (range === "24h") {
    const rows = await rawQuery<{ checked_at: string; latency_ms: number | null; ok: boolean }>(
      conn.raw,
      `SELECT checked_at, latency_ms, ok FROM nabd.checks WHERE monitor_id = $1 AND checked_at > now() - interval '24 hours' ORDER BY checked_at`,
      [monitorId],
    );
    return rows.map((r) => ({ at: asDate(r.checked_at), ms: r.latency_ms == null ? null : Number(r.latency_ms), ok: r.ok }));
  }
  const rows = await rawQuery<{ hour: string; avg: number | null; max: number | null; failures: number; total: number }>(
    conn.raw,
    `SELECT hour, (latency_sum / nullif(latency_n, 0))::int AS avg, nullif(latency_max, 0) AS max, failures, total
     FROM nabd.check_hours WHERE monitor_id = $1 AND hour > now() - $2::interval ORDER BY hour`,
    [monitorId, range === "7d" ? "7 days" : "30 days"],
  );
  return rows.map((r) => ({ at: asDate(r.hour), ms: r.avg == null ? null : Number(r.avg), max: r.max == null ? null : Number(r.max), ok: Number(r.failures) === 0, failures: Number(r.failures), total: Number(r.total) }));
}

/** Median and 95th percentile response time over the last 24 hours, from raw checks. */
export async function percentiles(conn: Connection, monitorId: string) {
  const [r] = await rawQuery<{ p50: number | null; p95: number | null; n: number }>(
    conn.raw,
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::int AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95, count(*)::int AS n
     FROM nabd.checks WHERE monitor_id = $1 AND ok AND latency_ms IS NOT NULL AND checked_at > now() - interval '24 hours'`,
    [monitorId],
  );
  return { p50: r?.p50 == null ? null : Number(r.p50), p95: r?.p95 == null ? null : Number(r.p95), n: Number(r?.n ?? 0) };
}

export async function recentChecks(conn: Connection, monitorId: string, limit = 40): Promise<Beat[]> {
  const rows = await rawQuery<{ checked_at: string; ok: boolean; latency_ms: number | null; status_code: number | null; error: string | null }>(
    conn.raw,
    `SELECT checked_at, ok, latency_ms, status_code, error FROM nabd.checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT $2`,
    [monitorId, limit],
  );
  return rows.map((r) => ({ at: asDate(r.checked_at), ok: r.ok, latencyMs: r.latency_ms == null ? null : Number(r.latency_ms), status: r.status_code, error: r.error }));
}

/* ---------------------------- status pages ---------------------------- */

export type Overall = "operational" | "degraded" | "partial" | "major";

export function overallOf(states: (MonitorState | "paused")[]): Overall {
  const live = states.filter((s) => s !== "paused" && s !== "pending");
  const down = live.filter((s) => s === "down").length;
  if (down && down === live.length) return "major";
  if (down) return "partial";
  if (live.some((s) => s === "degraded")) return "degraded";
  return "operational";
}

export async function statusPageBySlug(conn: Connection, slug: string) {
  const [page] = await conn.db.select().from(statusPages).where(eq(statusPages.slug, slug)).limit(1);
  if (!page || !page.published) return null;
  return loadStatusPage(conn, page);
}

export async function loadStatusPage(conn: Connection, page: typeof statusPages.$inferSelect) {
  const [ws] = await conn.db.select().from(workspaces).where(eq(workspaces.id, page.workspaceId));
  const comps = await conn.db
    .select({ link: statusPageMonitors, monitor: monitors })
    .from(statusPageMonitors)
    .innerJoin(monitors, eq(monitors.id, statusPageMonitors.monitorId))
    .where(eq(statusPageMonitors.statusPageId, page.id))
    .orderBy(asc(statusPageMonitors.position));
  const ids = comps.map((c) => c.monitor.id);
  const [bars, w] = await Promise.all([dailyBars(conn, ids, ws.timezone), windows(conn, ids)]);
  const since = new Date(Date.now() - 14 * 24 * 3_600_000);
  // The page's own components, plus notices posted by hand for the whole workspace.
  const manual = and(isNull(incidents.monitorId), eq(incidents.workspaceId, page.workspaceId));
  const incs = await conn.db
    .select()
    .from(incidents)
    .where(ids.length ? or(inArray(incidents.monitorId, ids), manual) : manual)
    .orderBy(desc(incidents.startedAt))
    .limit(60);
  const relevant = incs.filter((i) => !i.resolvedAt || i.startedAt >= since);
  const updates = relevant.length
    ? await conn.db.select().from(incidentUpdates).where(inArray(incidentUpdates.incidentId, relevant.map((i) => i.id))).orderBy(desc(incidentUpdates.createdAt))
    : [];
  const components = comps.map((c) => ({
    id: c.monitor.id,
    label: c.link.label || c.monitor.name,
    labelAr: c.link.labelAr || c.link.label || c.monitor.name,
    state: effectiveState(c.monitor),
    lastCheckedAt: c.monitor.lastCheckedAt,
    bars: bars.get(c.monitor.id) ?? [],
    uptime90: w.get(c.monitor.id)?.d90 ?? null,
  }));
  return {
    page,
    workspace: ws,
    components,
    overall: overallOf(components.map((c) => c.state)),
    lastChecked: comps.reduce<Date | null>((a, c) => (c.monitor.lastCheckedAt && (!a || c.monitor.lastCheckedAt > a) ? c.monitor.lastCheckedAt : a), null),
    incidents: relevant.map((i) => ({
      ...i,
      component: components.find((c) => c.id === i.monitorId),
      updates: updates.filter((u) => u.incidentId === i.id),
    })),
  };
}
export type StatusPageData = NonNullable<Awaited<ReturnType<typeof statusPageBySlug>>>;

/* ------------------------------ dashboard ------------------------------ */

export async function getMonitor(conn: Connection, workspaceId: string, id: string) {
  const [m] = await conn.db.select().from(monitors).where(and(eq(monitors.id, id), eq(monitors.workspaceId, workspaceId))).limit(1);
  return m ?? null;
}

export async function monitorIncidents(conn: Connection, monitorId: string, limit = 8) {
  return conn.db.select().from(incidents).where(eq(incidents.monitorId, monitorId)).orderBy(desc(incidents.startedAt)).limit(limit);
}

export async function listStatusPages(conn: Connection, workspaceId: string) {
  const pages = await conn.db.select().from(statusPages).where(eq(statusPages.workspaceId, workspaceId)).orderBy(asc(statusPages.createdAt));
  if (!pages.length) return [];
  const counts = await conn.db
    .select({ id: statusPageMonitors.statusPageId, n: count() })
    .from(statusPageMonitors)
    .where(inArray(statusPageMonitors.statusPageId, pages.map((p) => p.id)))
    .groupBy(statusPageMonitors.statusPageId);
  return pages.map((p) => ({ ...p, components: Number(counts.find((c) => c.id === p.id)?.n ?? 0) }));
}

export async function statusPageForEdit(conn: Connection, workspaceId: string, id: string) {
  const [page] = await conn.db.select().from(statusPages).where(and(eq(statusPages.id, id), eq(statusPages.workspaceId, workspaceId))).limit(1);
  if (!page) return null;
  const links = await conn.db.select().from(statusPageMonitors).where(eq(statusPageMonitors.statusPageId, id)).orderBy(asc(statusPageMonitors.position));
  return { page, links };
}

export async function listChannels(conn: Connection, workspaceId: string) {
  return conn.db.select().from(channels).where(eq(channels.workspaceId, workspaceId)).orderBy(asc(channels.createdAt));
}

export async function recentAlerts(conn: Connection, workspaceId: string, limit = 40) {
  return conn.db
    .select({ alert: alerts, channelName: channels.name, channelKind: channels.kind, monitorName: monitors.name })
    .from(alerts)
    .leftJoin(channels, eq(channels.id, alerts.channelId))
    .leftJoin(monitors, eq(monitors.id, alerts.monitorId))
    .where(eq(alerts.workspaceId, workspaceId))
    .orderBy(desc(alerts.createdAt))
    .limit(limit);
}
