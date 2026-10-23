import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { buttonClass, cn, Empty, PageTitle, Panel } from "@/components/ui";
import { appUrl } from "@/lib/app-url";
import { isDemoWorkspace } from "@/lib/demo";
import { requireWorkspace } from "@/server/auth";
import { listStatusPages } from "@/server/queries";

export const metadata: Metadata = { title: "Status pages" };

export default function StatusPagesPage() {
  return (
    <Suspense fallback={<div className="h-[50vh] animate-pulse rounded-panel bg-rule-2" />}>
      <StatusPages />
    </Suspense>
  );
}

async function StatusPages() {
  await connection();
  const { conn, workspace } = await requireWorkspace();
  const pages = await listStatusPages(conn, workspace.id);
  const host = appUrl().replace(/^https?:\/\//, "");
  const demo = isDemoWorkspace(workspace.id);
  return (
    <>
      <PageTitle
        title="Status pages"
        sub="Public pages your customers can check before they write to support."
        actions={
          demo ? null : (
            <Link href="/app/status-pages/new" className={buttonClass("primary", "md")}>
              New status page
            </Link>
          )
        }
      />
      {pages.length ? (
        <Panel className="mt-8">
          <ul>
            {pages.map((p) => (
              <li key={p.id} className="relative flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule-2 px-5 py-4 last:border-b-0 hover:bg-well">
                <div className="min-w-0 flex-1">
                  <Link href={`/app/status-pages/${p.id}`} className="block truncate text-[15px] font-medium after:absolute after:inset-0">
                    {p.title}
                  </Link>
                  <p className="mt-0.5 truncate text-[13px] text-muted">
                    {host}/s/{p.slug}
                  </p>
                </div>
                <span className="text-[13.5px] text-ink-2">
                  {p.components} component{p.components === 1 ? "" : "s"}
                </span>
                <span className="text-[13.5px] text-ink-2">Opens in {p.defaultLocale === "ar" ? "Arabic" : "English"}</span>
                <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[12.5px] font-medium", p.published ? "bg-up-soft text-up" : "bg-rule-2 text-muted")}>
                  {p.published ? "Published" : "Draft"}
                </span>
                <a href={`/s/${p.slug}`} target="_blank" rel="noreferrer" className={cn(buttonClass("outline", "sm"), "relative z-10")}>
                  View
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <div className="mt-8">
          <Empty
            title="No status pages yet"
            action={
              <Link href="/app/status-pages/new" className={buttonClass("primary", "md")}>
                Create one
              </Link>
            }
          >
            Pick the monitors to show, name them the way customers know them, and share the link. Incidents appear on it automatically.
          </Empty>
        </div>
      )}
      {demo ? <p className="mt-4 text-[13.5px] text-muted">The demo&apos;s status page is read-only here. Create a free account to make your own.</p> : null}
    </>
  );
}
