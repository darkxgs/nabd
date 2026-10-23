// Drizzle table definitions that mirror migrations.ts (the SQL is the source of
// truth: it holds the partial unique indexes Drizzle doesn't need to know about).
import { bigint, boolean, integer, pgSchema, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const nabd = pgSchema("nabd");
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = nabd.table("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const workspaces = nabd.table("workspaces", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  sampleBefore: ts("sample_before"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type MonitorState = "pending" | "up" | "degraded" | "down";

export const monitors = nabd.table("monitors", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  method: text("method").$type<"GET" | "HEAD">().notNull().default("GET"),
  expectedStatus: text("expected_status").notNull().default("200-399"),
  keyword: text("keyword"),
  keywordMode: text("keyword_mode").$type<"contains" | "absent">().notNull().default("contains"),
  timeoutMs: integer("timeout_ms").notNull().default(10000),
  intervalSec: integer("interval_sec").notNull().default(300),
  slowMs: integer("slow_ms").notNull().default(2000),
  confirmAfter: integer("confirm_after").notNull().default(2),
  paused: boolean("paused").notNull().default(false),
  state: text("state").$type<MonitorState>().notNull().default("pending"),
  stateSince: ts("state_since").notNull().defaultNow(),
  failStreak: integer("fail_streak").notNull().default(0),
  lastCheckedAt: ts("last_checked_at"),
  lastLatencyMs: integer("last_latency_ms"),
  lastStatus: integer("last_status"),
  lastError: text("last_error"),
  nextCheckAt: ts("next_check_at").notNull().defaultNow(),
  sslExpiresAt: ts("ssl_expires_at"),
  sslIssuer: text("ssl_issuer"),
  sslCheckedAt: ts("ssl_checked_at"),
  sslAlertedAt: ts("ssl_alerted_at"),
  position: integer("position").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Monitor = typeof monitors.$inferSelect;

export const checks = nabd.table("checks", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  monitorId: text("monitor_id").notNull(),
  checkedAt: ts("checked_at").notNull(),
  ok: boolean("ok").notNull(),
  statusCode: integer("status_code"),
  latencyMs: integer("latency_ms"),
  error: text("error"),
});

export const checkHours = nabd.table(
  "check_hours",
  {
    monitorId: text("monitor_id").notNull(),
    hour: ts("hour").notNull(),
    total: integer("total").notNull().default(0),
    failures: integer("failures").notNull().default(0),
    latencySum: bigint("latency_sum", { mode: "number" }).notNull().default(0),
    latencyN: integer("latency_n").notNull().default(0),
    latencyMax: integer("latency_max").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.monitorId, t.hour] })],
);

export type IncidentState = "investigating" | "identified" | "monitoring" | "resolved";

export const incidents = nabd.table("incidents", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  monitorId: text("monitor_id"),
  title: text("title").notNull(),
  titleAr: text("title_ar"),
  cause: text("cause"),
  state: text("state").$type<IncidentState>().notNull().default("investigating"),
  startedAt: ts("started_at").notNull(),
  resolvedAt: ts("resolved_at"),
  acknowledgedAt: ts("acknowledged_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Incident = typeof incidents.$inferSelect;

export const incidentUpdates = nabd.table("incident_updates", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull(),
  state: text("state").$type<IncidentState>().notNull(),
  body: text("body").notNull(),
  bodyAr: text("body_ar"),
  automatic: boolean("automatic").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const statusPages = nabd.table("status_pages", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  titleAr: text("title_ar"),
  intro: text("intro"),
  introAr: text("intro_ar"),
  defaultLocale: text("default_locale").$type<"en" | "ar">().notNull().default("en"),
  published: boolean("published").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type StatusPage = typeof statusPages.$inferSelect;

export const statusPageMonitors = nabd.table(
  "status_page_monitors",
  {
    statusPageId: text("status_page_id").notNull(),
    monitorId: text("monitor_id").notNull(),
    label: text("label"),
    labelAr: text("label_ar"),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.statusPageId, t.monitorId] })],
);

export type ChannelKind = "email" | "slack" | "discord" | "webhook";

export const channels = nabd.table("channels", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  kind: text("kind").$type<ChannelKind>().notNull(),
  name: text("name").notNull(),
  target: text("target").notNull(),
  secret: text("secret").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Channel = typeof channels.$inferSelect;

export type AlertEvent = "down" | "up" | "ssl" | "test";
export type AlertStatus = "pending" | "sent" | "failed" | "simulated";

export const alerts = nabd.table("alerts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  channelId: text("channel_id"),
  monitorId: text("monitor_id"),
  incidentId: text("incident_id"),
  event: text("event").$type<AlertEvent>().notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  status: text("status").$type<AlertStatus>().notNull().default("pending"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  claimedAt: ts("claimed_at"),
  sentAt: ts("sent_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type Alert = typeof alerts.$inferSelect;
