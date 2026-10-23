import { connection, type NextRequest } from "next/server";
import { getConnection } from "@/db";
import { applyDemoConfig } from "@/db/seed";
import { claim } from "@/server/jobs";

/**
 * Nightly: puts the shared demo workspace back the way it ships (visitors'
 * monitors removed). With CRON_SECRET set, only a request carrying it (Vercel
 * Cron sends it) resets the demo. Without one, anyone may call this, and the
 * reset runs at most once every 20 hours.
 */
export async function GET(req: NextRequest) {
  await connection();
  const conn = await getConnection();
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  } else if (!(await claim(conn, "demo-reset", 20 * 3600))) {
    return Response.json({ ok: true, ran: false });
  }
  await applyDemoConfig(conn.raw);
  return Response.json({ ok: true, ran: true });
}
