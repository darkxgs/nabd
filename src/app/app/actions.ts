"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq, inArray, max, notInArray } from "drizzle-orm";
import { z } from "zod";
import { alerts, channels, incidentUpdates, incidents, monitors, statusPageMonitors, statusPages, workspaces, type ChannelKind, type IncidentState } from "@/db/schema";
import { allowPrivateTargets } from "@/lib/app-url";
import { DEMO_VISITOR_MONITORS, MAX_MONITORS, RESERVED_SLUGS, SEEDED_MONITOR_IDS, isDemoWorkspace, isSeededMonitor } from "@/lib/demo";
import { newId, newSecret } from "@/lib/id";
import { displayUrl, parseMonitorForm } from "@/lib/monitor-input";
import { formatMs } from "@/lib/rules";
import { isTimeZone } from "@/lib/time";
import { deliverForReal, validateChannelTarget } from "@/server/alerts";
import { requireWorkspace } from "@/server/auth";
import { checkMonitor } from "@/server/engine";
import { claim } from "@/server/jobs";
import { BlockedAddressError, assertFetchableUrl } from "@/server/net-guard";
import { probe } from "@/server/probe";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string; fields?: Record<string, string> };

const fail = (error: string, fields?: Record<string, string>): ActionResult => ({ ok: false, error, fields });

const DEMO_READ_ONLY = "This is part of the shared demo, so it can't be changed here. Create a free account to try it with your own sites.";

function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

/** Public addresses only (localhost is allowed in development, for the demo target). */
function unreachable(url: string): string | null {
  try {
    assertFetchableUrl(url, allowPrivateTargets());
    return null;
  } catch (e) {
    if (e instanceof BlockedAddressError) return "That address is on a private network. Nabd checks from the internet, so it can only reach public sites.";
    return (e as Error).message;
  }
}

/* ------------------------------- monitors ------------------------------- */

export type TestResult = { ok: boolean; summary: string; detail?: string };

/** Runs one check against the form's settings without saving anything. */
export async function testMonitor(form: FormData): Promise<TestResult | ActionResult> {
  const { conn, workspace } = await requireWorkspace();
  const parsed = parseMonitorForm(form);
  if (!parsed.ok) return fail("Check the highlighted fields.", parsed.fields);
  const v = parsed.value;
  const blocked = unreachable(v.url);
  if (blocked) return fail(blocked, { url: blocked });
  if (!(await claim(conn, `test:${workspace.id}`, 5))) return fail("One test at a time. Try again in a few seconds.");
  const r = await probe(
    { url: v.url, method: v.method, expectedStatus: v.expectedStatus, keyword: v.keyword || null, keywordMode: v.keywordMode, timeoutMs: v.timeoutSec * 1000 },
    { allowPrivate: allowPrivateTargets() },
  );
  if (!r.ok) return { ok: false, summary: r.error ?? "The check failed.", detail: r.statusCode ? `HTTP ${r.statusCode}${r.latencyMs != null ? ` after ${formatMs(r.latencyMs)}` : ""}` : undefined };
  const slow = r.latencyMs != null && r.latencyMs > v.slowMs;
  return {
    ok: true,
    summary: `Passed: HTTP ${r.statusCode} in ${formatMs(r.latencyMs)}${slow ? ", which counts as slow" : ""}.`,
    detail: v.keyword ? (v.keywordMode === "contains" ? `Found “${v.keyword}” on the page.` : `“${v.keyword}” isn't on the page.`) : undefined,
  };
}

