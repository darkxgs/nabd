// Dates for people, assembled from Intl parts so Node and browsers print the
// same thing ("Sep" vs "Sept" differs between ICU builds and breaks hydration).
export type Lang = "en" | "ar";

const parts = (d: Date, tz: string, opts: Intl.DateTimeFormatOptions, locale = "en-GB") => {
  const p = new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz }).formatToParts(d);
  return (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "";
};

/** "14:05" */
export function fmtTime(d: Date, tz: string) {
  const g = parts(d, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${g("hour")}:${g("minute")}`;
}

/** "Fri 23 Oct" */
export function fmtDate(d: Date, tz: string) {
  const g = parts(d, tz, { weekday: "short", day: "numeric", month: "short" });
  return `${g("weekday")} ${g("day")} ${g("month").replace(/^Sept$/, "Sep")}`;
}

/** "23 Oct 2026" */
export function fmtLongDate(d: Date, tz: string) {
  const g = parts(d, tz, { day: "numeric", month: "short", year: "numeric" });
  return `${g("day")} ${g("month").replace(/^Sept$/, "Sep")} ${g("year")}`;
}

/** "Fri 23 Oct, 14:05" */
export const fmtDateTime = (d: Date, tz: string) => `${fmtDate(d, tz)}, ${fmtTime(d, tz)}`;

/** A YYYY-MM-DD day as "23 Oct". */
export function fmtDay(day: string, lang: Lang = "en") {
  const d = new Date(`${day}T12:00:00Z`);
  if (lang === "ar") return new Intl.DateTimeFormat("ar-AE-u-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" }).format(d);
  const g = parts(d, "UTC", { day: "numeric", month: "short" });
  return `${g("day")} ${g("month").replace(/^Sept$/, "Sep")}`;
}

/** Arabic date and time for the public status page: "23 أكتوبر، 14:05". */
export function fmtDateTimeAr(d: Date, tz: string) {
  const date = new Intl.DateTimeFormat("ar-AE-u-nu-latn", { day: "numeric", month: "long", timeZone: tz }).format(d);
  return `${date}، ${fmtTime(d, tz)}`;
}

/** The local calendar day of an instant, YYYY-MM-DD. */
export function localDay(d: Date, tz: string) {
  const g = parts(d, tz, { year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA");
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "just now", "4 min ago", "3 h ago", "2 days ago" */
export function ago(d: Date, now = new Date(), lang: Lang = "en") {
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (lang === "ar") {
    if (s < 60) return "الآن";
    if (s < 3600) return `قبل ${Math.round(s / 60)} د`;
    if (s < 86400) return `قبل ${Math.round(s / 3600)} س`;
    return `قبل ${Math.round(s / 86400)} يوم`;
  }
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export const TIMEZONES = [
  "UTC",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Asia/Kuwait",
  "Asia/Bahrain",
  "Asia/Muscat",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
] as const;
