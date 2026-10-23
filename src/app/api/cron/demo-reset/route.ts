import { connection, type NextRequest } from "next/server";
import { getConnection } from "@/db";
import { applyDemoConfig } from "@/db/seed";

/** Nightly: puts the shared demo workspace back the way it ships (visitors' monitors removed). */
export async function GET(req: NextRequest) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  const conn = await getConnection();
  await applyDemoConfig(conn.raw);
  return Response.json({ ok: true });
}
