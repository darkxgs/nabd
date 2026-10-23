// The monitor form, shared by the browser (live summary) and the server
// (validation). No server imports here.
import { z } from "zod";
import { INTERVALS, isValidStatusSpec } from "./rules";

export type MonitorDraft = {
  name: string;
  url: string;
  intervalSec: number;
  method: "GET" | "HEAD";
  expectedStatus: string;
  keyword: string;
  keywordMode: "contains" | "absent";
  timeoutSec: number;
  slowMs: number;
  confirmAfter: number;
};

export const MONITOR_DEFAULTS: MonitorDraft = {
  name: "",
  url: "",
  intervalSec: 300,
  method: "GET",
  expectedStatus: "200-399",
  keyword: "",
  keywordMode: "contains",
  timeoutSec: 10,
  slowMs: 2000,
  confirmAfter: 2,
};

/** "example.com/shop" becomes "https://example.com/shop". Null when it can't be a web address. */
export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname;
  if (!host || (!host.includes(".") && host !== "localhost" && !host.startsWith("["))) return null;
  u.hash = "";
  return u.toString();
}

/** "https://www.example.com/shop/" as "example.com/shop": how people say a URL. */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return `${u.host.replace(/^www\./, "")}${path}${u.search}`;
  } catch {
    return url;
  }
}

const num = (min: number, max: number, low: string, high: string) => z.coerce.number({ message: "Enter a number." }).int("Use a whole number.").min(min, low).max(max, high);

export const MonitorSchema = z
  .object({
    name: z.string().trim().max(80, "Keep the name under 80 characters.").default(""),
    url: z
      .string()
      .trim()
      .min(1, "Enter the address to check.")
      .max(2000, "That address is too long.")
      .transform((v, ctx) => {
        if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(v)) {
          ctx.addIssue({ code: "custom", message: "Remove the username and password from the address." });
          return z.NEVER;
        }
        const u = normalizeUrl(v);
        if (!u) {
          ctx.addIssue({ code: "custom", message: "Enter a full web address, like https://example.com." });
          return z.NEVER;
        }
        return u;
      }),
    intervalSec: z.coerce.number().refine((n) => INTERVALS.some((i) => i.sec === n), "Pick how often to check."),
    method: z.enum(["GET", "HEAD"]).default("GET"),
    expectedStatus: z
      .string()
      .trim()
      .max(60)
      .default("200-399")
      .transform((v) => v || "200-399")
      .refine(isValidStatusSpec, "Use codes and ranges like 200-399, 2xx or 200,301."),
    keyword: z.string().trim().max(200, "Keep the keyword under 200 characters.").default(""),
    keywordMode: z.enum(["contains", "absent"]).default("contains"),
    timeoutSec: num(1, 30, "Allow at least 1 second.", "The longest timeout is 30 seconds."),
    slowMs: num(100, 30_000, "Use at least 100 ms.", "Use at most 30000 ms."),
    confirmAfter: num(1, 5, "At least one check.", "At most five checks."),
  })
  .superRefine((v, ctx) => {
    if (v.keyword && v.method === "HEAD") ctx.addIssue({ code: "custom", path: ["keyword"], message: "Keyword checks need GET, because HEAD responses have no body." });
    if (v.slowMs >= v.timeoutSec * 1000) ctx.addIssue({ code: "custom", path: ["slowMs"], message: "Set this below the timeout." });
  });

export type MonitorInput = z.output<typeof MonitorSchema>;

export function parseMonitorForm(form: FormData): { ok: true; value: MonitorInput } | { ok: false; fields: Record<string, string> } {
  const raw = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  const parsed = MonitorSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    fields[key] ??= issue.message;
  }
  return { ok: false, fields };
}

/** "200-399" as "between 200 and 399", "2xx,301" as "any 2xx or 301". */
export function describeStatus(spec: string): string {
  const parts = (spec || "200-399")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((p) => {
      const range = p.match(/^(\d{3})\s*-\s*(\d{3})$/);
      if (range) return `between ${range[1]} and ${range[2]}`;
      if (/^[1-5]xx$/.test(p)) return `any ${p}`;
      return p;
    });
  if (parts.length <= 1) return parts[0] ?? "between 200 and 399";
  return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

const every = (sec: number) => INTERVALS.find((i) => i.sec === sec)?.label.toLowerCase() ?? `every ${Math.round(sec / 60)} minutes`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const seconds = (ms: number) => (ms % 1000 === 0 ? `${ms / 1000} s` : `${(ms / 1000).toFixed(1)} s`);

/** The plain-language summary shown beside the form while it's filled in. */
export function describeMonitor(d: MonitorDraft): string[] {
  const url = normalizeUrl(d.url);
  const target = url ? displayUrl(url) : "your address";
  const lines = [`${every(d.intervalSec).replace(/^every/, "Every")}, Nabd sends a ${d.method} request to ${target}.`];
  const conditions = [`the status code is ${describeStatus(d.expectedStatus)}`];
  if (d.keyword.trim() && d.method === "GET") conditions.push(d.keywordMode === "contains" ? `the page contains “${d.keyword.trim()}”` : `the page doesn't contain “${d.keyword.trim()}”`);
  conditions.push(`the answer arrives within ${plural(d.timeoutSec, "second", "seconds")}`);
  lines.push(`A check passes when ${conditions.slice(0, -1).join(", ")}${conditions.length > 1 ? " and " : ""}${conditions[conditions.length - 1]}.`);
  lines.push(`Answers slower than ${seconds(d.slowMs)} are marked slow. That shows on the dashboard but doesn't alert anyone.`);
  lines.push(
    d.confirmAfter === 1
      ? "The first failed check opens an incident and alerts your channels. The first good check closes it."
      : `${plural(d.confirmAfter, "failed check", "failed checks")} in a row open an incident and alert your channels, so one dropped request doesn't wake anyone. The first good check closes it.`,
  );
  return lines;
}
