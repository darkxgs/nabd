import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Connection } from "@/db";
import { rawQuery } from "@/db/raw";
import { checks, incidentUpdates, incidents, monitors, type Monitor } from "@/db/schema";
import { appUrl } from "@/lib/app-url";
import { newId } from "@/lib/id";
import { causeAr, formatDuration, formatDurationAr, nextState, type ProbeResult } from "@/lib/rules";
import { queueAlerts } from "./alerts";
import { probe, readCertificate, type CertInfo, type ProbeTarget } from "./probe";

export type EngineOptions = {
  allowPrivate?: boolean;
  /** Test seams: swap the network for fakes. */
  probeFn?: (t: ProbeTarget, o: { allowPrivate?: boolean }) => Promise<ProbeResult>;
  certFn?: (url: string) => Promise<CertInfo | null>;
};

const HOUR = 3_600_000;
const SSL_RECHECK = 12 * HOUR;
const SSL_WARN_DAYS = 14;

type MonitorRow = Record<string, unknown>;
const toMonitor = (r: MonitorRow): Monitor => ({
  id: r.id as string,
  workspaceId: r.workspace_id as string,
  name: r.name as string,
  url: r.url as string,
  method: r.method as Monitor["method"],
  expectedStatus: r.expected_status as string,
  keyword: (r.keyword as string) ?? null,
  keywordMode: r.keyword_mode as Monitor["keywordMode"],
  timeoutMs: Number(r.timeout_ms),
  intervalSec: Number(r.interval_sec),
  slowMs: Number(r.slow_ms),
  confirmAfter: Number(r.confirm_after),
  paused: Boolean(r.paused),
  state: r.state as Monitor["state"],
  stateSince: new Date(r.state_since as string),
  failStreak: Number(r.fail_streak),
  lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at as string) : null,
  lastLatencyMs: r.last_latency_ms == null ? null : Number(r.last_latency_ms),
  lastStatus: r.last_status == null ? null : Number(r.last_status),
  lastError: (r.last_error as string) ?? null,
  nextCheckAt: new Date(r.next_check_at as string),
  sslExpiresAt: r.ssl_expires_at ? new Date(r.ssl_expires_at as string) : null,
  sslIssuer: (r.ssl_issuer as string) ?? null,
  sslCheckedAt: r.ssl_checked_at ? new Date(r.ssl_checked_at as string) : null,
  sslAlertedAt: r.ssl_alerted_at ? new Date(r.ssl_alerted_at as string) : null,
  position: Number(r.position),
  createdAt: new Date(r.created_at as string),
});

/**
 * Takes up to `limit` monitors that are due and pushes their next check into
 * the future in the same statement. Rows locked by another runner are skipped,
 * so two schedulers firing at once split the work instead of doubling it.
 */
export async function claimDue(conn: Connection, now: Date, limit: number): Promise<Monitor[]> {
  const rows = await rawQuery<MonitorRow>(
    conn.raw,
    `UPDATE nabd.monitors m SET next_check_at = $1::timestamptz + make_interval(secs => m.interval_sec)
     WHERE m.id IN (
       SELECT id FROM nabd.monitors
       WHERE NOT paused AND next_check_at <= $1
       ORDER BY next_check_at LIMIT $2 FOR UPDATE SKIP LOCKED)
     RETURNING m.*`,
    [now.toISOString(), limit],
  );
  return rows.map(toMonitor);
}

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/** Checks everything that is due. Returns counts for logs and the cron response. */
export async function runDueChecks(conn: Connection, opts: EngineOptions & { now?: Date; limit?: number; deadline?: number } = {}) {
  const now = opts.now ?? new Date();
  const deadline = opts.deadline ?? Date.now() + 45_000;
  let checked = 0;
  let opened = 0;
  let resolved = 0;
  while (Date.now() < deadline) {
    const due = await claimDue(conn, now, opts.limit ?? 30);
    if (!due.length) break;
    await pool(due, 6, async (m) => {
      const r = await checkMonitor(conn, m, { ...opts, now });
      checked++;
      if (r.event === "down") opened++;
      if (r.event === "up") resolved++;
    });
  }
  return { checked, opened, resolved };
}

