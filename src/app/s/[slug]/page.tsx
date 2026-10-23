import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DayBars } from "@/components/beat-strip";
import { Mark } from "@/components/brand";
import { cn } from "@/components/ui";
import type { MonitorState } from "@/db/schema";
import { formatDuration, formatDurationAr, formatPct } from "@/lib/rules";
import { addDays, fmtDay, fmtTime, localDay, type Lang } from "@/lib/time";
import { kickTick } from "@/server/jobs";
import { getPublicStatus } from "@/server/public-status";
import type { Overall, StatusPageData } from "@/server/queries";

export async function generateMetadata({ params, searchParams }: PageProps<"/s/[slug]">): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const data = await getPublicStatus(slug);
  if (!data) return { title: "Status page not found" };
  const lang = pickLang(sp.lang, data.page.defaultLocale);
  const title = lang === "ar" ? (data.page.titleAr ?? data.page.title) : data.page.title;
  return {
    title: { absolute: `${title}: ${T[lang].overall[data.overall]}` },
    description: (lang === "ar" ? data.page.introAr : data.page.intro) ?? undefined,
    alternates: { canonical: `/s/${slug}` },
  };
}

const pickLang = (v: unknown, fallback: Lang): Lang => (v === "ar" || v === "en" ? v : fallback);

