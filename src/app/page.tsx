import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { BeatStrip } from "@/components/beat-strip";
import { Logo } from "@/components/brand";
import { buttonClass, cn, StateDot } from "@/components/ui";
import { DEMO } from "@/lib/demo";
import { displayUrl } from "@/lib/monitor-input";
import { formatDuration, formatMs, formatPct } from "@/lib/rules";
import { fmtDay, fmtTime, localDay } from "@/lib/time";
import { kickTick } from "@/server/jobs";
import { getDemoBoard, getDemoOutage, getPublicStatus } from "@/server/public-status";
import { demoLogin } from "./(auth)/actions";

const TZ = "UTC";

export default function Home() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link href="/" aria-label="Nabd">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 text-[14px] sm:gap-2">
          <Link href={`/s/${DEMO.statusSlug}`} className="hidden rounded-control px-3 py-2 text-ink-2 hover:text-ink sm:block">
            Example status page
          </Link>
          <Link href="/login" className="rounded-control px-3 py-2 text-ink-2 hover:text-ink">
            Sign in
          </Link>
          <form action={demoLogin}>
            <button type="submit" className={buttonClass("primary", "sm")}>
              Open the demo
            </button>
          </form>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pt-10 sm:px-8 sm:pt-16">
          <h1 className="max-w-4xl text-[42px] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-[64px]">A pulse for every site you run.</h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink-2 sm:text-[18.5px]">
            Nabd <span className="font-arabic text-muted">(نبض, Arabic for pulse)</span> checks your websites and APIs from the internet every few minutes. When one stops answering, it opens
            an incident, alerts your team on Slack, Discord or email, and updates a status page your customers can read in English or Arabic.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <form action={demoLogin}>
              <button type="submit" className={buttonClass("primary", "lg")}>
                Open the live demo
              </button>
            </form>
            <Link href="/signup" className={buttonClass("outline", "lg")}>
              Create a free account
            </Link>
          </div>
          <p className="mt-3 text-[13.5px] text-muted">The demo needs no sign-up. It opens a shared workspace watching the sites below.</p>
        </section>

        <section className="mx-auto mt-14 max-w-6xl px-5 sm:px-8">
          <Suspense fallback={<div className="h-[440px] animate-pulse rounded-panel bg-rule-2" />}>
            <LiveBoard />
          </Suspense>
        </section>

        <section className="mx-auto mt-28 max-w-6xl px-5 sm:px-8">
          <h2 className="max-w-2xl text-[30px] leading-tight font-semibold tracking-[-0.02em] sm:text-[36px]">What an outage looks like from here</h2>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-2">
            The demo includes a test page that fails on purpose at 01:20 and 13:20 UTC. This is its most recent outage, read straight from the database.
          </p>
          <Suspense fallback={<div className="mt-10 h-56 animate-pulse rounded-panel bg-rule-2" />}>
            <OutageWalkthrough />
          </Suspense>
        </section>

        <section className="mx-auto mt-28 max-w-6xl px-5 sm:px-8">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
            <div>
              <h2 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] sm:text-[36px]">A status page in both languages your customers speak</h2>
              <p className="mt-4 text-[16px] leading-relaxed text-ink-2">
                Name each component the way customers know it, in English and Arabic. The page shows what&apos;s up right now, 90 days of history and every incident update,
                right to left when it should be. It also comes as a JSON feed and a README badge.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href={`/s/${DEMO.statusSlug}`} className={buttonClass("outline", "md")}>
                  English version
                </Link>
                <Link href={`/s/${DEMO.statusSlug}?lang=ar`} className={cn(buttonClass("outline", "md"), "font-arabic")}>
                  النسخة العربية
                </Link>
              </div>
            </div>
            <Suspense fallback={<div className="h-80 animate-pulse rounded-panel bg-rule-2" />}>
              <StatusPreview />
            </Suspense>
          </div>
        </section>

        <section className="mx-auto mt-28 max-w-6xl px-5 sm:px-8">
          <h2 className="max-w-2xl text-[30px] leading-tight font-semibold tracking-[-0.02em] sm:text-[36px]">Built not to cry wolf</h2>
          <dl className="mt-10 grid gap-x-16 gap-y-9 sm:grid-cols-2">
            {[
              ["One dropped request isn't an outage", "A monitor goes down only after one to five failed checks in a row, your choice. The first good check closes the incident."],
              ["Slow is not down", "Answers over your threshold show as slow on the dashboard and the status page, without paging anyone."],
              ["Pages that load but are broken", "A keyword check fails a page that returns 200 but is missing what should be there, like an empty shop."],
              ["Certificates before they expire", "Nabd reads each site's TLS certificate twice a day and warns 14 days before it runs out."],
              ["Alerts that can't get lost", "Alerts are written to Postgres first and delivered after, with retries. Webhooks carry an HMAC signature you can verify."],
              ["Only the public internet", "Addresses that resolve to private or internal networks are refused, at every redirect, so a monitor can't be turned against the server."],
            ].map(([t, d]) => (
              <div key={t}>
                <dt className="text-[17px] font-semibold">{t}</dt>
                <dd className="mt-1.5 max-w-md text-[15px] leading-relaxed text-ink-2">{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mx-auto mt-28 max-w-6xl px-5 sm:px-8">
          <div className="rounded-panel bg-ink px-6 py-10 text-white sm:px-12 sm:py-14">
            <h2 className="max-w-2xl text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[34px]">See it work on real sites</h2>
            <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-white/65">Open the demo and look around, or create an account and add your own site. The first check runs as soon as you save.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <form action={demoLogin}>
                <button type="submit" className={buttonClass("primary", "lg", "bg-white text-ink hover:bg-white/90")}>
                  Open the live demo
                </button>
              </form>
              <Link href="/signup" className={buttonClass("outline", "lg", "border-white/25 bg-transparent text-white hover:border-white/60")}>
                Create a free account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto mt-20 flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-rule px-5 py-8 text-[13.5px] text-muted sm:px-8">
        <p>
          Nabd is designed, built and run by{" "}
          <a href="https://www.seifashraf.dev" className="text-ink underline underline-offset-4">
            Seif Ashraf
          </a>
          .
        </p>
        <div className="flex gap-5">
          <a href="https://github.com/darkxgs/nabd" className="hover:text-ink">
            Source on GitHub
          </a>
          <Link href={`/s/${DEMO.statusSlug}`} className="hover:text-ink">
            Status
          </Link>
        </div>
      </footer>
    </div>
  );
}

async function LiveBoard() {
  await connection();
  const rows = await getDemoBoard();
  kickTick();
  const now = new Date();
  const up = rows.filter((r) => r.state === "up" || r.state === "degraded").length;
  return (
    <div className="overflow-hidden rounded-panel border border-rule bg-card shadow-[0_1px_0_rgb(20_24_30/0.04),0_12px_40px_-12px_rgb(20_24_30/0.12)]">
      <AutoRefresh seconds={60} />
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-rule px-5 py-3.5">
        <p className="flex items-center gap-2.5 text-[14px] font-medium">
          <span className="relative grid size-3 place-items-center" aria-hidden>
            <span className="absolute inset-0 animate-ping-slow rounded-full bg-up" />
            <span className="relative size-2 rounded-full bg-up" />
          </span>
          Live: {up} of {rows.length} answering right now
        </p>
        <p className="text-[13px] text-muted">Seif Ashraf&apos;s projects, plus a test page that fails on a schedule. Last 48 checks per site.</p>
      </div>
      <ul>
        {rows.map((m) => (
          <li key={m.id} className="grid gap-x-6 gap-y-2.5 border-b border-rule-2 px-5 py-3.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_76px_76px] md:items-center">
            <div className="min-w-0">
              <p className="flex items-center gap-2.5">
                <StateDot state={m.state} live />
                <span className="truncate text-[14.5px] font-medium">{m.name}</span>
              </p>
              <p className="truncate ps-5 text-[12.5px] text-muted">{displayUrl(m.url)}</p>
            </div>
            <BeatStrip beats={m.beats} slowMs={m.slowMs} tz={TZ} now={now} sampleBefore={m.sampleBefore} />
            <div className="grid grid-cols-2 gap-4 md:contents">
              <p className="md:text-end">
                <span className="block text-[12px] text-muted md:hidden">30 days</span>
                <span className="readout text-[16px]">{formatPct(m.uptime30)}</span>
              </p>
              <p className="md:text-end">
                <span className="block text-[12px] text-muted md:hidden">Response</span>
                <span className={cn("readout text-[16px]", m.state === "down" ? "text-down" : m.state === "degraded" ? "text-slow" : "")}>
                  {m.state === "down" ? "down" : formatMs(m.lastLatencyMs)}
                </span>
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t border-rule bg-well px-5 py-2.5 text-[12.5px] text-muted">
        Updated {rows[0]?.lastCheckedAt ? `${Math.max(1, Math.round((now.getTime() - Math.max(...rows.map((r) => r.lastCheckedAt?.getTime() ?? 0))) / 60_000))} min ago` : "soon"}. Hover a tick to see when it ran and how long it took. Faded ticks are sample history.
      </p>
    </div>
  );
}

async function OutageWalkthrough() {
  await connection();
  const o = await getDemoOutage();
  if (!o) return <p className="mt-10 text-[15px] text-muted">The demo hasn&apos;t had an outage yet. The next one starts at 01:20 or 13:20 UTC.</p>;
  const { incident: inc, updates, alerts } = o;
  const opened = updates.find((u) => u.state !== "resolved");
  const closed = updates.find((u) => u.state === "resolved");
  const steps: { at: Date; title: string; body: string; tone: "down" | "up" | "ink" }[] = [
    { at: inc.startedAt, title: "First failed check", body: `${inc.cause ?? "The check failed"}. One failure could be a blip, so nothing is sent yet.`, tone: "down" },
  ];
  if (opened) steps.push({ at: opened.createdAt, title: "Second failure: incident opened", body: "Now it's an outage. The status page switches to a partial outage, with the incident at the top.", tone: "down" });
  if (alerts.length) steps.push({ at: alerts[0].at, title: `${alerts.length} alert${alerts.length === 1 ? "" : "s"} sent`, body: "To every active channel: on-call email and Slack in the demo (recorded, not delivered).", tone: "ink" });
  if (closed && inc.resolvedAt) steps.push({ at: closed.createdAt, title: "Back up, resolved automatically", body: `The first good check closed it after ${formatDuration(inc.resolvedAt.getTime() - inc.startedAt.getTime())}. Recovery alerts go out the same way.`, tone: "up" });
  const day = fmtDay(localDay(inc.startedAt, "UTC"));
  const sample = !!o.sampleBefore && inc.startedAt < o.sampleBefore;
  return (
    <div className="mt-10">
      <ol className="relative grid gap-8 md:grid-cols-4 md:gap-6">
        {steps.map((s, i) => (
          <li key={i} className="relative ps-7 md:ps-0 md:pt-8">
            <span className={cn("absolute start-0 top-1.5 size-3 rounded-full ring-4 ring-paper md:top-0", s.tone === "down" ? "bg-down" : s.tone === "up" ? "bg-up" : "bg-ink-2")} aria-hidden />
            {i < steps.length - 1 ? (
              <span className={cn("absolute start-[5px] top-5 -bottom-8 w-0.5 md:start-4 md:-end-6 md:top-[5px] md:bottom-auto md:h-0.5 md:w-auto", s.tone === "up" ? "bg-up/40" : "bg-down/40")} aria-hidden />
            ) : null}
            <p className="readout text-[22px] leading-none">{fmtTime(s.at, "UTC")}</p>
            <p className="mt-2 text-[15px] font-semibold">{s.title}</p>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-[13px] text-muted">
        {day}, times in UTC{sample ? ", from the demo's sample history" : ""}.{" "}
        <Link href={`/s/${DEMO.targetSlug}`} className="underline underline-offset-4 hover:text-ink">
          See how it reads on a status page
        </Link>
        .
      </p>
    </div>
  );
}

async function StatusPreview() {
  await connection();
  const data = await getPublicStatus(DEMO.statusSlug);
  if (!data) return null;
  const shown = data.components.slice(0, 4);
  const operational = data.overall === "operational";
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-hidden>
      {(["en", "ar"] as const).map((lang) => (
        <Link
          key={lang}
          href={`/s/${DEMO.statusSlug}${lang === "ar" ? "?lang=ar" : ""}`}
          tabIndex={-1}
          dir={lang === "ar" ? "rtl" : "ltr"}
          lang={lang}
          className={cn("block rounded-panel border border-rule bg-card p-4 transition-shadow hover:shadow-[0_8px_30px_-10px_rgb(20_24_30/0.18)]", lang === "ar" && "font-arabic sm:translate-y-6")}
        >
          <p className="truncate text-[14px] font-semibold">{lang === "ar" ? (data.page.titleAr ?? data.page.title) : data.page.title}</p>
          <p className={cn("mt-3 rounded-[4px] px-3 py-2.5 text-[13px] font-semibold", operational ? "bg-up-soft text-up" : "bg-down-soft text-down")}>
            {lang === "ar"
              ? { operational: "جميع الأنظمة تعمل بشكل طبيعي", degraded: "بعض الأنظمة بطيئة", partial: "انقطاع جزئي", major: "انقطاع واسع" }[data.overall]
              : { operational: "All systems operational", degraded: "Some systems are slow", partial: "Partial outage", major: "Major outage" }[data.overall]}
          </p>
          <ul className="mt-3 grid gap-3">
            {shown.map((c) => (
              <li key={c.id}>
                <p className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="truncate">{lang === "ar" ? c.labelAr : c.label}</span>
                  <span className={cn("size-1.5 shrink-0 rounded-full", c.state === "down" ? "bg-down" : c.state === "degraded" ? "bg-slow" : "bg-up")} />
                </p>
                <div className="mt-1.5 flex h-4 gap-px">
                  {c.bars.slice(-30).map((b) => (
                    <span key={b.day} className={cn("flex-1 rounded-[1px]", b.pct == null ? "bg-rule" : b.failures === 0 ? "bg-up" : b.pct >= 99 ? "bg-slow" : "bg-down")} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Link>
      ))}
    </div>
  );
}