/** Runs one monitor's check and records everything that follows from it. */
export async function checkMonitor(conn: Connection, m: Monitor, opts: EngineOptions & { now?: Date } = {}) {
  const at = opts.now ?? new Date();
  const probeFn = opts.probeFn ?? probe;
  const result = await probeFn(
    { url: m.url, method: m.method, expectedStatus: m.expectedStatus, keyword: m.keyword, keywordMode: m.keywordMode, timeoutMs: m.timeoutMs },
    { allowPrivate: opts.allowPrivate },
  );
  const t = await recordResult(conn, m, result, at);
  if (m.url.startsWith("https://") && (!m.sslCheckedAt || at.getTime() - m.sslCheckedAt.getTime() > SSL_RECHECK)) {
    await refreshCertificate(conn, m, at, opts);
  }
  return { result, ...t };
}

export async function recordResult(conn: Connection, m: Monitor, r: ProbeResult, at: Date) {
  const { db, raw } = conn;
  await db.insert(checks).values({ monitorId: m.id, checkedAt: at, ok: r.ok, statusCode: r.statusCode, latencyMs: r.latencyMs, error: r.error });
  const hour = new Date(Math.floor(at.getTime() / HOUR) * HOUR);
  await rawQuery(
    raw,
    `INSERT INTO nabd.check_hours (monitor_id, hour, total, failures, latency_sum, latency_n, latency_max)
     VALUES ($1, $2::timestamptz, 1, $3::int, $4::bigint, $5::int, $4::int)
     ON CONFLICT (monitor_id, hour) DO UPDATE SET
       total = nabd.check_hours.total + 1,
       failures = nabd.check_hours.failures + excluded.failures,
       latency_sum = nabd.check_hours.latency_sum + excluded.latency_sum,
       latency_n = nabd.check_hours.latency_n + excluded.latency_n,
       latency_max = greatest(nabd.check_hours.latency_max, excluded.latency_max)`,
    [m.id, hour.toISOString(), r.ok ? 0 : 1, r.latencyMs ?? 0, r.latencyMs == null ? 0 : 1],
  );

  const t = nextState(m, r);
  await db
    .update(monitors)
    .set({
      state: t.state,
      failStreak: t.failStreak,
      stateSince: t.state !== m.state ? at : m.stateSince,
      lastCheckedAt: at,
      lastLatencyMs: r.latencyMs,
      lastStatus: r.statusCode,
      lastError: r.ok ? null : r.error,
    })
    .where(eq(monitors.id, m.id));

  let incidentId: string | null = null;
  if (t.event === "down") incidentId = await openIncident(conn, m, r, at);
  if (t.event === "up") incidentId = await resolveIncident(conn, m, at);
  return { ...t, incidentId };
}

/** When the current run of failures began: the first failed check after the last good one. */
async function failingSince(conn: Connection, monitorId: string, fallback: Date) {
  const [row] = await rawQuery<{ since: string | null }>(
    conn.raw,
    `SELECT min(checked_at) AS since FROM nabd.checks
     WHERE monitor_id = $1 AND NOT ok
       AND checked_at > coalesce((SELECT max(checked_at) FROM nabd.checks WHERE monitor_id = $1 AND ok), '-infinity'::timestamptz)`,
    [monitorId],
  );
  return row?.since ? new Date(row.since) : fallback;
}

const link = (path: string) => `${appUrl()}${path}`;

