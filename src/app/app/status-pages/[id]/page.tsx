import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { StatusPageForm } from "@/components/app/status-page-form";
import { PageTitle } from "@/components/ui";
import { appUrl } from "@/lib/app-url";
import { isDemoWorkspace } from "@/lib/demo";
import { requireWorkspace } from "@/server/auth";
import { listMonitors, statusPageForEdit } from "@/server/queries";

export const metadata: Metadata = { title: "Status page" };

export default function EditStatusPage(props: PageProps<"/app/status-pages/[id]">) {
  return (
    <Suspense fallback={<div className="h-[60vh] animate-pulse rounded-panel bg-rule-2" />}>
      <Edit {...props} />
    </Suspense>
  );
}

async function Edit({ params, searchParams }: PageProps<"/app/status-pages/[id]">) {
  await connection();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { conn, workspace } = await requireWorkspace();
  const [data, monitors] = await Promise.all([statusPageForEdit(conn, workspace.id, id), listMonitors(conn, workspace.id)]);
  if (!data) notFound();
  const { page, links } = data;
  return (
    <>
      <Link href="/app/status-pages" className="text-[13.5px] text-muted hover:text-ink">
        Status pages
      </Link>
      <div className="mt-2">
        <PageTitle title={page.title} sub={sp.created ? "Created. Share the link below, or keep it as a draft until it's ready." : undefined} />
      </div>
      <div className="mt-8">
        <StatusPageForm
          page={{ id: page.id, title: page.title, titleAr: page.titleAr, slug: page.slug, intro: page.intro, introAr: page.introAr, defaultLocale: page.defaultLocale, published: page.published }}
          monitors={monitors.map((m) => ({ id: m.id, name: m.name, url: m.url }))}
          links={links.map((l) => ({ monitorId: l.monitorId, label: l.label ?? "", labelAr: l.labelAr ?? "" }))}
          origin={appUrl()}
          locked={isDemoWorkspace(workspace.id) ? "This status page belongs to the shared demo, so it's read-only here. Create a free account to make your own." : undefined}
        />
      </div>
    </>
  );
}
