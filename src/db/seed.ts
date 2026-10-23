// The demo workspace: Seif's real live projects, watched by real checks, plus
// a test page on Nabd itself that fails on a schedule. History from before the
// demo was created is generated sample data, and the workspace records that
// cut-off (sample_before) so every screen can say which part is sample.
import bcrypt from "bcryptjs";
import { appUrl } from "../lib/app-url";
import { DEMO } from "../lib/demo";
import { DEMO_TARGET_KEYWORD, DEMO_TARGET_SLOW_MS, demoOutagesBetween, demoTargetMode } from "../lib/demo-target";
import { causeAr, formatDuration, formatDurationAr } from "../lib/rules";
import type { MigrationTarget } from "./migrate";
import { rawQuery } from "./raw";

export { DEMO };

type SeedMonitor = {
  id: string;
  name: string;
  url: () => string;
  keyword?: string;
  baseMs: number;
  confirmAfter?: number;
  label: string;
  labelAr: string;
};

export const DEMO_MONITORS: SeedMonitor[] = [
  { id: "mon_portfolio", name: "seifashraf.dev", url: () => "https://www.seifashraf.dev", keyword: "Seif Ashraf", baseMs: 190, label: "Portfolio website", labelAr: "الموقع الشخصي" },
  { id: "mon_mawid", name: "Mawid, landing page", url: () => "https://mawid-bay.vercel.app", keyword: "Mawid", baseMs: 260, label: "Mawid website", labelAr: "موقع موعد" },
  { id: "mon_khatm", name: "Khatm", url: () => "https://khatm-invoices.vercel.app/en", keyword: "Khatm", baseMs: 210, label: "Khatm website", labelAr: "موقع ختم" },
  { id: "mon_sufra", name: "Sufra", url: () => "https://sufra-tables.vercel.app/en", keyword: "Sufra", baseMs: 240, label: "Sufra website", labelAr: "موقع سفرة" },
  { id: "mon_salad", name: "Salad Store", url: () => "https://saladstore-eg.vercel.app", baseMs: 150, label: "Salad Store website", labelAr: "موقع سلاد ستور" },
  { id: "mon_neowave", name: "NeoWave", url: () => "https://neowave-site.vercel.app", baseMs: 230, label: "NeoWave website", labelAr: "موقع نيو ويف" },
  { id: "mon_bluesky", name: "Blue Sky Events (concept)", url: () => "https://blue-skye.vercel.app", baseMs: 180, label: "Blue Sky Events concept", labelAr: "تصور بلو سكاي" },
  {
    id: "mon_target",
    name: "Demo target (fails on a schedule)",
    url: () => `${appUrl()}/api/demo/target`,
    keyword: DEMO_TARGET_KEYWORD,
    baseMs: 120,
    label: "Booking API",
    labelAr: "واجهة الحجز البرمجية",
  },
];

/**
 * Seif's page shows his real sites only; the demo page pairs the test service
 * with a real booking site. Every monitored page is static, so checking it
 * every fifteen minutes never wakes another app's database.
 */
const SEIF_PAGE = DEMO_MONITORS.filter((m) => m.id !== "mon_target").map((m) => [m.id, m.label, m.labelAr]);
const TARGET_PAGE = [
  ["mon_mawid", "Booking website", "موقع الحجز"],
  ["mon_target", "Booking API", "واجهة الحجز البرمجية"],
];

const HOUR = 3_600_000;
const MIN = 60_000;
/** The demo checks every fifteen minutes, the heartbeat's pace (see .github/workflows/heartbeat.yml). */
const DEMO_INTERVAL_SEC = 900;

async function one<T>(t: MigrationTarget, sql: string, params: unknown[] = []) {
  return (await rawQuery<T>(t, sql, params))[0];
}