async function openIncident(conn: Connection, m: Monitor, r: ProbeResult, at: Date) {
  const since = await failingSince(conn, m.id, at);
  const id = newId("inc");
  const cause = r.error ?? "Check failed";
  const rows = await rawQuery<{ id: string }>(
    conn.raw,
    `INSERT INTO nabd.incidents (id, workspace_id, monitor_id, title, cause, state, started_at)
     VALUES ($1, $2, $3, $4, $5, 'investigating', $6)
     ON CONFLICT (monitor_id) WHERE resolved_at IS NULL DO NOTHING
     RETURNING id`,
    [id, m.workspaceId, m.id, `${m.name} is down`, cause, since.toISOString()],
  );
  if (!rows.length) return null; // another runner opened it first
  await conn.db.insert(incidentUpdates).values({
    id: newId("upd"),
    incidentId: id,
    state: "investigating",
    automatic: true,
    createdAt: at,
    body: `Not responding as expected (${cause}). We're looking into it.`,
    bodyAr: `لا يستجيب كما ينبغي (${causeAr(cause)}). نعمل على معرفة السبب.`,
  });
  await queueAlerts(conn.db, {
    workspaceId: m.workspaceId,
    monitorId: m.id,
    incidentId: id,
    event: "down",
    dedupe: `down:${id}`,
    subject: `Down: ${m.name}`,
    body: `${m.name} (${m.url}) stopped responding: ${cause}. Confirmed by ${Math.max(1, m.failStreak + 1)} check${m.failStreak ? "s" : ""} in a row, failing since ${since.toISOString().slice(11, 16)} UTC.\n\nIncident: ${link(`/app/incidents/${id}`)}`,
  });
  return id;
}

async function resolveIncident(conn: Connection, m: Monitor, at: Date) {
  const [inc] = await conn.db
    .update(incidents)
    .set({ resolvedAt: at, state: "resolved" })
    .where(and(eq(incidents.monitorId, m.id), isNull(incidents.resolvedAt)))
    .returning();
  if (!inc) return null;
  const took = formatDuration(at.getTime() - inc.startedAt.getTime());
  const tookAr = formatDurationAr(at.getTime() - inc.startedAt.getTime());
  await conn.db.insert(incidentUpdates).values({
    id: newId("upd"),
    incidentId: inc.id,
    state: "resolved",
    automatic: true,
    createdAt: at,
    body: `Responding normally again. It was down for ${took}.`,
    bodyAr: `عاد للعمل بشكل طبيعي بعد توقف دام ${tookAr}.`,
  });
  await queueAlerts(conn.db, {
    workspaceId: m.workspaceId,
    monitorId: m.id,
    incidentId: inc.id,
    event: "up",
    dedupe: `up:${inc.id}`,
    subject: `Back up: ${m.name}`,
    body: `${m.name} (${m.url}) is responding again after ${took} down.\n\nIncident: ${link(`/app/incidents/${inc.id}`)}`,
  });
  return inc.id;
}

async function refreshCertificate(conn: Connection, m: Monitor, at: Date, opts: EngineOptions) {
  const cert = await (opts.certFn ?? ((u: string) => readCertificate(u, 8000, { allowPrivate: opts.allowPrivate })))(m.url);
  const patch: Partial<Monitor> = { sslCheckedAt: at };
  if (cert) {
    patch.sslExpiresAt = cert.expiresAt;
    patch.sslIssuer = cert.issuer;
    const daysLeft = Math.floor((cert.expiresAt.getTime() - at.getTime()) / (24 * HOUR));
    const recentlyWarned = m.sslAlertedAt && at.getTime() - m.sslAlertedAt.getTime() < 6 * 24 * HOUR;
    if (daysLeft <= SSL_WARN_DAYS && !recentlyWarned) {
      patch.sslAlertedAt = at;
      await queueAlerts(conn.db, {
        workspaceId: m.workspaceId,
        monitorId: m.id,
        incidentId: null,
        event: "ssl",
        dedupe: `ssl:${m.id}:${cert.expiresAt.toISOString().slice(0, 10)}`,
        subject: daysLeft < 0 ? `SSL certificate expired: ${m.name}` : `SSL certificate expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}: ${m.name}`,
        body: `The certificate for ${new URL(m.url).hostname} ${daysLeft < 0 ? "expired" : "expires"} on ${cert.expiresAt.toISOString().slice(0, 10)}${cert.issuer ? ` (issued by ${cert.issuer})` : ""}. Renew it before visitors see a security warning.\n\nMonitor: ${link(`/app/monitors/${m.id}`)}`,
      });
    }
  }
  await conn.db.update(monitors).set(patch).where(eq(monitors.id, m.id));
}
