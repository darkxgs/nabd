// The decisions a monitor makes, as pure functions: what counts as a pass, and
// how a stream of results turns into up, degraded and down. No I/O here, so the
// whole state machine is unit-tested.
import type { MonitorState } from "@/db/schema";

/**
 * Expected status codes, written the way people say them:
 * "200-399", "200,204", "2xx", "2xx,301". Empty means 200-399.
 */
export function statusMatches(spec: string, code: number): boolean {
  const parts = (spec || "200-399").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return parts.some((p) => {
    const xx = p.match(/^([1-5])xx$/);
    if (xx) return Math.floor(code / 100) === Number(xx[1]);
    const range = p.match(/^(\d{3})\s*-\s*(\d{3})$/);
    if (range) return code >= Number(range[1]) && code <= Number(range[2]);
    return /^\d{3}$/.test(p) && Number(p) === code;
  });
}

export function isValidStatusSpec(spec: string): boolean {
  return spec
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .every((p) => /^[1-5]xx$/.test(p) || /^\d{3}$/.test(p) || /^(\d{3})\s*-\s*(\d{3})$/.test(p));
}

export type ProbeResult = {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  /** Short, human cause when not ok: "HTTP 503", "Timed out after 10 s". */
  error: string | null;
};

export type Transition = {
  state: MonitorState;
  failStreak: number;
  /** "down" opens an incident and alerts; "up" closes it. */
  event: "down" | "up" | null;
};

/**
 * One failure is not an outage: a monitor goes down only after `confirmAfter`
 * failed checks in a row, and comes back up on the first good one. A good but
 * slow answer is "degraded", which never alerts on its own.
 */
export function nextState(
  current: { state: MonitorState; failStreak: number; confirmAfter: number; slowMs: number },
  result: ProbeResult,
): Transition {
  if (result.ok) {
    const slow = result.latencyMs != null && result.latencyMs > current.slowMs;
    return { state: slow ? "degraded" : "up", failStreak: 0, event: current.state === "down" ? "up" : null };
  }
  const failStreak = current.failStreak + 1;
  if (failStreak >= Math.max(1, current.confirmAfter)) {
    return { state: "down", failStreak, event: current.state === "down" ? null : "down" };
  }
  // Not confirmed yet: keep showing the last known state.
  return { state: current.state, failStreak, event: null };
}

/** Uptime as a percentage with the precision people expect (99.98 %, not 100 % when there was a blip). */
export function uptimePct(total: number, failures: number): number | null {
  if (total <= 0) return null;
  const pct = ((total - failures) / total) * 100;
  if (failures > 0 && pct > 99.99) return 99.99;
  return Math.floor(pct * 100) / 100;
}

export function formatPct(p: number | null): string {
  if (p == null) return "–";
  if (p === 100) return "100%";
  return `${p.toFixed(p >= 99 ? 2 : 1)}%`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  // 1.23 s, 2.6 s, 2 s: two decimals at most, no trailing zeros.
  return `${Number((ms / 1000).toFixed(ms < 10_000 ? 2 : 1))} s`;
}

/** "3 min", "1 h 12 min", "2 d 4 h": for incident lengths. */
export function formatDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

/** The same, in Arabic: "20 دقيقة"، "ساعة و12 دقيقة". */
export function formatDurationAr(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  const unit = (n: number, one: string, two: string, few: string, many: string) =>
    n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`;
  const mins = (n: number) => unit(n, "دقيقة", "دقيقتين", "دقائق", "دقيقة");
  const hours = (n: number) => unit(n, "ساعة", "ساعتين", "ساعات", "ساعة");
  const days = (n: number) => unit(n, "يوم", "يومين", "أيام", "يومًا");
  if (min < 1) return "أقل من دقيقة";
  if (min < 60) return mins(min);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${hours(h)} و${mins(m)}` : hours(h);
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${days(d)} و${hours(rh)}` : days(d);
}

export const INTERVALS = [
  { sec: 300, label: "Every 5 minutes" },
  { sec: 600, label: "Every 10 minutes" },
  { sec: 900, label: "Every 15 minutes" },
  { sec: 1800, label: "Every 30 minutes" },
  { sec: 3600, label: "Every hour" },
] as const;

/** The probe's causes in Arabic, for incident updates on Arabic status pages. */
export function causeAr(cause: string): string {
  const timeout = cause.match(/^Timed out after (\d+) s$/);
  if (timeout) {
    const n = Number(timeout[1]);
    return `انتهت المهلة بعد ${n === 1 ? "ثانية واحدة" : n === 2 ? "ثانيتين" : n <= 10 ? `${n} ثوانٍ` : `${n} ثانية`}`;
  }
  const http = cause.match(/^HTTP (\d{3})$/);
  if (http) return `رمز الاستجابة HTTP ${http[1]}`;
  const missing = cause.match(/^"(.+)" not on the page$/);
  if (missing) return `النص "${missing[1]}" غير موجود في الصفحة`;
  const found = cause.match(/^"(.+)" found on the page$/);
  if (found) return `النص "${found[1]}" ظهر في الصفحة`;
  const known: Record<string, string> = {
    "Address not allowed (private network)": "عنوان غير مسموح به (شبكة خاصة)",
    "Domain not found (DNS)": "النطاق غير موجود (DNS)",
    "Connection refused": "رفض الخادم الاتصال",
    "Connection reset": "انقطع الاتصال",
    "Host unreachable": "تعذّر الوصول إلى الخادم",
    "SSL certificate expired": "انتهت صلاحية شهادة SSL",
    "SSL certificate doesn't match the domain": "شهادة SSL لا تطابق النطاق",
    "Self-signed SSL certificate": "شهادة SSL موقّعة ذاتيًا",
    "SSL certificate chain incomplete": "سلسلة شهادة SSL غير مكتملة",
    "Check failed": "فشل الفحص",
  };
  return known[cause] ?? cause;
}
