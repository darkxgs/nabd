import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { MonitorActions } from "@/components/app/monitor-actions";
import { BeatStrip, DayBars } from "@/components/beat-strip";
import { LatencyChart } from "@/components/latency-chart";
import { buttonClass, cn, Panel, StateDot, StatePill } from "@/components/ui";
import { isDemoWorkspace, isSeededMonitor } from "@/lib/demo";
import { describeStatus, displayUrl } from "@/lib/monitor-input";
import { formatDuration, formatMs, formatPct, INTERVALS } from "@/lib/rules";
import { fmtDate, fmtDateTime, fmtLongDate, fmtTime, localDay } from "@/lib/time";
import { requireWorkspace } from "@/server/auth";
import { beats, dailyBars, effectiveState, getMonitor, monitorIncidents, percentiles, recentChecks, responseSeries, windows } from "@/server/queries";

export const metadata: Metadata = { title: "Monitor" };

const RANGES = { "24h": { label: "24 hours", ms: 24 * 3_600_000 }, "7d": { label: "7 days", ms: 7 * 24 * 3_600_000 }, "30d": { label: "30 days", ms: 30 * 24 * 3_600_000 } } as const;
type Range = keyof typeof RANGES;

export default function MonitorPage(props: PageProps<"/app/monitors/[id]">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <MonitorView {...props} />
    </Suspense>
  );
}

