import "server-only";
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Agent, request } from "undici";
import type { Connection, DB } from "@/db";
import { rawQuery } from "@/db/raw";
import { alerts, channels, type AlertEvent, type AlertStatus, type Channel, type ChannelKind } from "@/db/schema";
import { newId } from "@/lib/id";
import { guardedLookup } from "./net-guard";

/**
 * Alerts go through an outbox. Detecting an outage only writes rows here (one
 * per channel, de-duplicated by the database), and a separate step delivers
 * them, so a slow Slack never delays a check and a crash never loses an alert.
 */
export async function queueAlerts(
  db: DB,
  a: { workspaceId: string; monitorId: string | null; incidentId: string | null; event: AlertEvent; dedupe: string; subject: string; body: string },
) {
  const active = await db.select().from(channels).where(and(eq(channels.workspaceId, a.workspaceId), eq(channels.active, true)));
  if (!active.length) return 0;
  const rows = await db
    .insert(alerts)
    .values(
      active.map((c) => ({
        id: newId("al"),
        workspaceId: a.workspaceId,
        channelId: c.id,
        monitorId: a.monitorId,
        incidentId: a.incidentId,
        event: a.event,
        dedupeKey: a.dedupe,
        subject: a.subject,
        body: a.body,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: alerts.id });
  return rows.length;
}

type Delivery = { status: Exclude<AlertStatus, "pending">; error?: string };
type Sender = (channel: Channel, alert: { subject: string; body: string; event: AlertEvent; id: string }) => Promise<Delivery>;

const ALLOWED_HOOK_HOSTS: Partial<Record<ChannelKind, RegExp>> = {
  slack: /^hooks\.slack\.com$/,
  discord: /^(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)$/,
};

export function validateChannelTarget(kind: ChannelKind, target: string): string | null {
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) ? null : "Enter an email address.";
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return "Enter the full webhook URL, starting with https://";
  }
  if (u.protocol !== "https:") return "Webhook URLs must use https.";
  const allowed = ALLOWED_HOOK_HOSTS[kind];
  if (allowed && !allowed.test(u.hostname)) return kind === "slack" ? "Use a Slack incoming-webhook URL (hooks.slack.com)." : "Use a Discord webhook URL (discord.com/api/webhooks/…).";
  return null;
}

/** Signature receivers can check: hex HMAC-SHA256 of the raw body with the channel secret. */
export const signBody = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

async function postJson(url: string, payload: unknown, headers: Record<string, string> = {}): Promise<Delivery> {
  const body = JSON.stringify(payload);
  const dispatcher = new Agent({ connect: { lookup: guardedLookup(false) as never, timeout: 8000 } });
  try {
    const res = await request(url, {
      method: "POST",
      dispatcher,
      body,
      headers: { "content-type": "application/json", "user-agent": "NabdMonitor/1.0", ...headers },
      headersTimeout: 8000,
      bodyTimeout: 8000,
    });
    await res.body.dump();
    return res.statusCode >= 200 && res.statusCode < 300 ? { status: "sent" } : { status: "failed", error: `HTTP ${res.statusCode}` };
  } catch (e) {
    return { status: "failed", error: (e as Error).message.slice(0, 200) };
  } finally {
    dispatcher.close().catch(() => {});
  }
}

const COLORS: Record<AlertEvent, number> = { down: 0xe5412d, up: 0x138a52, ssl: 0xc98a00, test: 0x5b6472 };

/** Real delivery. Demo channels (target "demo:…") and unconfigured email are recorded as simulated. */
export const deliverForReal: Sender = async (channel, alert) => {
  if (channel.target.startsWith("demo:")) return { status: "simulated", error: "Demo channel: recorded, not sent." };
  switch (channel.kind) {
    case "email": {
      const key = process.env.RESEND_API_KEY;
      const from = process.env.EMAIL_FROM;
      if (!key || !from) return { status: "simulated", error: "Email isn't configured on this server (RESEND_API_KEY); recorded, not sent." };
      return postJson(
        "https://api.resend.com/emails",
        { from, to: [channel.target], subject: alert.subject, text: alert.body },
        { authorization: `Bearer ${key}` },
      );
    }
    case "slack":
      return postJson(channel.target, { text: `*${alert.subject}*\n${alert.body}` });
    case "discord":
      return postJson(channel.target, { embeds: [{ title: alert.subject.slice(0, 250), description: alert.body.slice(0, 3900), color: COLORS[alert.event] }] });
    case "webhook": {
      const payload = { id: alert.id, event: alert.event, subject: alert.subject, body: alert.body, sent_at: new Date().toISOString() };
      const raw = JSON.stringify(payload);
      return postJson(channel.target, payload, { "x-nabd-event": alert.event, "x-nabd-signature": signBody(channel.secret, raw) });
    }
  }
};

const MAX_ATTEMPTS = 3;

/** Delivers pending alerts. Each row is claimed first, so overlapping runs never send twice. */
export async function deliverAlerts(conn: Connection, opts: { now?: Date; limit?: number; send?: Sender } = {}) {
  const now = opts.now ?? new Date();
  const send = opts.send ?? deliverForReal;
  const claimed = await rawQuery<{ id: string; channel_id: string | null; subject: string; body: string; event: AlertEvent; attempts: number }>(
    conn.raw,
    `UPDATE nabd.alerts SET claimed_at = $1, attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM nabd.alerts
       WHERE status = 'pending' AND (claimed_at IS NULL OR claimed_at < $1::timestamptz - interval '5 minutes')
       ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
     RETURNING id, channel_id, subject, body, event, attempts`,
    [now.toISOString(), opts.limit ?? 25],
  );
  let sent = 0;
  for (const a of claimed) {
    const [channel] = a.channel_id ? await conn.db.select().from(channels).where(eq(channels.id, a.channel_id)) : [];
    const result: Delivery = channel ? await send(channel, a).catch((e) => ({ status: "failed" as const, error: String(e) })) : { status: "failed", error: "Channel was deleted." };
    const retry = result.status === "failed" && a.attempts < MAX_ATTEMPTS && !!channel;
    await conn.db
      .update(alerts)
      .set({
        status: retry ? "pending" : result.status,
        error: result.error ?? null,
        sentAt: result.status === "sent" || result.status === "simulated" ? now : null,
      })
      .where(eq(alerts.id, a.id));
    if (result.status === "sent" || result.status === "simulated") sent++;
  }
  return { claimed: claimed.length, sent };
}
