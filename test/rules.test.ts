import { describe, expect, it } from "vitest";
import { demoOutagesBetween, demoTargetMode } from "@/lib/demo-target";
import { causeAr, formatDuration, formatDurationAr, formatMs, formatPct, isValidStatusSpec, nextState, statusMatches, uptimePct } from "@/lib/rules";
import { describeMonitor, describeStatus, MONITOR_DEFAULTS, normalizeUrl, parseMonitorForm } from "@/lib/monitor-input";
import { isPublicAddress } from "@/server/net-guard";

describe("expected status codes", () => {
  it("reads ranges, lists and classes", () => {
    expect(statusMatches("200-399", 301)).toBe(true);
    expect(statusMatches("200-399", 404)).toBe(false);
    expect(statusMatches("2xx", 204)).toBe(true);
    expect(statusMatches("200, 401", 401)).toBe(true);
    expect(statusMatches("", 200)).toBe(true);
    expect(isValidStatusSpec("2xx, 301-302")).toBe(true);
    expect(isValidStatusSpec("ok")).toBe(false);
  });
});

describe("the state machine", () => {
  const base = { state: "up" as const, failStreak: 0, confirmAfter: 2, slowMs: 2000 };
  const ok = (ms = 200) => ({ ok: true, statusCode: 200, latencyMs: ms, error: null });
  const fail = { ok: false, statusCode: 503, latencyMs: 90, error: "HTTP 503" };

  it("needs two failures in a row before calling it down", () => {
    const one = nextState(base, fail);
    expect(one).toEqual({ state: "up", failStreak: 1, event: null });
    const two = nextState({ ...base, failStreak: 1 }, fail);
    expect(two).toEqual({ state: "down", failStreak: 2, event: "down" });
    expect(nextState({ ...base, state: "down", failStreak: 2 }, fail).event).toBeNull();
  });

  it("recovers on the first good check, and slow answers are degraded", () => {
    expect(nextState({ ...base, state: "down", failStreak: 3 }, ok())).toEqual({ state: "up", failStreak: 0, event: "up" });
    expect(nextState(base, ok(2400))).toEqual({ state: "degraded", failStreak: 0, event: null });
  });

  it("can alert on the first failure when asked to", () => {
    expect(nextState({ ...base, confirmAfter: 1 }, fail).event).toBe("down");
  });
});

describe("numbers people read", () => {
  it("never rounds a blip up to 100%", () => {
    expect(uptimePct(100_000, 1)).toBe(99.99);
    expect(uptimePct(288, 0)).toBe(100);
    expect(uptimePct(0, 0)).toBeNull();
    expect(formatPct(99.5)).toBe("99.50%");
  });

  it("says how long something lasted, in English and Arabic", () => {
    expect(formatDuration(20 * 60_000)).toBe("20 min");
    expect(formatDuration(72 * 60_000)).toBe("1 h 12 min");
    expect(formatDurationAr(20 * 60_000)).toBe("20 دقيقة");
    expect(formatDurationAr(2 * 60_000)).toBe("دقيقتين");
    expect(formatDurationAr(60 * 60_000)).toBe("ساعة");
  });
});

describe("the network guard", () => {
  it("refuses private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("allows the public internet", () => {
    for (const ip of ["8.8.8.8", "76.76.21.21", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe("the demo target", () => {
  it("goes down twice a day for 45 minutes", () => {
    expect(demoTargetMode(new Date("2026-11-02T01:25:00Z"))).toBe("down");
    expect(demoTargetMode(new Date("2026-11-02T02:04:00Z"))).toBe("down");
    expect(demoTargetMode(new Date("2026-11-02T02:05:00Z"))).toBe("ok");
    expect(demoTargetMode(new Date("2026-11-02T14:04:59Z"))).toBe("down");
    expect(demoTargetMode(new Date("2026-11-02T14:05:00Z"))).toBe("ok");
    expect(demoTargetMode(new Date("2026-11-02T13:19:00Z"))).toBe("ok");
    expect(demoTargetMode(new Date("2026-11-02T03:50:00Z"))).toBe("slow");
    const w = demoOutagesBetween(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-03T00:00:00Z"));
    expect(w.map((x) => x.start.toISOString())).toEqual([
      "2026-11-01T01:20:00.000Z",
      "2026-11-01T13:20:00.000Z",
      "2026-11-02T01:20:00.000Z",
      "2026-11-02T13:20:00.000Z",
    ]);
  });
});

describe("formatting", () => {
  it("prints response times the way people read them", () => {
    expect(formatMs(184)).toBe("184 ms");
    expect(formatMs(2000)).toBe("2 s");
    expect(formatMs(2600)).toBe("2.6 s");
    expect(formatMs(1234)).toBe("1.23 s");
    expect(formatMs(null)).toBe("–");
  });

  it("translates probe causes for Arabic status pages", () => {
    expect(causeAr("HTTP 503")).toBe("رمز الاستجابة HTTP 503");
    expect(causeAr("Timed out after 10 s")).toBe("انتهت المهلة بعد 10 ثوانٍ");
    expect(causeAr("Timed out after 30 s")).toBe("انتهت المهلة بعد 30 ثانية");
    expect(causeAr("Connection refused")).toBe("رفض الخادم الاتصال");
    expect(causeAr("Something new")).toBe("Something new");
  });
});

describe("the monitor form", () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ url: "example.com", intervalSec: "300", method: "GET", expectedStatus: "200-399", keyword: "", keywordMode: "contains", timeoutSec: "10", slowMs: "2000", confirmAfter: "2", ...o })) f.set(k, v);
    return f;
  };

  it("adds https:// and refuses things that aren't web addresses", () => {
    expect(normalizeUrl("example.com/shop")).toBe("https://example.com/shop");
    expect(normalizeUrl("http://example.com")).toBe("http://example.com/");
    expect(normalizeUrl("ftp://example.com")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("intranet")).toBeNull();
  });

  it("explains each problem next to its field", () => {
    expect(parseMonitorForm(form({}))).toMatchObject({ ok: true, value: { url: "https://example.com/", timeoutSec: 10 } });
    expect(parseMonitorForm(form({ url: "https://user:pw@example.com" }))).toMatchObject({ ok: false, fields: { url: "Remove the username and password from the address." } });
    expect(parseMonitorForm(form({ method: "HEAD", keyword: "Add to cart" }))).toMatchObject({ ok: false, fields: { keyword: expect.stringContaining("need GET") } });
    expect(parseMonitorForm(form({ slowMs: "12000" }))).toMatchObject({ ok: false, fields: { slowMs: "Set this below the timeout." } });
    expect(parseMonitorForm(form({ expectedStatus: "ok" }))).toMatchObject({ ok: false, fields: { expectedStatus: expect.any(String) } });
    expect(parseMonitorForm(form({ intervalSec: "60" }))).toMatchObject({ ok: false, fields: { intervalSec: "Pick how often to check." } });
  });

  it("says in plain words what will happen", () => {
    expect(describeStatus("200-399")).toBe("between 200 and 399");
    expect(describeStatus("2xx,301")).toBe("any 2xx or 301");
    const lines = describeMonitor({ ...MONITOR_DEFAULTS, url: "shop.example.com", keyword: "Add to cart" });
    expect(lines[0]).toBe("Every 5 minutes, Nabd sends a GET request to shop.example.com.");
    expect(lines[1]).toContain("the page contains “Add to cart”");
    expect(lines[3]).toMatch(/^2 failed checks in a row open an incident/);
  });
});
