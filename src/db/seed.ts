// The demo workspace: Seif's real live projects, watched by real checks, plus
// a test page on Nabd itself that fails on a schedule. History from before the
// demo was created is generated sample data, and the workspace records that
// cut-off (sample_before) so every screen can say which part is sample.
import bcrypt from "bcryptjs";
import { appUrl } from "../lib/app-url";
import { DEMO_TARGET_KEYWORD, DEMO_TARGET_SLOW_MS, demoOutagesBetween, demoTargetMode } from "../lib/demo-target";
import type { MigrationTarget } from "./migrate";
import { rawQuery } from "./raw";

export const DEMO = {
  userId: "usr_demo",
  email: "demo@nabd.app",
  password: "demo1234",
  workspaceId: "ws_demo",
  statusSlug: "seif",
};

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
  { id: "mon_mawid_book", name: "Mawid, booking page", url: () => "https://mawid-bay.vercel.app/b/noor-dental", baseMs: 340, label: "Mawid booking page", labelAr: "صفحة الحجز في موعد" },
  { id: "mon_salad", name: "Salad Store", url: () => "https://saladstore-eg.vercel.app", baseMs: 150, label: "Salad Store website", labelAr: "موقع سلاد ستور" },
  { id: "mon_neowave", name: "NeoWave", url: () => "https://neowave-site.vercel.app", baseMs: 230, label: "NeoWave website", labelAr: "موقع نيو ويف" },
  { id: "mon_bluesky", name: "Blue Sky Events (concept)", url: () => "https://blue-skye.vercel.app", baseMs: 180, label: "Blue Sky Events concept", labelAr: "تصور بلو سكاي" },
  {
    id: "mon_target",
    name: "Demo target (fails on a schedule)",
    url: () => `${appUrl()}/api/demo/target`,
    keyword: DEMO_TARGET_KEYWORD,
    baseMs: 120,
    confirmAfter: 1,
    label: "Booking API (demo target)",
    labelAr: "واجهة الحجز (هدف تجريبي)",
  },
];

const HOUR = 3_600_000;
const MIN = 60_000;

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
    "Asia/Dubai",
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
       VALUES ($1, $2, $3, $4, $5, $6, 300, 2000, 10000, $7, 'up', $8)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, url = excluded.url, keyword = excluded.keyword, method = 'GET',
         expected_status = '200-399', keyword_mode = 'contains', confirm_after = excluded.confirm_after, interval_sec = 300,
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
  await rawQuery(
    t,
    `INSERT INTO nabd.status_pages (id, workspace_id, slug, title, title_ar, intro, intro_ar, default_locale)
     VALUES ('sp_demo', $1, $2, $3, $4, $5, $6, 'en')`,
    [
      DEMO.workspaceId,
      DEMO.statusSlug,
      "Seif Ashraf, live projects",
      "مشاريع سيف أشرف",
      "Live status of the websites and products Seif Ashraf has built, checked every five minutes.",
      "الحالة المباشرة للمواقع والمنتجات التي بناها سيف أشرف، تُفحص كل خمس دقائق.",
    ],
  );
  await insertMany(
    t,
    "nabd.status_page_monitors",
    ["status_page_id", "monitor_id", "label", "label_ar", "position"],
    DEMO_MONITORS.map((m, i) => ["sp_demo", m.id, m.label, m.labelAr, i]),
  );
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
      for (let s = 0; s < 12; s++) {
        const at = new Date(h + s * 5 * MIN + 17_000);
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
  const windows = demoOutagesBetween(new Date(end.getTime() - 14 * 24 * HOUR), end);
  const incRows: unknown[][] = [];
  const updRows: unknown[][] = [];
  for (const [i, w] of windows.entries()) {
    const id = `inc_sample_${i}`;
    const detected = new Date(w.start.getTime() + 2 * MIN);
    const back = new Date(w.end.getTime() + 2 * MIN);
    incRows.push([id, DEMO.workspaceId, "mon_target", "Demo target (fails on a schedule) is down", "HTTP 503", "resolved", detected.toISOString(), back.toISOString()]);
    updRows.push(
      [`upd_sample_${i}_a`, id, "investigating", "Not responding as expected (HTTP 503). We're looking into it.", "لا يستجيب كما ينبغي (HTTP 503). نعمل على معرفة السبب.", true, detected.toISOString()],
      [`upd_sample_${i}_b`, id, "resolved", "Responding normally again. It was down for 20 min.", "عاد للعمل بشكل طبيعي بعد توقف دام 20 دقيقة.", true, back.toISOString()],
    );
  }
  if (incRows.length) {
    await insertMany(t, "nabd.incidents", ["id", "workspace_id", "monitor_id", "title", "cause", "state", "started_at", "resolved_at"], incRows);
    await insertMany(t, "nabd.incident_updates", ["id", "incident_id", "state", "body", "body_ar", "automatic", "created_at"], updRows);
  }
  // Current state follows the sample: everything up, the target per its schedule.
  for (const m of DEMO_MONITORS) {
    const last = latencyAt(m.baseMs, end, rng(7));
    await rawQuery(t, `UPDATE nabd.monitors SET last_checked_at = $2, last_latency_ms = $3, last_status = 200, state = 'up' WHERE id = $1`, [
      m.id,
      new Date(end.getTime() - 3 * MIN).toISOString(),
      last,
    ]);
  }
}
