// SQL migrations, applied in order and tracked in nabd._migrations.
// Everything lives in its own Postgres schema ("nabd"), so the app can share a
// database with other projects without any table names colliding.
export const migrations: { name: string; sql: string }[] = [
  {
    name: "0001_init",
    sql: /* sql */ `
CREATE TABLE nabd.users (
  id            text PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nabd.workspaces (
  id            text PRIMARY KEY,
  owner_id      text NOT NULL REFERENCES nabd.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  timezone      text NOT NULL DEFAULT 'UTC',
  -- Data before this moment is generated sample history (the demo only).
  sample_before timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nabd.monitors (
  id              text PRIMARY KEY,
  workspace_id    text NOT NULL REFERENCES nabd.workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  url             text NOT NULL,
  method          text NOT NULL DEFAULT 'GET' CHECK (method IN ('GET', 'HEAD')),
  expected_status text NOT NULL DEFAULT '200-399',
  keyword         text,
  keyword_mode    text NOT NULL DEFAULT 'contains' CHECK (keyword_mode IN ('contains', 'absent')),
  timeout_ms      integer NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 30000),
  interval_sec    integer NOT NULL DEFAULT 300 CHECK (interval_sec IN (300, 600, 900, 1800, 3600)),
  slow_ms         integer NOT NULL DEFAULT 2000 CHECK (slow_ms BETWEEN 100 AND 30000),
  confirm_after   integer NOT NULL DEFAULT 2 CHECK (confirm_after BETWEEN 1 AND 5),
  paused          boolean NOT NULL DEFAULT false,
  state           text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'up', 'degraded', 'down')),
  state_since     timestamptz NOT NULL DEFAULT now(),
  fail_streak     integer NOT NULL DEFAULT 0,
  last_checked_at timestamptz,
  last_latency_ms integer,
  last_status     integer,
  last_error      text,
  next_check_at   timestamptz NOT NULL DEFAULT now(),
  ssl_expires_at  timestamptz,
  ssl_issuer      text,
  ssl_checked_at  timestamptz,
  ssl_alerted_at  timestamptz,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX monitors_due ON nabd.monitors (next_check_at) WHERE NOT paused;
CREATE INDEX monitors_ws ON nabd.monitors (workspace_id, position);

-- Every check, kept for 48 hours.
CREATE TABLE nabd.checks (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  monitor_id  text NOT NULL REFERENCES nabd.monitors(id) ON DELETE CASCADE,
  checked_at  timestamptz NOT NULL,
  ok          boolean NOT NULL,
  status_code integer,
  latency_ms  integer,
  error       text
);
CREATE INDEX checks_monitor_time ON nabd.checks (monitor_id, checked_at DESC);
CREATE INDEX checks_time ON nabd.checks (checked_at);

-- One row per monitor per hour, updated as checks arrive; kept for 90 days.
CREATE TABLE nabd.check_hours (
  monitor_id  text NOT NULL REFERENCES nabd.monitors(id) ON DELETE CASCADE,
  hour        timestamptz NOT NULL,
  total       integer NOT NULL DEFAULT 0,
  failures    integer NOT NULL DEFAULT 0,
  latency_sum bigint NOT NULL DEFAULT 0,
  latency_n   integer NOT NULL DEFAULT 0,
  latency_max integer NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor_id, hour)
);

CREATE TABLE nabd.incidents (
  id              text PRIMARY KEY,
  workspace_id    text NOT NULL REFERENCES nabd.workspaces(id) ON DELETE CASCADE,
  -- NULL for incidents posted by hand, which show on every status page of the workspace.
  monitor_id      text REFERENCES nabd.monitors(id) ON DELETE CASCADE,
  title           text NOT NULL,
  title_ar        text,
  cause           text,
  state           text NOT NULL DEFAULT 'investigating'
                  CHECK (state IN ('investigating', 'identified', 'monitoring', 'resolved')),
  started_at      timestamptz NOT NULL,
  resolved_at     timestamptz,
  acknowledged_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- A monitor can have at most one open incident, even if two checkers race.
CREATE UNIQUE INDEX incidents_one_open ON nabd.incidents (monitor_id) WHERE resolved_at IS NULL;
CREATE INDEX incidents_ws_time ON nabd.incidents (workspace_id, started_at DESC);

CREATE TABLE nabd.incident_updates (
  id          text PRIMARY KEY,
  incident_id text NOT NULL REFERENCES nabd.incidents(id) ON DELETE CASCADE,
  state       text NOT NULL CHECK (state IN ('investigating', 'identified', 'monitoring', 'resolved')),
  body        text NOT NULL,
  body_ar     text,
  automatic   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incident_updates_incident ON nabd.incident_updates (incident_id, created_at);

CREATE TABLE nabd.status_pages (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL REFERENCES nabd.workspaces(id) ON DELETE CASCADE,
  slug           text NOT NULL UNIQUE,
  title          text NOT NULL,
  title_ar       text,
  intro          text,
  intro_ar       text,
  default_locale text NOT NULL DEFAULT 'en' CHECK (default_locale IN ('en', 'ar')),
  published      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nabd.status_page_monitors (
  status_page_id text NOT NULL REFERENCES nabd.status_pages(id) ON DELETE CASCADE,
  monitor_id     text NOT NULL REFERENCES nabd.monitors(id) ON DELETE CASCADE,
  label          text,
  label_ar       text,
  position       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (status_page_id, monitor_id)
);

CREATE TABLE nabd.channels (
  id           text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES nabd.workspaces(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('email', 'slack', 'discord', 'webhook')),
  name         text NOT NULL,
  target       text NOT NULL,
  -- Signs webhook bodies (X-Nabd-Signature) so receivers can verify them.
  secret       text NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The alert outbox: one row per event per channel, delivered by the ticker.
CREATE TABLE nabd.alerts (
  id           text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES nabd.workspaces(id) ON DELETE CASCADE,
  channel_id   text REFERENCES nabd.channels(id) ON DELETE SET NULL,
  monitor_id   text REFERENCES nabd.monitors(id) ON DELETE SET NULL,
  incident_id  text REFERENCES nabd.incidents(id) ON DELETE CASCADE,
  event        text NOT NULL CHECK (event IN ('down', 'up', 'ssl', 'test')),
  dedupe_key   text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'simulated')),
  subject      text NOT NULL,
  body         text NOT NULL,
  error        text,
  attempts     integer NOT NULL DEFAULT 0,
  claimed_at   timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- The same event never reaches the same channel twice.
CREATE UNIQUE INDEX alerts_dedupe ON nabd.alerts (channel_id, dedupe_key);
CREATE INDEX alerts_pending ON nabd.alerts (created_at) WHERE status = 'pending';
CREATE INDEX alerts_ws_time ON nabd.alerts (workspace_id, created_at DESC);

-- Throttles for background work ("run at most once every N minutes").
CREATE TABLE nabd.app_jobs (
  key    text PRIMARY KEY,
  ran_at timestamptz NOT NULL
);
`,
  },
];
