import type { NextRequest } from "next/server";
import { connection } from "next/server";
import type { Overall } from "@/server/queries";
import { getPublicStatus } from "@/server/public-status";

const TEXT: Record<Overall, string> = { operational: "operational", degraded: "degraded", partial: "partial outage", major: "major outage" };
const FILL: Record<Overall, string> = { operational: "#13834f", degraded: "#b2741a", partial: "#d6391f", major: "#d6391f" };

// Close enough to Verdana 11px widths for a badge, without loading a font.
const width = (s: string) => Math.round([...s].reduce((w, ch) => w + (/[mw]/.test(ch) ? 9 : /[ilj.]/.test(ch) ? 3.5 : ch === " " ? 3.6 : 6.6), 0)) + 12;

/** A README badge in the shields.io style: "status | operational". */
export async function GET(_req: NextRequest, ctx: RouteContext<"/s/[slug]/badge.svg">) {
  await connection();
  const { slug } = await ctx.params;
  const data = await getPublicStatus(slug);
  const label = "status";
  const value = data ? TEXT[data.overall] : "unknown";
  const fill = data ? FILL[data.overall] : "#98a0ab";
  const lw = width(label);
  const vw = width(value);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${label}: ${value}">
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${lw + vw}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#14181e"/><rect x="${lw}" width="${vw}" height="20" fill="${fill}"/><rect width="${lw + vw}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14">${label}</text><text x="${lw + vw / 2}" y="14">${value}</text></g></svg>`;
  return new Response(svg, {
    status: data ? 200 : 404,
    headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=60, s-maxage=60" },
  });
}
