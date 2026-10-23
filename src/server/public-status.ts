import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { getConnection } from "@/db";
import { alerts, incidentUpdates, incidents, workspaces } from "@/db/schema";
import { listMonitors, statusPageBySlug } from "./queries";
import { DEMO } from "@/lib/demo";

/**
 * Public status pages get their traffic in bursts (during an outage, everyone
 * refreshes at once), so the data behind them is cached for 30 seconds and
 * shared by every visitor. Edits in the dashboard expire it straight away.
 */
export async function getPublicStatus(slug: string) {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 300 });
  cacheTag(`status:${slug}`);
  const data = await statusPageBySlug(await getConnection(), slug);
  if (data) cacheTag(`ws:${data.workspace.id}`);
  return data;
}

/** The demo workspace's monitors for the landing page's live board, cached the same way. */
export async function getDemoBoard() {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 300 });
  cacheTag(`ws:${DEMO.workspaceId}`);
  const conn = await getConnection();
  const [rows, [ws]] = await Promise.all([listMonitors(conn, DEMO.workspaceId), conn.db.select({ sampleBefore: workspaces.sampleBefore }).from(workspaces).where(eq(workspaces.id, DEMO.workspaceId))]);
  const sampleBefore = ws?.sampleBefore ?? null;
  return rows.map((m) => ({
    sampleBefore,
    id: m.id,
    name: m.name,
    url: m.url,
    state: m.paused ? ("paused" as const) : m.state,
    slowMs: m.slowMs,
    lastLatencyMs: m.lastLatencyMs,
    lastCheckedAt: m.lastCheckedAt,
    beats: m.beats,
    uptime30: m.up?.d30 ?? null,
  }));
}

/** The demo target's latest finished outage, for the landing page's walkthrough. */
export async function getDemoOutage() {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 3600 });
  cacheTag(`ws:${DEMO.workspaceId}`);
  const conn = await getConnection();
  const [latest] = await conn.db
    .select()
    .from(incidents)
    .where(and(eq(incidents.monitorId, "mon_target"), isNotNull(incidents.resolvedAt)))
    .orderBy(desc(incidents.startedAt))
    .limit(1);
  if (!latest) return null;
  const [updates, sent, [ws]] = await Promise.all([
    conn.db.select().from(incidentUpdates).where(eq(incidentUpdates.incidentId, latest.id)).orderBy(asc(incidentUpdates.createdAt)),
    conn.db.select({ at: alerts.createdAt, status: alerts.status }).from(alerts).where(eq(alerts.incidentId, latest.id)).orderBy(asc(alerts.createdAt)),
    conn.db.select({ sampleBefore: workspaces.sampleBefore }).from(workspaces).where(eq(workspaces.id, DEMO.workspaceId)),
  ]);
  return { incident: latest, updates, alerts: sent, sampleBefore: ws?.sampleBefore ?? null };
}
