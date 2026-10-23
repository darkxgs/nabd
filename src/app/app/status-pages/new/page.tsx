import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { StatusPageForm } from "@/components/app/status-page-form";
import { PageTitle } from "@/components/ui";
import { appUrl } from "@/lib/app-url";
import { isDemoWorkspace } from "@/lib/demo";
import { requireWorkspace } from "@/server/auth";
import { listMonitors } from "@/server/queries";

export const metadata: Metadata = { title: "New status page" };

export default function NewStatusPage() {
  return (
    <Suspense fallback={<div className="h-[60vh] animate-pulse rounded-panel bg-rule-2" />}>
      <New />
    </Suspense>
  );
}

async function New() {
  await connection();
  const { conn, workspace } = await requireWorkspace();
  const monitors = await listMonitors(conn, workspace.id);
  return (
    <>
      <Link href="/app/status-pages" className="text-[13.5px] text-muted hover:text-ink">
        Status pages
      </Link>
      <div className="mt-2">
        <PageTitle title="New status page" />
      </div>
      <div className="mt-8">
        <StatusPageForm
          page={null}
          monitors={monitors.map((m) => ({ id: m.id, name: m.name, url: m.url }))}
          links={[]}
          origin={appUrl()}
          locked={isDemoWorkspace(workspace.id) ? "Creating status pages is turned off in the shared demo. Create a free account to make your own." : undefined}
        />
      </div>
    </>
  );
}
