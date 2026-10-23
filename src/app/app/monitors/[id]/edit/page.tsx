import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DeleteMonitor } from "@/components/app/monitor-actions";
import { MonitorForm } from "@/components/app/monitor-form";
import { PageTitle, Panel } from "@/components/ui";
import { isDemoWorkspace, isSeededMonitor } from "@/lib/demo";
import { requireWorkspace } from "@/server/auth";
import { getMonitor } from "@/server/queries";

export const metadata: Metadata = { title: "Edit monitor" };

export default function EditMonitorPage(props: PageProps<"/app/monitors/[id]/edit">) {
  return (
    <Suspense fallback={<div className="h-[70vh] animate-pulse rounded-panel bg-rule-2" />}>
      <Edit {...props} />
    </Suspense>
  );
}

async function Edit({ params }: PageProps<"/app/monitors/[id]/edit">) {
  await connection();
  const { id } = await params;
  const { conn, workspace } = await requireWorkspace();
  const m = await getMonitor(conn, workspace.id, id);
  if (!m) notFound();
  const locked = isDemoWorkspace(workspace.id) && isSeededMonitor(m.id);
  return (
    <>
      <Link href={`/app/monitors/${m.id}`} className="text-[13.5px] text-muted hover:text-ink">
        {m.name}
      </Link>
      <div className="mt-2">
        <PageTitle title="Edit monitor" />
      </div>
      <div className="mt-8">
        <MonitorForm
          id={m.id}
          locked={locked ? "This monitor is part of the shared demo, so its settings are read-only. Add a monitor of your own to try editing." : undefined}
          initial={{
            name: m.name,
            url: m.url,
            intervalSec: m.intervalSec,
            method: m.method,
            expectedStatus: m.expectedStatus,
            keyword: m.keyword ?? "",
            keywordMode: m.keywordMode,
            timeoutSec: Math.round(m.timeoutMs / 1000),
            slowMs: m.slowMs,
            confirmAfter: m.confirmAfter,
          }}
        />
      </div>
      {!locked ? (
        <Panel className="mt-12 flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="text-[15px] font-semibold">Delete this monitor</h2>
            <p className="mt-0.5 text-[13.5px] text-muted">Its check history and incidents are deleted too, and it leaves every status page.</p>
          </div>
          <DeleteMonitor id={m.id} />
        </Panel>
      ) : null}
    </>
  );
}
