import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AddChannel, ChannelControls, SecretReveal } from "@/components/app/channels";
import { cn, PageTitle, Panel } from "@/components/ui";
import type { AlertStatus, ChannelKind } from "@/db/schema";
import { isDemoWorkspace } from "@/lib/demo";
import { fmtDateTime } from "@/lib/time";
import { requireWorkspace } from "@/server/auth";
import { listChannels, recentAlerts } from "@/server/queries";

export const metadata: Metadata = { title: "Alerts" };

const KIND: Record<ChannelKind, string> = { email: "Email", slack: "Slack", discord: "Discord", webhook: "Webhook" };
const EVENT = { down: "Down", up: "Back up", ssl: "Certificate", test: "Test" } as const;
const RESULT: Record<AlertStatus, { label: string; cls: string }> = {
  sent: { label: "Sent", cls: "text-up" },
  simulated: { label: "Simulated", cls: "text-muted" },
  failed: { label: "Failed", cls: "text-down" },
  pending: { label: "Waiting", cls: "text-slow" },
};

/** Webhook URLs are secrets in themselves; show enough to recognise them. */
function maskTarget(kind: ChannelKind, target: string) {
  const t = target.replace(/^demo:/, "");
  if (kind === "email") return t;
  try {
    const u = new URL(t);
    return `${u.host}/…${u.pathname.replace(/\/$/, "").slice(-4)}`;
  } catch {
    return t.slice(0, 24);
  }
}

/** Email goes out through Resend, which the server owner switches on with two environment variables. */
const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export default function AlertsPage() {
  return (
    <Suspense fallback={<div className="h-[60vh] animate-pulse rounded-panel bg-rule-2" />}>
      <Alerts />
    </Suspense>
  );
}

async function Alerts() {
  await connection();
  const { conn, workspace } = await requireWorkspace();
  const [chs, log] = await Promise.all([listChannels(conn, workspace.id), recentAlerts(conn, workspace.id, 50)]);
  const demo = isDemoWorkspace(workspace.id);
  const tz = workspace.timezone;
  return (
    <>
      <PageTitle
        title="Alerts"
        sub="Nabd alerts every active channel when a monitor is confirmed down, when it comes back, and 14 days before a certificate expires."
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section>
          <h2 className="text-[17px] font-semibold">Where alerts go</h2>
          {chs.length ? (
            <Panel className="mt-3">
              <ul>
                {chs.map((c) => {
                  const simulated = c.target.startsWith("demo:");
                  return (
                    <li key={c.id} className={cn("flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-rule-2 px-5 py-4 last:border-b-0", !c.active && "opacity-60")}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium">
                          {c.name}
                          <span className="ms-2 text-[13px] font-normal text-muted">{KIND[c.kind]}</span>
                        </p>
                        <p className="mt-0.5 truncate text-[13px] text-muted">
                          {maskTarget(c.kind, c.target)}
                          {simulated ? " (demo: recorded, not sent)" : ""}
                        </p>
                        {!simulated && c.kind === "email" && !emailConfigured() ? (
                          <p className="mt-1 text-[12.5px] leading-snug text-slow">Email sending isn&apos;t switched on for this server yet, so email alerts are recorded but not sent.</p>
                        ) : null}
                        {c.kind === "webhook" ? (
                          <p className="mt-1.5 text-[12.5px] text-muted">
                            Signing secret <SecretReveal secret={c.secret} />
                          </p>
                        ) : null}
                      </div>
                      <ChannelControls id={c.id} active={c.active} locked={demo} />
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : (
            <p className="mt-3 rounded-panel border border-dashed border-rule px-4 py-8 text-center text-[14px] text-muted">No channels, so incidents open silently. Add one on the right.</p>
          )}

          <h2 className="mt-10 text-[17px] font-semibold">Recent alerts</h2>
          {log.length ? (
            <Panel className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13.5px]">
                <thead className="text-[12.5px] text-muted">
                  <tr className="border-b border-rule">
                    <th className="px-4 py-2 text-start font-normal">When</th>
                    <th className="px-4 py-2 text-start font-normal">Alert</th>
                    <th className="px-4 py-2 text-start font-normal">Channel</th>
                    <th className="px-4 py-2 text-end font-normal">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map(({ alert: a, channelName }) => (
                    <tr key={a.id} className="border-b border-rule-2 align-top last:border-b-0">
                      <td className="px-4 py-2.5 whitespace-nowrap text-ink-2 tnum">{fmtDateTime(a.createdAt, tz)}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("me-2 font-medium", a.event === "down" ? "text-down" : a.event === "up" ? "text-up" : a.event === "ssl" ? "text-slow" : "text-ink-2")}>{EVENT[a.event]}</span>
                        {a.incidentId ? (
                          <Link href={`/app/incidents/${a.incidentId}`} className="text-ink-2 underline-offset-4 hover:underline">
                            {a.subject.replace(/^(Down|Back up): /, "")}
                          </Link>
                        ) : (
                          <span className="text-ink-2">{a.subject}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-ink-2">{channelName ?? "Deleted channel"}</td>
                      <td className={cn("px-4 py-2.5 text-end whitespace-nowrap", RESULT[a.status].cls)} title={a.error ?? undefined}>
                        {RESULT[a.status].label}
                        {a.status === "failed" && a.error ? <span className="block max-w-56 truncate text-[12px]">{a.error}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ) : (
            <p className="mt-3 rounded-panel border border-dashed border-rule px-4 py-8 text-center text-[14px] text-muted">No alerts yet. Send a test to see how one looks.</p>
          )}
        </section>

        <aside className="grid content-start gap-4">
          <Panel className="p-5">
            <h2 className="text-[15px] font-semibold">Add a channel</h2>
            <div className="mt-4">
              <AddChannel disabledReason={demo ? "The shared demo's channels are fixed, and record alerts instead of sending them. Create a free account to alert your own Slack, Discord, email or webhook." : undefined} />
            </div>
          </Panel>
          <Panel className="p-5 text-[13.5px] leading-relaxed text-ink-2">
            <h2 className="text-[15px] font-semibold text-ink">Webhook format</h2>
            <p className="mt-2">
              A POST with JSON: <code className="text-[12.5px]">id</code>, <code className="text-[12.5px]">event</code> (down, up, ssl or test), <code className="text-[12.5px]">subject</code>,{" "}
              <code className="text-[12.5px]">body</code> and <code className="text-[12.5px]">sent_at</code>.
            </p>
            <p className="mt-2">
              The <code className="text-[12.5px]">x-nabd-signature</code> header is <code className="text-[12.5px]">sha256=</code> plus the HMAC-SHA256 of the raw body, keyed with the channel&apos;s
              secret. Compute it on your side and compare before trusting the request.
            </p>
            <p className="mt-2">Failed deliveries are retried twice, five minutes apart.</p>
          </Panel>
        </aside>
      </div>
    </>
  );
}
