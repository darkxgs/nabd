import { connection, type NextRequest } from "next/server";
import { tick } from "@/server/jobs";

export const maxDuration = 60;

/**
 * The scheduler's heartbeat. Anyone may call it: work is throttled to once a
 * minute in the database, so extra calls cost one indexed write. A request with
 * the CRON_SECRET bearer token skips the throttle.
 */
export async function GET(req: NextRequest) {
  await connection();
  const secret = process.env.CRON_SECRET;
  const force = !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
  try {
    const r = await tick({ force });
    return Response.json(r, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[tick]", e);
    return Response.json({ error: "tick_failed" }, { status: 500 });
  }
}
