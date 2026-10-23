import { connection } from "next/server";
import { DEMO_TARGET_KEYWORD, DEMO_TARGET_SLOW_MS, demoTargetMode } from "@/lib/demo-target";

/**
 * A page that misbehaves on a timetable, so the demo always has something to
 * show: down for 45 minutes from 01:20 and 13:20 UTC, slow for 10 minutes every
 * three hours, healthy otherwise.
 */
export async function GET() {
  await connection();
  const mode = demoTargetMode(new Date());
  if (mode === "down") {
    return new Response("Service unavailable (scheduled demo outage)", { status: 503, headers: { "cache-control": "no-store", "retry-after": "600" } });
  }
  if (mode === "slow") await new Promise((r) => setTimeout(r, DEMO_TARGET_SLOW_MS));
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Demo booking API</title><body><p>${DEMO_TARGET_KEYWORD}.</p><p>This page belongs to the Nabd demo. It fails on purpose at 01:20 and 13:20 UTC.</p></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
