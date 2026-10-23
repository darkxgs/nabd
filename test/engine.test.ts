// The check engine against a real Postgres engine (PGlite) and a real local
// HTTP server. Only the clock and, where noted, the network are faked.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { runMigrations } from "@/db/migrate";
import { rawQuery } from "@/db/raw";
import type { Connection, DB } from "@/db";
import { DEMO, DEMO_MONITORS, applyDemoConfig } from "@/db/seed";
import { SEEDED_MONITOR_IDS } from "@/lib/demo";
import type { ProbeResult } from "@/lib/rules";
import { deliverAlerts, signBody, validateChannelTarget } from "@/server/alerts";
import { checkMonitor, claimDue, runDueChecks } from "@/server/engine";
import { probe } from "@/server/probe";
import { storedKey } from "@/server/keys";

let server: http.Server;
let base = "";
let conn: Connection;
let db: DB;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/ok") return res.end("<h1>Booking is open</h1>");
    if (req.url === "/down") return (res.statusCode = 503), res.end("nope");
    if (req.url === "/hop") return res.writeHead(302, { location: "/hop2" }).end();
    if (req.url === "/hop2") return res.writeHead(301, { location: "/ok" }).end();
    if (req.url === "/slow") return void setTimeout(() => res.end("late"), 1500);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const client = await PGlite.create();
  conn = { db: drizzle(client, { schema }) as unknown as DB, raw: { kind: "pglite", client } };
  db = conn.db;
  await runMigrations(conn.raw, { seed: false });
  await db.insert(schema.users).values({ id: "u1", email: "a@b.c", name: "A", passwordHash: "x" });
  await db.insert(schema.workspaces).values({ id: "w1", ownerId: "u1", name: "Test" });
  await db.insert(schema.channels).values([
    { id: "c1", workspaceId: "w1", kind: "email", name: "Email", target: "ops@example.com", secret: "s1" },
    { id: "c2", workspaceId: "w1", kind: "webhook", name: "Hook", target: "https://example.com/hook", secret: "s2" },
  ]);
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const target = (path: string, extra: Partial<Parameters<typeof probe>[0]> = {}) => ({
  url: base + path,
  method: "GET" as const,
  expectedStatus: "200-399",
  keyword: null,
  keywordMode: "contains" as const,
  timeoutMs: 3000,
  ...extra,
});