async function MonitorView({ params, searchParams }: PageProps<"/app/monitors/[id]">) {
  await connection();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const range: Range = sp.range === "7d" || sp.range === "30d" ? sp.range : "24h";
  const { conn, workspace } = await requireWorkspace();
  const m = await getMonitor(conn, workspace.id, id);
  if (!m) notFound();
  const tz = workspace.timezone;
  const now = new Date();
  const [w, p, strip, series, bars, incs, log] = await Promise.all([
    windows(conn, [id]).then((x) => x.get(id)),
    percentiles(conn, id),
    beats(conn, [id], 96).then((x) => x.get(id) ?? []),
    responseSeries(conn, id, range),
    dailyBars(conn, [id], tz, 90).then((x) => x.get(id) ?? []),
    monitorIncidents(conn, id, 8),
    recentChecks(conn, id, 24),
  ]);
  const st = effectiveState(m);
  const locked = isDemoWorkspace(workspace.id) && isSeededMonitor(m.id);
  const sampleBefore = workspace.sampleBefore;
  const sampleDay = sampleBefore ? localDay(sampleBefore, tz) : null;
  const sslDays = m.sslExpiresAt ? Math.floor((m.sslExpiresAt.getTime() - now.getTime()) / 86_400_000) : null;

  const headline =
    st === "paused"
      ? "Paused. No checks run until you resume it."
      : st === "pending"
        ? "Waiting for the first check."
        : `${st === "up" ? "Up" : st === "degraded" ? "Up but slow" : "Down"} for ${formatDuration(now.getTime() - m.stateSince.getTime())}, since ${fmtDateTime(m.stateSince, tz)}.`;

  return (
    <>
      <AutoRefresh seconds={60} />
      <Link href="/app" className="text-[13.5px] text-muted hover:text-ink">
        Monitors
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-[26px] leading-tight font-semibold tracking-[-0.015em] sm:text-[28px]">
            <StateDot state={st} live className="size-3" />
            <span className="truncate">{m.name}</span>
          </h1>
          <p className={cn("mt-1.5 text-[14.5px]", st === "down" ? "text-down" : "text-ink-2")}>
            {headline}
            {st === "down" && m.lastError ? ` ${m.lastError}.` : ""}
          </p>
          <a href={m.url} target="_blank" rel="noreferrer" className="mt-1 inline-block max-w-full truncate text-[13.5px] text-muted underline-offset-4 hover:text-ink hover:underline">
            {m.method} {displayUrl(m.url)}
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonitorActions id={m.id} paused={m.paused} locked={locked} />
          <Link href={`/app/monitors/${m.id}/edit`} className={buttonClass("outline", "sm")}>
            {locked ? "Settings" : "Edit"}
          </Link>
        </div>
      </div>

      {sp.added ? (
        <p className="mt-5 rounded-panel border border-up/25 bg-up-soft px-4 py-3 text-[14px] text-up">
          Added. {m.lastCheckedAt ? `The first check ${m.state === "down" || m.failStreak ? "failed" : "passed"}${m.lastLatencyMs != null ? ` in ${formatMs(m.lastLatencyMs)}` : ""}.` : "The first check is on its way."} The next one runs{" "}
          {INTERVALS.find((i) => i.sec === m.intervalSec)?.label.toLowerCase() ?? "soon"}.
        </p>
      ) : null}

      <div className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-rule bg-rule-2 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["Uptime, 24 hours", formatPct(w?.d1 ?? null)],
            ["7 days", formatPct(w?.d7 ?? null)],
            ["30 days", formatPct(w?.d30 ?? null)],
            ["90 days", formatPct(w?.d90 ?? null)],
            ["Median response, 24 h", formatMs(p.p50)],
            ["95th percentile", formatMs(p.p95)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="bg-card px-5 py-4">
            <p className="text-[12.5px] text-muted">{label}</p>
            <p className="readout mt-1.5 text-[28px] leading-none">{value}</p>
          </div>
        ))}
      </div>
      {sampleBefore && w ? <p className="mt-2 text-[12.5px] text-muted">Figures include sample history from before {fmtLongDate(sampleBefore, tz)}, shown faded below.</p> : null}

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold">Recent checks</h2>
          <p className="text-[13px] text-muted">
            {strip.length ? `${strip.length} checks since ${fmtTime(strip[0].at, tz)}${localDay(strip[0].at, tz) !== localDay(now, tz) ? `, ${fmtDate(strip[0].at, tz)}` : ""}. Hover a tick for details.` : "No checks yet."}
          </p>
        </div>
        <Panel className="mt-3 px-4 pt-5 pb-4">
          <BeatStrip beats={strip} slots={96} slowMs={m.slowMs} tz={tz} sampleBefore={sampleBefore} tall now={now} />
        </Panel>
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold">Response time</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {range === "24h" ? "Every check" : "Hourly averages"}, with the slow threshold ({formatMs(m.slowMs)}) dashed and failed checks in red. Point at the chart to read a value.
            </p>
          </div>
          <nav aria-label="Range" className="inline-flex rounded-control border border-rule bg-well p-0.5">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <Link
                key={r}
                href={`/app/monitors/${m.id}${r === "24h" ? "" : `?range=${r}`}`}
                scroll={false}
                aria-current={r === range ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center rounded-[4px] px-3 text-[13.5px] transition-colors",
                  r === range ? "bg-card font-medium text-ink shadow-[0_0_0_1px_var(--color-rule)]" : "text-muted hover:text-ink",
                )}
              >
                {RANGES[r].label}
              </Link>
            ))}
          </nav>
        </div>
        <Panel className="mt-3 px-4 pt-4 pb-3">
          {series.length ? (
            <LatencyChart points={series} from={new Date(now.getTime() - RANGES[range].ms)} to={now} tz={tz} slowMs={m.slowMs} sampleBefore={sampleBefore} />
          ) : (
            <p className="py-16 text-center text-[14px] text-muted">No checks in this range yet.</p>
          )}
        </Panel>
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold">90 days</h2>
          <p className="text-[13px] text-muted">One bar a day. Amber days had failed checks but stayed above 99%; red days fell below.</p>
        </div>
        <Panel className="mt-3 px-4 py-4">
          <DayBars bars={bars} sampleDay={sampleDay} />
          <div className="mt-2 flex justify-between text-[12px] text-faint">
            <span>{bars[0] ? fmtLongDate(new Date(`${bars[0].day}T12:00:00Z`), "UTC") : ""}</span>
            <span>Today</span>
          </div>
        </Panel>
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-[17px] font-semibold">Incidents</h2>
          {incs.length ? (
            <Panel className="mt-3">
              <ul>
                {incs.map((inc) => (
                  <li key={inc.id} className="border-b border-rule-2 last:border-b-0">
                    <Link href={`/app/incidents/${inc.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-well">
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium">{inc.cause ?? inc.title}</span>
                        <span className="block text-[13px] text-muted">{fmtDateTime(inc.startedAt, tz)}</span>
                      </span>
                      {inc.resolvedAt ? (
                        <span className="readout shrink-0 text-[15px] text-ink-2">{formatDuration(inc.resolvedAt.getTime() - inc.startedAt.getTime())}</span>
                      ) : (
                        <StatePill state="down" />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : (
            <p className="mt-3 rounded-panel border border-dashed border-rule px-4 py-8 text-center text-[14px] text-muted">No incidents. Every failure so far recovered before it was confirmed.</p>
          )}
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">Check log</h2>
          {log.length ? (
            <Panel className="mt-3 max-h-[420px] overflow-y-auto">
              <table className="w-full text-[13.5px]">
                <thead className="sticky top-0 bg-card text-start text-[12.5px] text-muted">
                  <tr className="border-b border-rule">
                    <th className="px-4 py-2 text-start font-normal">Time</th>
                    <th className="px-4 py-2 text-start font-normal">Result</th>
                    <th className="px-4 py-2 text-end font-normal">Response</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((c) => {
                    const slow = c.ok && c.latencyMs != null && c.latencyMs > m.slowMs;
                    const sample = !!sampleBefore && c.at < sampleBefore;
                    return (
                      <tr key={c.at.getTime()} className={cn("border-b border-rule-2 last:border-b-0", sample && "text-muted")}>
                        <td className="px-4 py-2 whitespace-nowrap tnum">
                          {fmtTime(c.at, tz)}
                          {sample ? <span className="ms-2 text-[12px] text-faint">sample</span> : null}
                        </td>
                        <td className={cn("px-4 py-2", !c.ok ? "text-down" : slow ? "text-slow" : "text-up")}>
                          {c.ok ? `${slow ? "Slow" : "Passed"}${c.status ? `, HTTP ${c.status}` : ""}` : (c.error ?? "Failed")}
                        </td>
                        <td className="px-4 py-2 text-end tnum">{formatMs(c.latencyMs)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          ) : (
            <p className="mt-3 rounded-panel border border-dashed border-rule px-4 py-8 text-center text-[14px] text-muted">No checks yet.</p>
          )}
        </section>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-[17px] font-semibold">How it&apos;s checked</h2>
          <Panel className="mt-3 p-1">
            <dl className="grid text-[14px]">
              {(
                [
                  ["Request", `${m.method} ${m.url}`],
                  [
                    "Passes when",
                    [`status is ${describeStatus(m.expectedStatus)}`, m.keyword ? (m.keywordMode === "contains" ? `page contains “${m.keyword}”` : `page doesn't contain “${m.keyword}”`) : null, `answer within ${m.timeoutMs / 1000} s`]
                      .filter(Boolean)
                      .join("; "),
                  ],
                  ["Slow above", formatMs(m.slowMs)],
                  ["Opens an incident after", `${m.confirmAfter} failed check${m.confirmAfter === 1 ? "" : "s"} in a row`],
                  ["Runs", `${INTERVALS.find((i) => i.sec === m.intervalSec)?.label ?? `Every ${m.intervalSec / 60} min`}${m.paused ? " (paused)" : `; next around ${fmtTime(m.nextCheckAt, tz)}`}`],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="grid gap-1 border-b border-rule-2 px-4 py-3 last:border-b-0 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-muted">{k}</dt>
                  <dd className="break-words text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">Certificate</h2>
          <Panel className="mt-3 p-5">
            {!m.url.startsWith("https://") ? (
              <p className="text-[14px] text-muted">This address uses plain http, so there&apos;s no certificate to watch.</p>
            ) : m.sslExpiresAt && sslDays != null ? (
              <>
                <p className={cn("readout text-[28px] leading-none", sslDays <= 14 ? "text-down" : sslDays <= 30 ? "text-slow" : "text-ink")}>
                  {sslDays < 0 ? "Expired" : `${sslDays} day${sslDays === 1 ? "" : "s"} left`}
                </p>
                <p className="mt-2 text-[14px] text-ink-2">
                  {sslDays < 0 ? "Expired" : "Expires"} {fmtLongDate(m.sslExpiresAt, tz)}
                  {m.sslIssuer ? `, issued by ${m.sslIssuer}` : ""}.
                </p>
                <p className="mt-1 text-[13px] text-muted">Nabd re-reads it twice a day and alerts 14 days before it expires.</p>
              </>
            ) : (
              <p className="text-[14px] text-muted">Read on the next check. Nabd alerts you 14 days before it expires.</p>
            )}
          </Panel>
        </section>
      </div>
    </>
  );
}

function Skeleton() {
  return (
    <>
      <div className="h-4 w-20 animate-pulse rounded bg-rule-2" />
      <div className="mt-3 h-9 w-72 animate-pulse rounded bg-rule-2" />
      <div className="mt-8 h-24 animate-pulse rounded-panel bg-rule-2" />
      <div className="mt-10 h-20 animate-pulse rounded-panel bg-rule-2" />
      <div className="mt-10 h-64 animate-pulse rounded-panel bg-rule-2" />
    </>
  );
}
