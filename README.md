# Nabd (نبض)

Uptime monitoring for small teams: Nabd checks your websites and APIs from the internet every few minutes, opens an incident when one stops answering, alerts Slack, Discord, email or your own webhook, and keeps a public status page your customers can read in English or Arabic.

*Nabd* is Arabic for pulse.

**Live demo:** open the demo workspace from the home page, no sign-up needed. It watches the sites I've built (my portfolio, Mawid, Khatm, Sufra, Salad Store, NeoWave) every fifteen minutes, plus a test service that fails on purpose for 45 minutes from 01:20 and 13:20 UTC, so there is always an incident to look at.

## What it does

**Monitors**
- HTTP checks every 5, 10, 15, 30 or 60 minutes, with GET or HEAD, expected status codes written the way people say them (`200-399`, `2xx`, `200,301`), and an optional keyword that must (or must not) be on the page.
- A beat strip per monitor: one tick per check, height on a log scale of response time, colour by result. Hover any tick for the time and answer.
- Response-time chart (every check for 24 hours, hourly averages for 7 and 30 days) you can point at to read exact values, median and 95th percentile, 90 days of daily uptime, and the raw check log.
- TLS certificate expiry, read twice a day, with a warning 14 days ahead.
- "Test this address" runs a real check from the form before you save, and a plain-language summary beside the form says exactly what Nabd will do.

**Incidents**
- A monitor goes down only after 1 to 5 failed checks in a row (your choice), so one dropped request doesn't page anyone. The first good check resolves it.
- Slow answers are marked slow on the dashboard and status page, without alerting.
- Every incident has a timeline that merges the first failed check, updates (automatic and written), and each alert with its delivery result. Acknowledge it, post updates as investigating, identified, monitoring or resolved, in English and optionally Arabic.
- Incidents can also be posted by hand, for maintenance or problems no check can see.

**Alerts**
- Email (Resend), Slack, Discord and signed webhooks, each with a test button and a delivery log.
- Webhooks carry `x-nabd-signature: sha256=<HMAC of the raw body>` keyed with a per-channel secret.

**Status pages**
- Pick monitors, name them for customers in English and Arabic, choose the default language. Visitors switch languages with one tap; Arabic is fully right to left.
- Current state, 90 days of uptime per component (30 on phones), ongoing incidents with every update, and past incidents you can expand.
- Also served as JSON (`/s/<slug>/status.json`, CORS enabled) and as a README badge (`/s/<slug>/badge.svg`).

## How it's built

| | |
|---|---|
| App | Next.js 16 (App Router, Cache Components, Server Actions), React 19, TypeScript |
| Data | Postgres with Drizzle ORM and hand-written SQL for the hot paths; PGlite (Postgres in WASM) locally and in tests |
| Checks | undici with a guarded DNS lookup, manual redirects, streamed keyword search |
| UI | Tailwind CSS 4, IBM Plex Sans, Plex Sans Condensed for figures, Plex Sans Arabic. No component library, no chart library |
| Scheduling | GitHub Actions every 15 minutes, page views, and a daily Vercel cron, all throttled through one database row |
| Hosting | Vercel and Neon, both on free plans |

### Decisions worth reading

**One scheduler row, many triggers.** Free hosting has no always-on worker, so several things ask Nabd to run: a GitHub Actions workflow every fifteen minutes, page views (through `after()`, so the page never waits), and a daily Vercel cron. `/api/tick` claims a row in `app_jobs` with `INSERT … ON CONFLICT … WHERE ran_at < now() - 55 s RETURNING`, so however many triggers arrive at once, the work runs once a minute at most.

**Fifteen minutes is a budget, not a limit.** Monitors can be checked every five minutes, and the code would keep up, but the hosted demo's database is on Neon's free plan: 100 compute-hours a month, asleep after five idle minutes. A heartbeat every five minutes would keep it awake around the clock, about 180 hours, so the workflow runs every fifteen and the database sleeps two thirds of the time. For the same reason the demo only watches static pages, which never wake another app's database. On an always-on database, set the workflow to `*/5`.