async function insertMany(t: MigrationTarget, table: string, columns: string[], rows: unknown[][], conflict = "") {
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const params: unknown[] = [];
    const values = chunk.map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(",")})`);
    await rawQuery(t, `INSERT INTO ${table} (${columns.join(",")}) VALUES ${values.join(",")} ${conflict}`, params);
  }
}

/** Deterministic noise, so every seed produces the same-looking history. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function latencyAt(base: number, at: Date, r: () => number) {
  // Busier (slower) in the European and Gulf afternoon, plus a little noise.
  const h = at.getUTCHours() + at.getUTCMinutes() / 60;
  const wave = 1 + 0.18 * Math.sin(((h - 9) / 24) * Math.PI * 2);
  const spike = r() < 0.01 ? 2.4 : 1;
  return Math.round(base * wave * spike * (0.85 + r() * 0.3));
}

export async function seedDemo(t: MigrationTarget, now = new Date()) {
  const exists = await one<{ id: string }>(t, `SELECT id FROM nabd.workspaces WHERE id = $1`, [DEMO.workspaceId]);
  if (exists) return;
  const hash = await bcrypt.hash(DEMO.password, 10);
  await rawQuery(t, `INSERT INTO nabd.users (id, email, name, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [
    DEMO.userId,
    DEMO.email,
    "Demo",
    hash,
  ]);
  await rawQuery(t, `INSERT INTO nabd.workspaces (id, owner_id, name, timezone, sample_before) VALUES ($1, $2, $3, $4, $5)`, [
    DEMO.workspaceId,
    DEMO.userId,
    "Seif Ashraf, live projects",
    "UTC",
    now.toISOString(),
  ]);
  await applyDemoConfig(t, now);
  await seedSampleHistory(t, now);
}

/** Monitors, alert channels and the status page as the demo ships. Safe to run again: it resets them. */
export async function applyDemoConfig(t: MigrationTarget, now = new Date()) {
  const ids = DEMO_MONITORS.map((m) => m.id);
  // Remove monitors visitors added; keep the seeded ones (and their history).
  await rawQuery(t, `DELETE FROM nabd.monitors WHERE workspace_id = $1 AND NOT (id = ANY($2::text[]))`, [DEMO.workspaceId, ids]);
  for (const [i, m] of DEMO_MONITORS.entries()) {
    await rawQuery(
      t,
      `INSERT INTO nabd.monitors (id, workspace_id, name, url, keyword, confirm_after, interval_sec, slow_ms, timeout_ms, position, state, next_check_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${DEMO_INTERVAL_SEC}, 2000, 10000, $7, 'up', $8)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, url = excluded.url, keyword = excluded.keyword, method = 'GET',
         expected_status = '200-399', keyword_mode = 'contains', confirm_after = excluded.confirm_after, interval_sec = ${DEMO_INTERVAL_SEC},
         slow_ms = 2000, timeout_ms = 10000, position = excluded.position, paused = false`,
      [m.id, DEMO.workspaceId, m.name, m.url(), m.keyword ?? null, m.confirmAfter ?? 2, i, now.toISOString()],
    );
  }
  await rawQuery(t, `DELETE FROM nabd.channels WHERE workspace_id = $1`, [DEMO.workspaceId]);
  await insertMany(
    t,
    "nabd.channels",
    ["id", "workspace_id", "kind", "name", "target", "secret"],
    [
      ["ch_demo_email", DEMO.workspaceId, "email", "On-call email", "demo:oncall@example.com", "whsec_demo_email"],
      ["ch_demo_slack", DEMO.workspaceId, "slack", "#incidents on Slack", "demo:https://hooks.slack.com/services/T000/B000/demo", "whsec_demo_slack"],
    ],
  );
  await rawQuery(t, `DELETE FROM nabd.status_pages WHERE workspace_id = $1`, [DEMO.workspaceId]);
  await insertMany(
    t,
    "nabd.status_pages",
    ["id", "workspace_id", "slug", "title", "title_ar", "intro", "intro_ar", "default_locale"],
    [
      [
        DEMO.statusPageId,
        DEMO.workspaceId,
        DEMO.statusSlug,
        "Seif Ashraf, live projects",
        "مشاريع سيف أشرف",
        "Live status of the websites and products Seif Ashraf has built, checked every fifteen minutes.",
        "الحالة المباشرة للمواقع والمنتجات التي بناها سيف أشرف، تُفحص كل ربع ساعة.",
        "en",
      ],
      [
        DEMO.targetPageId,
        DEMO.workspaceId,
        DEMO.targetSlug,
        "Demo booking service",
        "خدمة الحجز التجريبية",
        "Part of the Nabd demo. The booking API here is a test service that fails on purpose at 01:20 and 13:20 UTC, so you can see how an outage reads on a status page.",
        "جزء من العرض التجريبي لنبض. واجهة الحجز هنا خدمة اختبار تتوقف عمدًا الساعة 01:20 و13:20 بتوقيت UTC، لترى كيف يظهر الانقطاع على صفحة الحالة.",
        "en",
      ],
    ],
  );
  await insertMany(t, "nabd.status_page_monitors", ["status_page_id", "monitor_id", "label", "label_ar", "position"], [
    ...SEIF_PAGE.map(([id, label, labelAr], i) => [DEMO.statusPageId, id, label, labelAr, i]),
    ...TARGET_PAGE.map(([id, label, labelAr], i) => [DEMO.targetPageId, id, label, labelAr, i]),
  ]);
}