const T = {
  en: {
    overall: { operational: "All systems operational", degraded: "Some systems are slow", partial: "Partial outage", major: "Major outage" } satisfies Record<Overall, string>,
    state: { up: "Operational", degraded: "Slow", down: "Down", pending: "Checking", paused: "Paused" } satisfies Record<MonitorState | "paused", string>,
    checked: (d: string) => `Last checked ${d} ago. Checks run every few minutes.`,
    checkedNow: "Checked just now. Checks run every few minutes.",
    components: "Components",
    uptime: "uptime",
    daysAgo: (n: number) => `${n} days ago`,
    today: "Today",
    ongoing: "Happening now",
    past: "Past incidents",
    none: "No incidents reported.",
    inc: { investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved" },
    outage: (label: string) => `${label} outage`,
    lasted: (d: string) => `Lasted ${d}`,
    sample: (d: string) => `History before ${d} is sample data.`,
    times: (tz: string) => `Times are in ${tz.replace(/_/g, " ")}.`,
    by: "Status page by",
    other: "العربية",
  },
  ar: {
    overall: { operational: "جميع الأنظمة تعمل بشكل طبيعي", degraded: "بعض الأنظمة بطيئة", partial: "انقطاع جزئي", major: "انقطاع واسع" } satisfies Record<Overall, string>,
    state: { up: "يعمل", degraded: "بطيء", down: "متوقف", pending: "قيد الفحص", paused: "متوقف مؤقتًا" } satisfies Record<MonitorState | "paused", string>,
    checked: (d: string) => `آخر فحص قبل ${d}. يتم الفحص كل بضع دقائق.`,
    checkedNow: "تم الفحص الآن. يتم الفحص كل بضع دقائق.",
    components: "المكوّنات",
    uptime: "نسبة التوفر",
    daysAgo: (n: number) => `قبل ${n} يومًا`,
    today: "اليوم",
    ongoing: "يحدث الآن",
    past: "الحوادث السابقة",
    none: "لا توجد حوادث.",
    inc: { investigating: "قيد التحقيق", identified: "تم تحديد السبب", monitoring: "قيد المتابعة", resolved: "تم الحل" },
    outage: (label: string) => `انقطاع في ${label}`,
    lasted: (d: string) => `استمر ${d}`,
    sample: (d: string) => `البيانات قبل ${d} بيانات تجريبية.`,
    times: (tz: string) => `الأوقات بتوقيت ${tz.replace(/_/g, " ")}.`,
    by: "صفحة الحالة من",
    other: "English",
  },
};

const TONE: Record<Overall, { band: string; text: string; dot: string }> = {
  operational: { band: "border-up/20 bg-up-soft", text: "text-up", dot: "bg-up" },
  degraded: { band: "border-slow/25 bg-slow-soft", text: "text-slow", dot: "bg-slow" },
  partial: { band: "border-down/25 bg-down-soft", text: "text-down", dot: "bg-down" },
  major: { band: "border-down/25 bg-down-soft", text: "text-down", dot: "bg-down" },
};

const STATE_TEXT: Record<MonitorState | "paused", string> = { up: "text-up", degraded: "text-slow", down: "text-down", pending: "text-muted", paused: "text-muted" };
const STATE_DOT: Record<MonitorState | "paused", string> = { up: "bg-up", degraded: "bg-slow", down: "bg-down", pending: "bg-idle", paused: "bg-idle" };

export default function StatusPage(props: PageProps<"/s/[slug]">) {
  return (
    <Suspense fallback={<div className="mx-auto mt-24 h-[60vh] max-w-3xl animate-pulse rounded-panel bg-rule-2" />}>
      <Status {...props} />
    </Suspense>
  );
}

async function Status({ params, searchParams }: PageProps<"/s/[slug]">) {
  await connection();
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const data = await getPublicStatus(slug);
  if (!data) notFound();
  kickTick();
  const lang = pickLang(sp.lang, data.page.defaultLocale);
  return <StatusView data={data} lang={lang} slug={slug} now={new Date()} />;
}

function StatusView({ data, lang, slug, now }: { data: StatusPageData; lang: Lang; slug: string; now: Date }) {
  const t = T[lang];
  const ar = lang === "ar";
  const tz = data.workspace.timezone;
  const title = ar ? (data.page.titleAr ?? data.page.title) : data.page.title;
  const intro = ar ? (data.page.introAr ?? data.page.intro) : data.page.intro;
  const tone = TONE[data.overall];
  const dur = (ms: number) => (ar ? formatDurationAr(ms) : formatDuration(ms));
  const day = (d: Date) => fmtDay(localDay(d, tz), lang);
  const otherLang = ar ? "en" : "ar";
  const otherHref = otherLang === data.page.defaultLocale ? `/s/${slug}` : `/s/${slug}?lang=${otherLang}`;
  const sinceCheck = data.lastChecked ? now.getTime() - data.lastChecked.getTime() : null;

  const titleOf = (i: StatusPageData["incidents"][number]) =>
    i.component ? t.outage(ar ? i.component.labelAr : i.component.label) : ar ? (i.titleAr ?? i.title) : i.title;
  const ongoing = data.incidents.filter((i) => !i.resolvedAt);
  const past = data.incidents.filter((i) => i.resolvedAt);
  const today = localDay(now, tz);
  const days = Array.from({ length: 7 }, (_, k) => addDays(today, -k)).filter((d) => past.some((i) => localDay(i.startedAt, tz) === d));
  const sampleDay = data.workspace.sampleBefore ? localDay(data.workspace.sampleBefore, tz) : null;

  return (
    <div lang={lang} dir={ar ? "rtl" : "ltr"} className={cn("min-h-dvh", ar && "font-arabic")}>
      <div className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6 sm:pt-16">
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className={cn("text-[28px] leading-tight font-semibold text-balance sm:text-[32px]", ar ? "tracking-normal" : "tracking-[-0.015em]")}>{title}</h1>
            {intro ? <p className="mt-2 max-w-xl text-[15.5px] leading-relaxed text-ink-2">{intro}</p> : null}
          </div>
          <Link href={otherHref} hrefLang={otherLang} lang={otherLang} className={cn("shrink-0 rounded-control border border-rule bg-card px-3 py-1.5 text-[14px] text-ink-2 hover:border-ink-2/50 hover:text-ink", !ar && "font-arabic")}>
            {t.other}
          </Link>
        </header>

        <section aria-live="polite" className={cn("mt-8 flex items-center gap-4 rounded-panel border px-5 py-5 sm:px-6", tone.band)}>
          <span className="relative grid size-4 shrink-0 place-items-center" aria-hidden>
            <span className={cn("absolute inset-0 animate-ping-slow rounded-full opacity-60", tone.dot)} />
            <span className={cn("relative size-3 rounded-full", tone.dot)} />
          </span>
          <div className="min-w-0">
            <p className={cn("text-[20px] leading-snug font-semibold sm:text-[22px]", tone.text)}>{t.overall[data.overall]}</p>
            <p className="mt-0.5 text-[14px] text-ink-2">{sinceCheck == null ? "" : sinceCheck < 60_000 ? t.checkedNow : t.checked(dur(sinceCheck))}</p>
          </div>
        </section>

        {ongoing.length ? (
          <section className="mt-8 grid gap-3">
            <h2 className="text-[15px] font-semibold text-down">{t.ongoing}</h2>
            {ongoing.map((i) => (
              <IncidentCard key={i.id} i={i} title={titleOf(i)} lang={lang} tz={tz} open />
            ))}
          </section>
        ) : null}

        <section className="mt-10">
          <h2 className="text-[17px] font-semibold">{t.components}</h2>
          <ul className="mt-3 overflow-hidden rounded-panel border border-rule bg-card">
            {data.components.map((c) => {
              const sample = sampleDay;
              return (
                <li key={c.id} className="border-b border-rule-2 px-5 py-4 last:border-b-0">
                  <div className="flex items-center justify-between gap-4">
                    <span className="min-w-0 truncate text-[15.5px] font-medium">{ar ? c.labelAr : c.label}</span>
                    <span className={cn("inline-flex shrink-0 items-center gap-2 text-[14px] font-medium", STATE_TEXT[c.state])}>
                      <span className={cn("size-2 rounded-full", STATE_DOT[c.state])} aria-hidden />
                      {t.state[c.state]}
                    </span>
                  </div>
                  <DayBars bars={c.bars} sampleDay={sample} lang={lang} className="mt-3 hidden h-9 sm:flex" />
                  <DayBars bars={c.bars.slice(-30)} sampleDay={sample} lang={lang} className="mt-3 h-9 sm:hidden" />
                  <div className="mt-2 flex items-center justify-between gap-3 text-[12.5px] text-muted">
                    <span className="hidden sm:inline">{t.daysAgo(90)}</span>
                    <span className="sm:hidden">{t.daysAgo(30)}</span>
                    <span className="tnum">
                      {formatPct(c.uptime90)} {t.uptime}
                    </span>
                    <span>{t.today}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-[17px] font-semibold">{t.past}</h2>
          {days.length ? (
            <ol className="mt-4 grid gap-7">
              {days.map((d) => (
                <li key={d}>
                  <h3 className="text-[14px] font-medium text-muted">{d === today ? t.today : fmtDay(d, lang)}</h3>
                  <div className="mt-2.5 grid gap-2">
                    {past
                      .filter((i) => localDay(i.startedAt, tz) === d)
                      .map((i) => (
                        <IncidentCard key={i.id} i={i} title={titleOf(i)} lang={lang} tz={tz} />
                      ))}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-[14.5px] text-muted">{t.none}</p>
          )}
        </section>

        <footer className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5 text-[13px] text-muted">
          <span>
            {t.times(tz)} {data.workspace.sampleBefore ? t.sample(day(data.workspace.sampleBefore)) : ""}
          </span>
          <Link href="/" className="inline-flex items-center gap-1.5 hover:text-ink" dir="ltr">
            <span className={ar ? "font-arabic" : ""}>{t.by}</span>
            <Mark className="size-3.5 text-ink" />
            <span className="font-semibold text-ink">nabd</span>
          </Link>
        </footer>
      </div>
    </div>
  );
}

function IncidentCard({ i, title, lang, tz, open }: { i: StatusPageData["incidents"][number]; title: string; lang: Lang; tz: string; open?: boolean }) {
  const t = T[lang];
  const ar = lang === "ar";
  const lasted = i.resolvedAt ? i.resolvedAt.getTime() - i.startedAt.getTime() : null;
  const updates = (
    <ol className="grid gap-2.5">
      {i.updates.map((u) => (
        <li key={u.id} className="grid gap-x-3 text-[14px] leading-relaxed sm:grid-cols-[120px_minmax(0,1fr)]">
          <span>
            <span className="font-medium">{t.inc[u.state]}</span>
            <span className="ms-2 text-muted tnum">{fmtTime(u.createdAt, tz)}</span>
          </span>
          <span className="text-ink-2">{ar ? (u.bodyAr ?? u.body) : u.body}</span>
        </li>
      ))}
    </ol>
  );
  if (open) {
    return (
      <article className="rounded-panel border border-down/35 bg-card px-5 py-4">
        <h3 className="text-[15.5px] font-semibold text-down">{title}</h3>
        <div className="mt-3">{updates}</div>
      </article>
    );
  }
  return (
    <details className="group rounded-panel border border-rule bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold">{title}</span>
          <span className="mt-0.5 block text-[13.5px] text-muted">
            <bdi dir="ltr">
              {fmtTime(i.startedAt, tz)}–{fmtTime(i.resolvedAt!, tz)}
            </bdi>
            {lasted != null ? `${ar ? "، " : ", "}${t.lasted(ar ? formatDurationAr(lasted) : formatDuration(lasted)).toLowerCase()}` : ""}
          </span>
        </span>
        <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="border-t border-rule-2 px-5 py-4">{updates}</div>
    </details>
  );
}