describe("probing a real server", () => {
  it("passes a healthy page, follows redirects and finds the keyword", async () => {
    const r = await probe(target("/hop", { keyword: "booking is OPEN" }), { allowPrivate: true });
    expect(r).toMatchObject({ ok: true, statusCode: 200, error: null });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("explains failures in plain words", async () => {
    expect((await probe(target("/down"), { allowPrivate: true })).error).toBe("HTTP 503");
    expect((await probe(target("/ok", { keyword: "Closed" }), { allowPrivate: true })).error).toBe('"Closed" not on the page');
    expect((await probe(target("/ok", { keyword: "Booking", keywordMode: "absent" }), { allowPrivate: true })).ok).toBe(false);
    expect((await probe(target("/slow", { timeoutMs: 1000 }), { allowPrivate: true })).error).toBe("Timed out after 1 s");
  });

  it("refuses private addresses unless told otherwise", async () => {
    const r = await probe(target("/ok"));
    expect(r).toMatchObject({ ok: false, error: "Address not allowed (private network)" });
    const r2 = await probe({ ...target("/ok"), url: "http://localhost:1/" });
    expect(r2.error).toBe("Address not allowed (private network)");
  });
});

describe("from checks to incidents and alerts", () => {
  let results: ProbeResult[] = [];
  const fakeProbe = async () => results.shift()!;
  const T0 = new Date("2026-11-02T10:00:00Z");
  const at = (min: number) => new Date(T0.getTime() + min * 60_000);

  it("opens one incident after two failures, alerts every channel once, and closes it on recovery", async () => {
    await db.insert(schema.monitors).values({ id: "m1", workspaceId: "w1", name: "Shop", url: "https://shop.example", confirmAfter: 2, nextCheckAt: T0 });
    const get = async () => (await db.select().from(schema.monitors).where(eq(schema.monitors.id, "m1")))[0];
    const run = (min: number) => get().then((m) => checkMonitor(conn, m, { now: at(min), probeFn: fakeProbe, certFn: async () => null }));

    results = [
      { ok: true, statusCode: 200, latencyMs: 120, error: null },
      { ok: false, statusCode: 503, latencyMs: 80, error: "HTTP 503" },
      { ok: false, statusCode: 503, latencyMs: 85, error: "HTTP 503" },
      { ok: false, statusCode: null, latencyMs: null, error: "Connection reset" },
      { ok: true, statusCode: 200, latencyMs: 140, error: null },
    ];
    expect((await run(0)).event).toBeNull();
    expect((await run(5)).event).toBeNull(); // first failure: not confirmed yet
    const down = await run(10);
    expect(down.event).toBe("down");
    expect((await run(15)).event).toBeNull(); // still down, no second incident

    let incs = await db.select().from(schema.incidents);
    expect(incs).toHaveLength(1);
    expect(incs[0].startedAt.toISOString()).toBe(at(5).toISOString()); // from the first failed check
    expect(incs[0].resolvedAt).toBeNull();

    const up = await run(20);
    expect(up.event).toBe("up");
    incs = await db.select().from(schema.incidents);
    expect(incs[0].state).toBe("resolved");
    const updates = await db.select().from(schema.incidentUpdates).where(eq(schema.incidentUpdates.incidentId, incs[0].id));
    expect(updates.map((u) => u.state).sort()).toEqual(["investigating", "resolved"]);
    expect(updates.find((u) => u.state === "resolved")!.body).toContain("15 min");

    const queued = await db.select().from(schema.alerts);
    expect(queued.map((a) => `${a.event}:${a.channelId}`).sort()).toEqual(["down:c1", "down:c2", "up:c1", "up:c2"]);

    // The hourly rollup saw all five checks.
    const [hour] = await db.select().from(schema.checkHours).where(eq(schema.checkHours.monitorId, "m1"));
    expect(hour).toMatchObject({ total: 5, failures: 3, latencyN: 4, latencyMax: 140 });
  });

  it("delivers each alert once, retries failures, and signs webhooks", async () => {
    const seen: string[] = [];
    const send = async (c: schema.Channel, a: { event: string }) => {
      seen.push(`${a.event}:${c.id}`);
      return c.kind === "webhook" ? { status: "failed" as const, error: "HTTP 500" } : { status: "sent" as const };
    };
    const first = await deliverAlerts(conn, { now: at(30), send });
    expect(first).toEqual({ claimed: 4, sent: 2 });
    expect((await deliverAlerts(conn, { now: at(31), send })).claimed).toBe(0); // webhook retry waits 5 minutes
    await deliverAlerts(conn, { now: at(40), send });
    await deliverAlerts(conn, { now: at(50), send });
    const rows = await db.select().from(schema.alerts);
    expect(rows.filter((r) => r.channelId === "c1").every((r) => r.status === "sent")).toBe(true);
    expect(rows.filter((r) => r.channelId === "c2").every((r) => r.status === "failed" && r.attempts === 3)).toBe(true);
    expect(seen.filter((s) => s.endsWith("c1"))).toHaveLength(2);

    expect(signBody("secret", '{"a":1}')).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(validateChannelTarget("slack", "https://evil.example/hook")).not.toBeNull();
    expect(validateChannelTarget("discord", "https://discord.com/api/webhooks/1/abc")).toBeNull();
  });

  it("splits due monitors between runners that overlap", async () => {
    const now = new Date("2026-11-03T00:00:00Z");
    await db.insert(schema.monitors).values(
      Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, workspaceId: "w1", name: `D${i}`, url: "https://x.example", nextCheckAt: now })),
    );
    await db.update(schema.monitors).set({ nextCheckAt: new Date("2026-12-01T00:00:00Z") }).where(eq(schema.monitors.id, "m1"));
    const [a, b] = await Promise.all([claimDue(conn, now, 4), claimDue(conn, now, 4)]);
    const ids = [...a, ...b].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
    expect((await claimDue(conn, now, 10)).length).toBe(0); // all pushed five minutes out
    const r = await runDueChecks(conn, { now: new Date("2026-11-03T00:05:00Z"), probeFn: async () => ({ ok: true, statusCode: 200, latencyMs: 50, error: null }), certFn: async () => null });
    expect(r.checked).toBe(6);
  });
});

