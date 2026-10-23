import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { appUrl } from "@/lib/app-url";
import { getPublicStatus } from "@/server/public-status";

/** Machine-readable status, for showing a banner inside your own app. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/s/[slug]/status.json">) {
  await connection();
  const { slug } = await ctx.params;
  const data = await getPublicStatus(slug);
  const headers = { "access-control-allow-origin": "*", "cache-control": "public, max-age=30" };
  if (!data) return Response.json({ error: "not_found" }, { status: 404, headers });
  const url = `${appUrl()}/s/${slug}`;
  return Response.json(
    {
      page: { title: data.page.title, title_ar: data.page.titleAr, url },
      status: data.overall,
      last_checked_at: data.lastChecked?.toISOString() ?? null,
      components: data.components.map((c) => ({ name: c.label, name_ar: c.labelAr, status: c.state, uptime_90d: c.uptime90 })),
      incidents: data.incidents.map((i) => ({
        title: i.component ? `${i.component.label} outage` : i.title,
        state: i.state,
        started_at: i.startedAt.toISOString(),
        resolved_at: i.resolvedAt?.toISOString() ?? null,
        latest_update: i.updates[0]?.body ?? null,
      })),
    },
    { headers },
  );
}