export async function saveMonitor(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { conn, db, workspace } = await requireWorkspace();
  const id = String(form.get("id") ?? "");
  const parsed = parseMonitorForm(form);
  if (!parsed.ok) return fail("Check the highlighted fields.", parsed.fields);
  const v = parsed.value;
  const blocked = unreachable(v.url);
  if (blocked) return fail("Check the highlighted fields.", { url: blocked });
  const values = {
    name: v.name || displayUrl(v.url),
    url: v.url,
    method: v.method,
    expectedStatus: v.expectedStatus,
    keyword: v.keyword || null,
    keywordMode: v.keywordMode,
    timeoutMs: v.timeoutSec * 1000,
    intervalSec: v.intervalSec,
    slowMs: v.slowMs,
    confirmAfter: v.confirmAfter,
  };

  let monitorId = id;
  if (id) {
    if (isDemoWorkspace(workspace.id) && isSeededMonitor(id)) return fail(DEMO_READ_ONLY);
    const [before] = await db.select().from(monitors).where(and(eq(monitors.id, id), eq(monitors.workspaceId, workspace.id)));
    if (!before) return fail("That monitor no longer exists.");
    const retarget = before.url !== values.url || before.method !== values.method;
    await db
      .update(monitors)
      .set({ ...values, ...(retarget ? { nextCheckAt: new Date(), sslCheckedAt: null, sslExpiresAt: null, sslIssuer: null } : {}) })
      .where(eq(monitors.id, id));
  } else {
    const [{ n }] = await db.select({ n: count() }).from(monitors).where(eq(monitors.workspaceId, workspace.id));
    if (isDemoWorkspace(workspace.id)) {
      const [{ n: mine }] = await db
        .select({ n: count() })
        .from(monitors)
        .where(and(eq(monitors.workspaceId, workspace.id), notInArray(monitors.id, [...SEEDED_MONITOR_IDS])));
      if (Number(mine) >= DEMO_VISITOR_MONITORS) return fail(`Visitors can add ${DEMO_VISITOR_MONITORS} monitors to the shared demo, and that many are here already. They're cleared every night; or create a free account for your own.`);
    } else if (Number(n) >= MAX_MONITORS) {
      return fail(`A workspace can have up to ${MAX_MONITORS} monitors.`);
    }
    const [{ top }] = await db.select({ top: max(monitors.position) }).from(monitors).where(eq(monitors.workspaceId, workspace.id));
    monitorId = newId("mon");
    const now = new Date();
    await db.insert(monitors).values({ id: monitorId, workspaceId: workspace.id, ...values, position: (top ?? -1) + 1, nextCheckAt: new Date(now.getTime() + values.intervalSec * 1000) });
    // The first check runs now, so the new monitor opens with a result instead of "waiting".
    const [created] = await db.select().from(monitors).where(eq(monitors.id, monitorId));
    try {
      await checkMonitor(conn, created, { allowPrivate: allowPrivateTargets(), now });
    } catch (e) {
      console.error("[monitor] first check failed", e);
    }
  }
  updateTag(`ws:${workspace.id}`);
  redirect(`/app/monitors/${monitorId}${id ? "" : "?added=1"}`);
}

export async function checkNow(id: string): Promise<TestResult | ActionResult> {
  const { conn, db, workspace } = await requireWorkspace();
  const [m] = await db.select().from(monitors).where(and(eq(monitors.id, id), eq(monitors.workspaceId, workspace.id)));
  if (!m) return fail("That monitor no longer exists.");
  if (!(await claim(conn, `check:${id}`, 30))) return fail("Checked less than 30 seconds ago. Give it a moment.");
  const r = await checkMonitor(conn, m, { allowPrivate: allowPrivateTargets() });
  refresh();
  return r.result.ok ? { ok: true, summary: `HTTP ${r.result.statusCode} in ${formatMs(r.result.latencyMs)}` } : { ok: false, summary: r.result.error ?? "Check failed" };
}

export async function setPaused(id: string, paused: boolean): Promise<ActionResult> {
  const { db, workspace } = await requireWorkspace();
  if (isDemoWorkspace(workspace.id) && isSeededMonitor(id)) return fail(DEMO_READ_ONLY);
  await db
    .update(monitors)
    .set(paused ? { paused: true } : { paused: false, nextCheckAt: new Date(), failStreak: 0 })
    .where(and(eq(monitors.id, id), eq(monitors.workspaceId, workspace.id)));
  updateTag(`ws:${workspace.id}`);
  refresh();
  return { ok: true };
}