async function seedSampleHistory(t: MigrationTarget, now: Date) {
  const end = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  const start = new Date(end.getTime() - 90 * 24 * HOUR);
  const rawFrom = new Date(end.getTime() - 48 * HOUR);
  for (const [mi, m] of DEMO_MONITORS.entries()) {
    const r = rng(1000 + mi);
    const isTarget = m.id === "mon_target";
    const hours: unknown[][] = [];
    const raws: unknown[][] = [];
    for (let h = start.getTime(); h < end.getTime(); h += HOUR) {
      let total = 0;
      let failures = 0;
      let sum = 0;
      let n = 0;
      let max = 0;
      // Four checks an hour, at :05:17, :20:17, :35:17 and :50:17.
      for (let s = 0; s < HOUR / (DEMO_INTERVAL_SEC * 1000); s++) {
        const at = new Date(h + 5 * MIN + s * DEMO_INTERVAL_SEC * 1000 + 17_000);
        const mode = isTarget ? demoTargetMode(at) : "ok";
        const ok = mode !== "down";
        const latency = ok ? (mode === "slow" ? DEMO_TARGET_SLOW_MS + Math.round(r() * 120) : latencyAt(m.baseMs, at, r)) : null;
        total++;
        if (!ok) failures++;
        if (latency != null) {
          sum += latency;
          n++;
          max = Math.max(max, latency);
        }
        if (at >= rawFrom) {
          raws.push([m.id, at.toISOString(), ok, ok ? 200 : 503, latency, ok ? null : "HTTP 503"]);
        }
      }
      hours.push([m.id, new Date(h).toISOString(), total, failures, sum, n, max]);
    }
    await insertMany(t, "nabd.check_hours", ["monitor_id", "hour", "total", "failures", "latency_sum", "latency_n", "latency_max"], hours, "ON CONFLICT DO NOTHING");
    await insertMany(t, "nabd.checks", ["monitor_id", "checked_at", "ok", "status_code", "latency_ms", "error"], raws);
  }

  // Sample incidents for the demo target's last two weeks of scheduled outages.
  // Checks land at 13:20:17 (the first failure), 13:35:17 (the second, which
  // confirms it) and 13:50:17, and the first pass is at 14:05:17.
  const windows = demoOutagesBetween(new Date(end.getTime() - 14 * 24 * HOUR), end);
  const incRows: unknown[][] = [];
  const updRows: unknown[][] = [];
  for (const [i, w] of windows.entries()) {
    const id = `inc_sample_${i}`;
    const first = new Date(w.start.getTime() + 17_000);
    const confirmed = new Date(first.getTime() + DEMO_INTERVAL_SEC * 1000);
    const back = new Date(w.end.getTime() + 17_000);
    const took = back.getTime() - first.getTime();
    incRows.push([id, DEMO.workspaceId, "mon_target", "Demo target (fails on a schedule) is down", "HTTP 503", "resolved", first.toISOString(), back.toISOString(), confirmed.toISOString()]);
    updRows.push(
      [`upd_sample_${i}_a`, id, "investigating", "Not responding as expected (HTTP 503). We're looking into it.", `لا يستجيب كما ينبغي (${causeAr("HTTP 503")}). نعمل على معرفة السبب.`, true, confirmed.toISOString()],
      [`upd_sample_${i}_b`, id, "resolved", `Responding normally again. It was down for ${formatDuration(took)}.`, `عاد للعمل بشكل طبيعي بعد توقف دام ${formatDurationAr(took)}.`, true, back.toISOString()],
    );
  }
  if (incRows.length) {
    await insertMany(t, "nabd.incidents", ["id", "workspace_id", "monitor_id", "title", "cause", "state", "started_at", "resolved_at", "acknowledged_at"], incRows);
    await insertMany(t, "nabd.incident_updates", ["id", "incident_id", "state", "body", "body_ar", "automatic", "created_at"], updRows);
  }
  // Current state follows the sample: everything up, the target since its last outage ended.
  const lastBack = windows.length ? new Date(windows[windows.length - 1].end.getTime() + 17_000) : start;
  for (const m of DEMO_MONITORS) {
    const last = latencyAt(m.baseMs, end, rng(7));
    await rawQuery(t, `UPDATE nabd.monitors SET last_checked_at = $2, last_latency_ms = $3, last_status = 200, state = 'up', state_since = $4 WHERE id = $1`, [
      m.id,
      new Date(end.getTime() - 3 * MIN).toISOString(),
      last,
      (m.id === "mon_target" ? lastBack : start).toISOString(),
    ]);
  }
}