describe("the demo workspace", () => {
  it("seeds real monitors with marked sample history, and resets visitors' changes", async () => {
    const client = await PGlite.create();
    const t = { kind: "pglite" as const, client };
    const now = new Date("2026-11-02T10:07:00Z");
    await runMigrations(t, { now });
    const [ws] = await rawQuery<{ sample_before: string }>(t, `SELECT sample_before FROM nabd.workspaces WHERE id = $1`, [DEMO.workspaceId]);
    expect(new Date(ws.sample_before).toISOString()).toBe(now.toISOString());
    const [{ n }] = await rawQuery<{ n: number }>(t, `SELECT count(*)::int AS n FROM nabd.check_hours`);
    expect(n).toBe(DEMO_MONITORS.length * 90 * 24);
    const [{ f }] = await rawQuery<{ f: number }>(t, `SELECT sum(failures)::int AS f FROM nabd.check_hours WHERE monitor_id <> 'mon_target'`);
    expect(f).toBe(0); // real sites get no invented outages
    const [{ inc }] = await rawQuery<{ inc: number }>(t, `SELECT count(*)::int AS inc FROM nabd.incidents`);
    expect(inc).toBe(28);

    await rawQuery(t, `INSERT INTO nabd.monitors (id, workspace_id, name, url) VALUES ('junk', $1, 'Junk', 'https://junk.example')`, [DEMO.workspaceId]);
    await rawQuery(t, `UPDATE nabd.monitors SET paused = true, url = 'https://changed.example' WHERE id = 'mon_salad'`);
    await applyDemoConfig(t, now);
    const mons = await rawQuery<{ id: string; paused: boolean; url: string }>(t, `SELECT id, paused, url FROM nabd.monitors ORDER BY position`);
    expect(mons.map((m) => m.id)).toEqual(DEMO_MONITORS.map((m) => m.id));
    expect(mons.find((m) => m.id === "mon_salad")).toMatchObject({ paused: false, url: "https://saladstore-eg.vercel.app" });
    // Seif's page lists his real sites only; the test service has its own page.
    const comps = await rawQuery<{ slug: string; monitor_id: string }>(
      t,
      `SELECT p.slug, l.monitor_id FROM nabd.status_page_monitors l JOIN nabd.status_pages p ON p.id = l.status_page_id ORDER BY p.slug, l.position`,
    );
    expect(comps.filter((c) => c.slug === DEMO.statusSlug).map((c) => c.monitor_id)).not.toContain("mon_target");
    expect(comps.filter((c) => c.slug === DEMO.targetSlug).map((c) => c.monitor_id)).toEqual(["mon_mawid", "mon_target"]);
    expect(DEMO_MONITORS.map((m) => m.id)).toEqual([...SEEDED_MONITOR_IDS]);
    await client.close();
  });
});

describe("the session key", () => {
  it("is made once, kept in the database, and found again by every instance", async () => {
    const [a, b] = await Promise.all([storedKey(conn.raw, "session"), storedKey(conn.raw, "session")]);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(b).toBe(a);
    expect(await storedKey(conn.raw, "session")).toBe(a);
    const rows = await rawQuery<{ name: string; value: string }>(conn.raw, `SELECT name, value FROM nabd.app_keys`);
    expect(rows).toEqual([{ name: "session", value: a }]);
  });
});
