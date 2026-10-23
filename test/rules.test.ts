import { describe, expect, it } from "vitest";
import { demoOutagesBetween, demoTargetMode } from "@/lib/demo-target";
import { formatDuration, formatDurationAr, formatPct, isValidStatusSpec, nextState, statusMatches, uptimePct } from "@/lib/rules";
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
  it("goes down twice a day for 20 minutes", () => {
    expect(demoTargetMode(new Date("2026-11-02T01:25:00Z"))).toBe("down");
    expect(demoTargetMode(new Date("2026-11-02T13:39:00Z"))).toBe("down");
    expect(demoTargetMode(new Date("2026-11-02T13:40:00Z"))).toBe("ok");
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
