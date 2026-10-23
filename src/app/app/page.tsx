import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { BeatStrip } from "@/components/beat-strip";
import { buttonClass, cn, Empty, PageTitle, Panel, StateDot } from "@/components/ui";
import { displayUrl } from "@/lib/monitor-input";
import { formatDuration, formatMs, formatPct } from "@/lib/rules";
import { ago, fmtTime } from "@/lib/time";
import { requireWorkspace } from "@/server/auth";
import { effectiveState, listMonitors, openIncidents, type MonitorRow } from "@/server/queries";

export const metadata: Metadata = { title: "Monitors" };

export default function MonitorsPage(props: PageProps<"/app">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Monitors {...props} />
    </Suspense>
  );
}

function summary(rows: MonitorRow[]) {
  const states = rows.map(effectiveState);
  const live = states.filter((s) => s !== "paused");
  const down = live.filter((s) => s === "down").length;
  const slow = live.filter((s) => s === "degraded").length;
  const total = rows.length;
  if (!live.length) return { tone: "idle" as const, text: "Every monitor is paused." };
  if (down) return { tone: "down" as const, text: `${down} of ${total} monitors ${down === 1 ? "is" : "are"} down.` };
  if (slow) return { tone: "slow" as const, text: `Everything is answering; ${slow} ${slow === 1 ? "monitor is" : "monitors are"} slow.` };
  if (live.every((s) => s === "pending")) return { tone: "idle" as const, text: "Waiting for the first checks." };
  return { tone: "up" as const, text: total === 1 ? "Your monitor is up." : `All ${total} monitors are up.` };
}

