// The shared demo workspace. Anyone can open it, so the parts that other
// visitors (or the public status page) would see are read-only there.
export const DEMO = {
  userId: "usr_demo",
  email: "demo@nabd.app",
  password: "demo1234",
  workspaceId: "ws_demo",
  /** Seif's live projects. Linked from his portfolio, so it only shows real sites. */
  statusPageId: "sp_demo",
  statusSlug: "seif",
  /** A second page built around the test service, to show how outages read. */
  targetPageId: "sp_demo_target",
  targetSlug: "demo",
};

/** The monitors the demo ships with (kept in step with seed.ts by a test). */
export const SEEDED_MONITOR_IDS = ["mon_portfolio", "mon_mawid", "mon_mawid_book", "mon_salad", "mon_neowave", "mon_bluesky", "mon_target"] as const;

export const isDemoWorkspace = (workspaceId: string) => workspaceId === DEMO.workspaceId;
export const isSeededMonitor = (monitorId: string) => (SEEDED_MONITOR_IDS as readonly string[]).includes(monitorId);

/** Visitors can add a few monitors of their own to the demo; they're removed in the nightly reset. */
export const DEMO_VISITOR_MONITORS = 5;
export const MAX_MONITORS = 25;

/** Slugs nobody can claim for a status page. */
export const RESERVED_SLUGS = new Set(["seif", "demo", "admin", "api", "app", "status", "nabd", "login", "signup", "www", "help", "support"]);