export async function deleteMonitor(id: string): Promise<ActionResult> {
  const { db, workspace } = await requireWorkspace();
  if (isDemoWorkspace(workspace.id) && isSeededMonitor(id)) return fail(DEMO_READ_ONLY);
  // Checks, rollups, incidents and status-page entries go with it (foreign keys cascade).
  await db.delete(monitors).where(and(eq(monitors.id, id), eq(monitors.workspaceId, workspace.id)));
  updateTag(`ws:${workspace.id}`);
  redirect("/app");
}

/* ------------------------------- incidents ------------------------------ */

const STATES = ["investigating", "identified", "monitoring", "resolved"] as const;

export async function acknowledge(id: string): Promise<ActionResult> {
  const { db, workspace } = await requireWorkspace();
  await db.update(incidents).set({ acknowledgedAt: new Date() }).where(and(eq(incidents.id, id), eq(incidents.workspaceId, workspace.id)));
  refresh();
  return { ok: true };
}

const UpdateSchema = z.object({
  incidentId: z.string().min(1),
  state: z.enum(STATES),
  body: z.string().trim().min(3, "Write what's happening.").max(2000, "Keep updates under 2000 characters."),
  bodyAr: z.string().trim().max(2000, "Keep updates under 2000 characters.").optional().default(""),
});

export async function postUpdate(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { db, workspace } = await requireWorkspace();
  if (isDemoWorkspace(workspace.id)) return fail("Posting is turned off in the shared demo, because updates appear on the public status page. Create a free account to try it.");
  const parsed = UpdateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  const [inc] = await db.select().from(incidents).where(and(eq(incidents.id, v.incidentId), eq(incidents.workspaceId, workspace.id)));
  if (!inc) return fail("That incident no longer exists.");
  // A resolved incident takes notes (a write-up, say) but doesn't reopen.
  const state: IncidentState = inc.resolvedAt ? "resolved" : v.state;
  const now = new Date();
  await db.insert(incidentUpdates).values({ id: newId("upd"), incidentId: inc.id, state, body: v.body, bodyAr: v.bodyAr || null, createdAt: now });
  await db
    .update(incidents)
    .set({ state, ...(state === "resolved" && !inc.resolvedAt ? { resolvedAt: now } : {}), acknowledgedAt: inc.acknowledgedAt ?? now })
    .where(eq(incidents.id, inc.id));
  updateTag(`ws:${workspace.id}`);
  refresh();
  return { ok: true, message: state === "resolved" && !inc.resolvedAt ? "Posted and resolved." : "Posted." };
}

const ManualIncident = z.object({
  title: z.string().trim().min(4, "Give the incident a short title.").max(120),
  titleAr: z.string().trim().max(120).optional().default(""),
  state: z.enum(["investigating", "identified", "monitoring"]),
  body: z.string().trim().min(3, "Write what's happening.").max(2000),
  bodyAr: z.string().trim().max(2000).optional().default(""),
});

/** Incidents posted by hand: maintenance, a payment provider outage, anything no check can see. */
export async function createIncident(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { db, workspace } = await requireWorkspace();
  if (isDemoWorkspace(workspace.id)) return fail("Posting is turned off in the shared demo, because incidents appear on the public status page. Create a free account to try it.");
  const parsed = ManualIncident.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  const id = newId("inc");
  const now = new Date();
  await db.insert(incidents).values({ id, workspaceId: workspace.id, monitorId: null, title: v.title, titleAr: v.titleAr || null, state: v.state, startedAt: now, acknowledgedAt: now });
  await db.insert(incidentUpdates).values({ id: newId("upd"), incidentId: id, state: v.state, body: v.body, bodyAr: v.bodyAr || null, createdAt: now });
  updateTag(`ws:${workspace.id}`);
  redirect(`/app/incidents/${id}`);
}