async function Monitors({ searchParams }: PageProps<"/app">) {
  await connection();
  const sp = await searchParams;
  const { conn, workspace } = await requireWorkspace();
  const [rows, open] = await Promise.all([listMonitors(conn, workspace.id), openIncidents(conn, workspace.id)]);
  const now = new Date();
  const tz = workspace.timezone;

  if (!rows.length) {
    return (
      <>
        <PageTitle title={sp.welcome ? `Welcome to Nabd` : "Monitors"} sub="Nothing is being watched yet." />
        <div className="mt-8">
          <Empty
            title="Add the first address to watch"
            action={
              <Link href="/app/monitors/new" className={buttonClass("primary", "md")}>
                Add a monitor
              </Link>
            }
          >
            Nabd checks it from the internet every few minutes, opens an incident when it stops answering, and alerts you by email. You can add Slack, Discord or a webhook
            under Alerts.
          </Empty>
        </div>
      </>
    );
  }

  const s = summary(rows);
  return (
    <>
      <AutoRefresh seconds={60} />
      <PageTitle
        title="Monitors"
        sub={
          <span className="inline-flex items-center gap-2">
            <span className={cn("size-2 rounded-full", { up: "bg-up", down: "bg-down", slow: "bg-slow", idle: "bg-idle" }[s.tone])} aria-hidden />
            {s.text}
          </span>
        }
        actions={
          <Link href="/app/monitors/new" className={buttonClass("primary", "md")}>
            Add monitor
          </Link>
        }
      />

      {open.length ? (
        <div className="mt-7 grid gap-2">
          {open.map(({ incident, monitorName }) => (
            <Link
              key={incident.id}
              href={`/app/incidents/${incident.id}`}
              className="group flex flex-wrap items-center gap-x-4 gap-y-1 rounded-panel border border-down/30 bg-down-soft px-4 py-3 text-[14px] transition-colors hover:border-down/60"
            >
              <span className="flex items-center gap-2.5 font-semibold text-down">
                <StateDot state="down" live />
                {monitorName ?? incident.title}
              </span>
              <span className="text-ink-2">
                {incident.monitorId
                  ? `Down for ${formatDuration(now.getTime() - incident.startedAt.getTime())}, since ${fmtTime(incident.startedAt, tz)}.`
                  : `Posted at ${fmtTime(incident.startedAt, tz)}.`}
                {incident.cause ? ` ${incident.cause}` : ""}
              </span>
              <span className="ms-auto text-[13px] font-medium text-down group-hover:underline">{incident.acknowledgedAt ? "View incident" : "Not acknowledged yet"}</span>
            </Link>
          ))}
        </div>
      ) : null}

      <Panel className="mt-7 overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,1.35fr)_minmax(0,2fr)_80px_80px_88px_96px] items-end gap-5 border-b border-rule px-5 py-2.5 text-[12.5px] text-muted lg:grid">
          <span>Monitor</span>
          <span>Last 48 checks, newest on the right</span>
          <span className="text-end">24 hours</span>
          <span className="text-end">30 days</span>
          <span className="text-end">Response</span>
          <span className="text-end">Last check</span>
        </div>
        <ul>
          {rows.map((m) => {
            const st = effectiveState(m);
            return (
              <li key={m.id} className={cn("relative border-b border-rule-2 transition-colors last:border-b-0 hover:bg-well", m.paused && "text-muted")}>
                <div className="grid gap-x-5 gap-y-3 px-5 py-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,2fr)_80px_80px_88px_96px] lg:items-center">
                  <div className="min-w-0">
                    <Link href={`/app/monitors/${m.id}`} className="flex items-center gap-2.5 after:absolute after:inset-0 focus-visible:outline-none">
                      <StateDot state={st} live />
                      <span className="truncate text-[15px] font-medium text-ink">{m.name}</span>
                    </Link>
                    <p className="mt-0.5 truncate ps-5 text-[13px] text-muted">
                      {st === "down" ? <span className="text-down">{m.lastError ?? "Failing"}</span> : st === "paused" ? "Paused" : displayUrl(m.url)}
                    </p>
                  </div>
                  <BeatStrip beats={m.beats} slowMs={m.slowMs} tz={tz} sampleBefore={workspace.sampleBefore} now={now} className={cn(m.paused && "opacity-50")} />
                  <dl className="grid grid-cols-4 gap-3 lg:contents">
                    <Stat label="24 hours" value={formatPct(m.up?.d1 ?? null)} tone={m.up?.d1 != null && m.up.d1 < 99 ? "down" : undefined} />
                    <Stat label="30 days" value={formatPct(m.up?.d30 ?? null)} />
                    <Stat label="Response" value={formatMs(m.paused ? null : m.lastLatencyMs)} tone={st === "degraded" ? "slow" : undefined} title={m.up?.avg1 ? `Average over 24 hours: ${formatMs(m.up.avg1)}` : undefined} />
                    <Stat label="Last check" value={m.lastCheckedAt ? ago(m.lastCheckedAt, now) : "never"} plain />
                  </dl>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
      <p className="mt-4 text-[13px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-3 w-[3px] rounded-[1px] bg-up" aria-hidden /> passed
        </span>
        <span className="ms-4 inline-flex items-center gap-1.5">
          <i className="inline-block h-3 w-[3px] rounded-[1px] bg-slow" aria-hidden /> slow
        </span>
        <span className="ms-4 inline-flex items-center gap-1.5">
          <i className="inline-block h-3 w-[3px] rounded-[1px] bg-down" aria-hidden /> failed
        </span>
        <span className="ms-4">Taller ticks took longer to answer.</span>
      </p>
    </>
  );
}

function Stat({ label, value, tone, plain, title }: { label: string; value: string; tone?: "down" | "slow"; plain?: boolean; title?: string }) {
  return (
    <div className="min-w-0 lg:text-end" title={title}>
      <dt className="text-[12px] text-muted lg:sr-only">{label}</dt>
      <dd className={cn("truncate", plain ? "text-[13.5px] text-ink-2" : "readout text-[17px]", tone === "down" && "text-down", tone === "slow" && "text-slow")}>{value}</dd>
    </div>
  );
}

function Skeleton() {
  return (
    <>
      <div className="h-9 w-40 animate-pulse rounded bg-rule-2" />
      <div className="mt-3 h-5 w-64 animate-pulse rounded bg-rule-2" />
      <div className="mt-9 h-[420px] animate-pulse rounded-panel bg-rule-2" />
    </>
  );
}
