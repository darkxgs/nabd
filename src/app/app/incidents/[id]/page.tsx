import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { and, eq } from "drizzle-orm";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { AcknowledgeButton, UpdateComposer } from "@/components/app/incident-forms";
import { cn, Panel } from "@/components/ui";
import { statusPageMonitors, statusPages } from "@/db/schema";
import { isDemoWorkspace } from "@/lib/demo";
import { formatDuration } from "@/lib/rules";
import { fmtDate, fmtDateTime, fmtTime, localDay } from "@/lib/time";
import { requireWorkspace } from "@/server/auth";
import { incidentWithUpdates } from "@/server/queries";

export const metadata: Metadata = { title: "Incident" };

const LABEL = { investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved" } as const;
const DOT = { investigating: "bg-down", identified: "bg-slow", monitoring: "bg-ink-2", resolved: "bg-up" } as const;
const ALERT_RESULT = { sent: "sent", simulated: "recorded (simulated)", failed: "failed", pending: "waiting to send" } as const;
const EVENT = { down: "Down alert", up: "Recovery alert", ssl: "Certificate alert", test: "Test alert" } as const;

export default function IncidentPage(props: PageProps<"/app/incidents/[id]">) {
  return (
    <Suspense fallback={<div className="h-[60vh] animate-pulse rounded-panel bg-rule-2" />}>
      <IncidentView {...props} />
    </Suspense>
  );
}

type Event = { at: Date; key: string; dot: string; title: string; body?: string | null; bodyAr?: string | null; tag?: string; quiet?: boolean };

async function IncidentView({ params }: PageProps<"/app/incidents/[id]">) {
  await connection();
  const { id } = await params;
  const { conn, db, workspace } = await requireWorkspace();
  const data = await incidentWithUpdates(conn, workspace.id, id);
  if (!data) notFound();
  const { incident: inc, monitor, updates, alerts } = data;
  const tz = workspace.timezone;
  const now = new Date();
  const open = !inc.resolvedAt;
  const lasted = (inc.resolvedAt ?? now).getTime() - inc.startedAt.getTime();
  const pages = inc.monitorId
    ? await db
        .select({ slug: statusPages.slug, title: statusPages.title, published: statusPages.published })
        .from(statusPageMonitors)
        .innerJoin(statusPages, eq(statusPages.id, statusPageMonitors.statusPageId))
        .where(eq(statusPageMonitors.monitorId, inc.monitorId))
    : await db.select({ slug: statusPages.slug, title: statusPages.title, published: statusPages.published }).from(statusPages).where(and(eq(statusPages.workspaceId, workspace.id)));
  const sample = !!workspace.sampleBefore && inc.startedAt < workspace.sampleBefore;

  const events: Event[] = [];
  if (inc.monitorId) events.push({ at: inc.startedAt, key: "first", dot: "bg-down", title: "First failed check", body: inc.cause });
  for (const u of updates) {
    events.push({ at: u.createdAt, key: u.id, dot: DOT[u.state], title: LABEL[u.state], body: u.body, bodyAr: u.bodyAr, tag: u.automatic ? "Automatic" : undefined });
  }
  for (const { alert: a, channelName } of alerts) {
    events.push({ at: a.sentAt ?? a.createdAt, key: a.id, dot: a.status === "failed" ? "bg-down" : "bg-idle", title: `${EVENT[a.event]} to ${channelName ?? "a deleted channel"}: ${ALERT_RESULT[a.status]}`, body: a.status === "failed" ? a.error : null, quiet: true });
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.quiet ? 1 : 0) - (b.quiet ? 1 : 0));

  return (
    <>
      {open ? <AutoRefresh seconds={45} /> : null}
      <Link href="/app/incidents" className="text-[13.5px] text-muted hover:text-ink">
        Incidents
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.015em] text-balance sm:text-[28px]">{inc.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14.5px] text-ink-2">
            <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium", open ? "bg-down-soft text-down" : "bg-up-soft text-up")}>
              <span className={cn("size-2 rounded-full", open ? "animate-beat bg-down" : "bg-up")} aria-hidden />
              {LABEL[inc.state]}
            </span>
            <span>
              {open ? `Open for ${formatDuration(lasted)}` : `Lasted ${formatDuration(lasted)}`}, from {fmtDateTime(inc.startedAt, tz)}
              {inc.resolvedAt ? ` to ${fmtTime(inc.resolvedAt, tz)}${localDay(inc.resolvedAt, tz) !== localDay(inc.startedAt, tz) ? ` on ${fmtDate(inc.resolvedAt, tz)}` : ""}` : ""}.
            </span>
            {sample ? <span className="text-[13px] text-muted">Sample incident from the demo&apos;s history.</span> : null}
          </p>
        </div>
        {!inc.acknowledgedAt && open ? <AcknowledgeButton id={inc.id} /> : null}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section>
          <h2 className="sr-only">Timeline</h2>
          <ol className="relative">
            {events.map((e, i) => (
              <li key={e.key} className="relative grid grid-cols-[64px_minmax(0,1fr)] gap-4 pb-6 last:pb-0">
                <time dateTime={e.at.toISOString()} className={cn("readout pt-px text-end text-[15px]", e.quiet ? "text-faint" : "text-ink-2")}>
                  {fmtTime(e.at, tz)}
                </time>
                <div className="relative ps-6">
                  {i < events.length - 1 ? <span className="absolute start-[4px] top-3 -bottom-6 w-px bg-rule" aria-hidden /> : null}
                  <span className={cn("absolute start-0 top-[6px] size-[9px] rounded-full ring-4 ring-paper", e.dot)} aria-hidden />
                  <p className={cn("text-[14.5px]", e.quiet ? "text-muted" : "font-medium")}>
                    {e.title}
                    {e.tag ? <span className="ms-2 text-[12px] font-normal text-faint">{e.tag}</span> : null}
                  </p>
                  {e.body ? <p className={cn("mt-1 text-[14px] leading-relaxed", e.quiet ? "text-down" : "text-ink-2")}>{e.body}</p> : null}
                  {e.bodyAr ? (
                    <p dir="rtl" lang="ar" className="font-arabic mt-1.5 text-[14px] text-muted">
                      {e.bodyAr}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          <Panel className="mt-8 p-5">
            <h2 className="text-[15px] font-semibold">{open ? "Post an update" : "Add a note"}</h2>
            <p className="mt-0.5 mb-4 text-[13.5px] text-muted">
              {pages.some((p) => p.published) ? "Updates appear on the status page right away." : "No published status page shows this incident, so updates stay here."}
            </p>
            <UpdateComposer
              incidentId={inc.id}
              current={inc.state}
              resolved={!open}
              disabledReason={isDemoWorkspace(workspace.id) ? "Posting is turned off in the shared demo, because updates appear on the public status page. Create a free account to try it." : undefined}
            />
          </Panel>
        </section>

        <aside className="grid content-start gap-4">
          <Panel>
            <dl className="text-[14px]">
              {(
                [
                  ["Monitor", monitor ? <Link key="m" href={`/app/monitors/${monitor.id}`} className="underline underline-offset-4 hover:text-ink">{monitor.name}</Link> : "Posted by hand"],
                  ["Cause", inc.cause ?? "Not recorded"],
                  ["Started", fmtDateTime(inc.startedAt, tz)],
                  ["Resolved", inc.resolvedAt ? fmtDateTime(inc.resolvedAt, tz) : "Not yet"],
                  ["Acknowledged", inc.acknowledgedAt ? fmtDateTime(inc.acknowledgedAt, tz) : "Not yet"],
                  ["Alerts", alerts.length ? `${alerts.length} sent to ${new Set(alerts.map((a) => a.channelName)).size} channel${new Set(alerts.map((a) => a.channelName)).size === 1 ? "" : "s"}` : "None"],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-rule-2 px-4 py-2.5 last:border-b-0">
                  <dt className="text-muted">{k}</dt>
                  <dd className="min-w-0 text-end text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          {pages.length ? (
            <Panel className="p-4">
              <h2 className="text-[13px] font-medium text-muted">Shown on</h2>
              <ul className="mt-2 grid gap-1.5 text-[14px]">
                {pages.map((p) => (
                  <li key={p.slug}>
                    {p.published ? (
                      <a href={`/s/${p.slug}`} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
                        {p.title}
                      </a>
                    ) : (
                      <span className="text-muted">{p.title} (not published)</span>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}