/* ------------------------------ status pages ---------------------------- */

const Component = z.object({ monitorId: z.string(), label: z.string().trim().max(80), labelAr: z.string().trim().max(80) });
const StatusPageSchema = z.object({
  id: z.string().optional().default(""),
  title: z.string().trim().min(2, "Give the page a title.").max(80),
  titleAr: z.string().trim().max(80).optional().default(""),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Use at least 3 characters.")
    .max(40, "Use at most 40 characters.")
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single dashes.")
    .refine((s) => !RESERVED_SLUGS.has(s), "That address is reserved. Try another."),
  intro: z.string().trim().max(400).optional().default(""),
  introAr: z.string().trim().max(400).optional().default(""),
  defaultLocale: z.enum(["en", "ar"]).default("en"),
  published: z.string().optional(),
  components: z
    .string()
    .default("[]")
    .transform((s, ctx) => {
      try {
        return z.array(Component).max(40).parse(JSON.parse(s));
      } catch {
        ctx.addIssue({ code: "custom", message: "Couldn't read the component list." });
        return z.NEVER;
      }
    }),
});

export async function saveStatusPage(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { db, workspace } = await requireWorkspace();
  if (isDemoWorkspace(workspace.id)) return fail(DEMO_READ_ONLY);
  const parsed = StatusPageSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  const [taken] = await db.select({ id: statusPages.id }).from(statusPages).where(eq(statusPages.slug, v.slug));
  if (taken && taken.id !== v.id) return fail("Check the highlighted fields.", { slug: "Another status page already uses this address." });
  const mine = v.components.length
    ? await db.select({ id: monitors.id }).from(monitors).where(and(eq(monitors.workspaceId, workspace.id), inArray(monitors.id, v.components.map((c) => c.monitorId))))
    : [];
  const allowed = new Set(mine.map((m) => m.id));
  const values = { title: v.title, titleAr: v.titleAr || null, slug: v.slug, intro: v.intro || null, introAr: v.introAr || null, defaultLocale: v.defaultLocale, published: v.published === "on" };
  let id = v.id;
  if (id) {
    const [own] = await db.select({ id: statusPages.id }).from(statusPages).where(and(eq(statusPages.id, id), eq(statusPages.workspaceId, workspace.id)));
    if (!own) return fail("That status page no longer exists.");
    await db.update(statusPages).set(values).where(eq(statusPages.id, id));
    await db.delete(statusPageMonitors).where(eq(statusPageMonitors.statusPageId, id));
  } else {
    id = newId("sp");
    await db.insert(statusPages).values({ id, workspaceId: workspace.id, ...values });
  }
  const rows = v.components.filter((c) => allowed.has(c.monitorId)).map((c, i) => ({ statusPageId: id, monitorId: c.monitorId, label: c.label || null, labelAr: c.labelAr || null, position: i }));
  if (rows.length) await db.insert(statusPageMonitors).values(rows);
  updateTag(`ws:${workspace.id}`);
  if (!v.id) redirect(`/app/status-pages/${id}?created=1`);
  refresh();
  return { ok: true, message: "Saved." };
}

export async function deleteStatusPage(id: string): Promise<ActionResult> {
  const { db, workspace } = await requireWorkspace();
  if (isDemoWorkspace(workspace.id)) return fail(DEMO_READ_ONLY);
  await db.delete(statusPages).where(and(eq(statusPages.id, id), eq(statusPages.workspaceId, workspace.id)));
  updateTag(`ws:${workspace.id}`);
  redirect("/app/status-pages");
}

/* -------------------------------- alerts -------------------------------- */

const ChannelSchema = z.object({
  kind: z.enum(["email", "slack", "discord", "webhook"]),
  name: z.string().trim().max(60).optional().default(""),
  target: z.string().trim().min(1, "Enter where alerts should go.").max(500),
});