**Two runners never check the same monitor.** Due monitors are claimed and pushed to their next slot in a single statement:

```sql
UPDATE nabd.monitors m SET next_check_at = $1 + make_interval(secs => m.interval_sec)
WHERE m.id IN (SELECT id FROM nabd.monitors
               WHERE NOT paused AND next_check_at <= $1
               ORDER BY next_check_at LIMIT $2 FOR UPDATE SKIP LOCKED)
RETURNING m.*;
```

**At most one open incident per monitor, enforced by Postgres.** A partial unique index (`ON incidents (monitor_id) WHERE resolved_at IS NULL`) plus `INSERT … ON CONFLICT DO NOTHING` means a race between two runners opens one incident and sends one set of alerts.

**Alerts go through an outbox.** Detecting an outage only writes alert rows (one per channel, de-duplicated by a unique index on the channel and an event key such as `down:<incident>`). Delivery claims rows with `FOR UPDATE SKIP LOCKED`, retries failures twice five minutes apart, and records the result, so a slow Slack never delays a check and a crash never loses an alert.

**A monitor can't be turned against the server.** Every address, including each redirect hop, is resolved through a guarded lookup that refuses loopback, private, link-local, CGNAT and cloud-metadata ranges for IPv4 and IPv6 (including IPv4-mapped IPv6). The same guard covers outgoing webhooks.

**Storage stays small.** Each check also updates an hourly rollup (`check_hours`: count, failures, latency sum and max). Raw checks are kept for 48 hours, rollups for 90 days, so charts and uptime figures over long ranges read a few hundred rows.

**Status pages are cached for 30 seconds and expire on edits.** Outages are exactly when everyone refreshes the status page, so its data comes from a `"use cache"` function shared by all visitors, tagged by workspace; posting an update calls `updateTag()` so it appears at once.

**The demo is honest about what's real.** The demo's monitors check real sites. History from before the demo was created is generated, recorded as such (`sample_before`), and drawn faded everywhere it appears. Visitors share the workspace, so its seeded monitors, status pages and channels are read-only, posting is off (updates would appear on a public page), visitors can add up to five monitors of their own, and a nightly cron puts everything back.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000, creates an embedded Postgres in .data/
npm test             # engine, incidents, alert delivery and the demo seed, on PGlite
npm run tick         # run due checks once from the command line
```

Open the demo workspace from `/login`, or create an account. Locally, Nabd may check `localhost` (the demo target lives there); in production private addresses are refused.

## Deploy

1. Import the repository into Vercel.
2. Connect Postgres (Neon works on the free plan). Nabd keeps its tables in its own `nabd` schema, so it can share a database with another app. Migrations run during the build.
3. Optionally set `CRON_SECRET` (a long random string) so only Vercel Cron can reset the demo, and `RESEND_API_KEY` and `EMAIL_FROM` for email alerts. No secret is required: without `AUTH_SECRET`, Nabd makes a random signing key on first use and keeps it in the database.
4. In the GitHub repository, add a variable `NABD_URL` with the deployment's address so the heartbeat workflow can reach it. (GitHub pauses scheduled workflows after 60 days without commits; re-enable it from the Actions tab.)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Postgres; the direct URL is used for migrations |
| `AUTH_SECRET` | Signs session cookies. Without it, a random key kept in the database does |
| `CRON_SECRET` | Sent by Vercel Cron. Protects the demo reset; a request with it skips the tick throttle |
| `NABD_PUBLIC_URL` | Public address for links in alerts (Vercel's is used by default) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email alerts. Without them, email alerts are recorded as simulated |
| `NABD_SEED_DEMO` | `0` skips the demo workspace |

## Project layout

```
src/
  app/                 routes: landing, auth, /app dashboard, /s/[slug] status pages, /api
  components/          beat strip, latency chart, UI kit
  db/                  migrations (SQL), Drizzle schema, demo seed
  lib/                 pure logic: state machine, status-code rules, form parsing, dates
  server/              probe, network guard, engine, alerts outbox, jobs, queries
test/                  Vitest suites against a real HTTP server and PGlite
```

Built by [Seif Ashraf](https://www.seifashraf.dev).
