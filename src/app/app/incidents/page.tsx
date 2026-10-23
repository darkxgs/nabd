import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { buttonClass, cn, Empty, PageTitle, Panel } from "@/components/ui";
import { isDemoWorkspace } from "@/lib/demo";
import { formatDuration } from "@/lib/rules";
import { fmtDate, fmtTime, localDay } from "@/lib/time";
import { requireWorkspace } from "@/server/auth";
import { listIncidents } from "@/server/queries";

export const metadata: Metadata = { title: "Incidents" };

export default function IncidentsPage() {
  return (
    <Suspense fallback={<div className="h-[60vh] animate-pulse rounded-panel bg-rule-2" />}>
      <Incidents />
    </Suspense>
  );
}

const STATE_LABEL = { investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved" } as const;

async function Incidents() {
  await connection();
  const { conn, workspace } = await requireWorkspace();
  const rows = await listIncidents(conn, workspace.id, 150);
  const now = new Date();
  const tz = workspace.timezone;
  const open = rows.filter((r) => !r.incident.resolvedAt);
  const resolved = rows.filter((r) => r.incident.resolvedAt);
  const recent = resolved.filter((r) => now.getTime() - r.incident.startedAt.getTime() < 30 * 86_400_000);
  const durations = recent.map((r) => r.incident.resolvedAt!.getTime() - r.incident.startedAt.getTime()).sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;

  const byDay = new Map<string, typeof resolved>();
  for (const r of resolved) {
    const d = localDay(r.incident.startedAt, tz);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }

  return (
    <>
      <AutoRefresh seconds={60} />
      <PageTitle
        title="Incidents"
        sub={
          rows.length
            ? `${open.length ? `${open.length} open. ` : "Nothing open. "}${recent.length} resolved in the last 30 days${median != null ? `, usually within ${formatDuration(median)}` : ""}.`
            : undefined
        }
        actions={
          isDemoWorkspace(workspace.id) ? null : (
            <Link href="/app/incidents/new" className={buttonClass("outline", "md")}>
              Post an incident
            </Link>
          )
        }
      />

      {!rows.length ? (
        <div className="mt-8">
          <Empty title="No incidents yet">
            When a monitor fails its checks in a row, Nabd opens an incident here, alerts your channels and shows it on your status pages. You can also post one by hand, for
            planned maintenance or a problem no check can see.
          </Empty>
        </div>
      ) : null}

      {open.length ? (
        <section className="mt-8">
          <h2 className="text-[15px] font-semibold text-down">Open</h2>
          <Panel className="mt-2.5 border-down/30">
            <ul>
              {open.map(({ incident: i, monitorName }) => (
                <Row
                  key={i.id}
                  href={`/app/incidents/${i.id}`}
                  open
                  title={i.title}
                  sub={[monitorName ?? "Posted by hand", i.cause].filter(Boolean).join(". ")}
                  when={`Since ${fmtTime(i.startedAt, tz)}${localDay(i.startedAt, tz) !== localDay(now, tz) ? `, ${fmtDate(i.startedAt, tz)}` : ""}`}
                  duration={formatDuration(now.getTime() - i.startedAt.getTime())}
                  state={`${STATE_LABEL[i.state]}${i.acknowledgedAt ? "" : ", not acknowledged"}`}
                />
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}

      {[...byDay.entries()].map(([day, list]) => (
        <section key={day} className="mt-8">
          <h2 className="text-[13.5px] font-medium text-muted">{fmtDate(new Date(`${day}T12:00:00Z`), "UTC")}</h2>
          <Panel className="mt-2.5">
            <ul>
              {list.map(({ incident: i, monitorName }) => (
                <Row
                  key={i.id}
                  href={`/app/incidents/${i.id}`}
                  title={i.title}
                  sub={[monitorName ?? "Posted by hand", i.cause].filter(Boolean).join(". ")}
                  when={`${fmtTime(i.startedAt, tz)} to ${fmtTime(i.resolvedAt!, tz)}`}
                  duration={formatDuration(i.resolvedAt!.getTime() - i.startedAt.getTime())}
                  sample={!!workspace.sampleBefore && i.startedAt < workspace.sampleBefore}
                />
              ))}
            </ul>
          </Panel>
        </section>
      ))}
    </>
  );
}

function Row({ href, title, sub, when, duration, state, open, sample }: { href: string; title: string; sub: string; when: string; duration: string; state?: string; open?: boolean; sample?: boolean }) {
  return (
    <li className="border-b border-rule-2 last:border-b-0">
      <Link href={href} className="relative grid gap-x-6 gap-y-1 px-5 py-3.5 transition-colors hover:bg-well sm:grid-cols-[minmax(0,1fr)_150px_90px]">
        <span className={cn("absolute inset-y-2 start-0 w-[3px] rounded-e-full", open ? "bg-down" : "bg-rule")} aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-[14.5px] font-medium">{title}</span>
          <span className="block truncate text-[13px] text-muted">
            {sub}
            {sample ? <span className="ms-2 text-faint">sample</span> : null}
          </span>
        </span>
        <span className="self-center text-[13.5px] text-ink-2 tnum">
          {when}
          {state ? <span className={cn("block text-[12.5px]", open ? "text-down" : "text-muted")}>{state}</span> : null}
        </span>
        <span className={cn("readout self-center text-[17px] sm:text-end", open && "text-down")}>{duration}</span>
      </Link>
    </li>
  );
}