const KIND_NAME: Record<ChannelKind, string> = { email: "Email", slack: "Slack", discord: "Discord", webhook: "Webhook" };

export async function addChannel(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { db, workspace } = await requireWorkspace();
  if (isDemoWorkspace(workspace.id)) return fail(DEMO_READ_ONLY);
  const parsed = ChannelSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  const bad = validateChannelTarget(v.kind, v.target);
  if (bad) return fail("Check the highlighted fields.", { target: bad });
  const [{ n }] = await db.select({ n: count() }).from(channels).where(eq(channels.workspaceId, workspace.id));
  if (Number(n) >= 10) return fail("A workspace can have up to 10 alert channels.");
  const name = v.name || (v.kind === "email" ? v.target : `${KIND_NAME[v.kind]} channel`);
  await db.insert(channels).values({ id: newId("ch"), workspaceId: workspace.id, kind: v.kind, name, target: v.target, secret: newSecret() });
  refresh();
  return { ok: true, message: "Added. Send a test to check it arrives." };
}

export async function setChannelActive(id: string, active: boolean): Promise<ActionResult> {
  const { db, workspace } = await requireWorkspace();
  if (isDemoWorkspace(workspace.id)) return fail(DEMO_READ_ONLY);
  await db.update(channels).set({ active }).where(and(eq(channels.id, id), eq(channels.workspaceId, workspace.id)));
  refresh();
  return { ok: true };
}

export async function deleteChannel(id: string): Promise<ActionResult> {
  const { db, workspace } = await requireWorkspace();
  if (isDemoWorkspace(workspace.id)) return fail(DEMO_READ_ONLY);
  await db.delete(channels).where(and(eq(channels.id, id), eq(channels.workspaceId, workspace.id)));
  refresh();
  return { ok: true };
}

/** Sends a test alert to one channel right away and records it in the log. */
export async function testChannel(id: string): Promise<ActionResult> {
  const { conn, db, workspace } = await requireWorkspace();
  const [channel] = await db.select().from(channels).where(and(eq(channels.id, id), eq(channels.workspaceId, workspace.id)));
  if (!channel) return fail("That channel no longer exists.");
  if (!(await claim(conn, `test-alert:${id}`, 20))) return fail("A test went out less than 20 seconds ago.");
  const alertId = newId("al");
  const subject = "Test alert from Nabd";
  const body = `This is a test. When a monitor in ${workspace.name} goes down or comes back, the alert will look like this.`;
  const result = await deliverForReal(channel, { id: alertId, subject, body, event: "test" });
  const now = new Date();
  await db.insert(alerts).values({
    id: alertId,
    workspaceId: workspace.id,
    channelId: channel.id,
    event: "test",
    dedupeKey: `test:${alertId}`,
    status: result.status,
    subject,
    body,
    error: result.error ?? null,
    attempts: 1,
    claimedAt: now,
    sentAt: result.status === "failed" ? null : now,
  });
  refresh();
  if (result.status === "failed") return fail(`Couldn't deliver: ${result.error ?? "unknown error"}.`);
  return { ok: true, message: result.status === "simulated" ? "Recorded as simulated." : "Sent." };
}

/* ------------------------------- settings ------------------------------- */

const SettingsSchema = z.object({
  name: z.string().trim().min(2, "Name the workspace.").max(80),
  timezone: z.string().max(60).refine(isTimeZone, "Pick a time zone."),
});

export async function saveSettings(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { db, workspace } = await requireWorkspace();
  if (isDemoWorkspace(workspace.id)) return fail(DEMO_READ_ONLY);
  const parsed = SettingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Check the highlighted fields.", fieldErrors(parsed.error));
  await db.update(workspaces).set(parsed.data).where(eq(workspaces.id, workspace.id));
  updateTag(`ws:${workspace.id}`);
  refresh();
  return { ok: true, message: "Saved." };
}
