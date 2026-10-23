import type { Metadata } from "next";
import Link from "next/link";
import { MonitorForm } from "@/components/app/monitor-form";
import { PageTitle } from "@/components/ui";
import { MONITOR_DEFAULTS } from "@/lib/monitor-input";

export const metadata: Metadata = { title: "Add a monitor" };

export default function NewMonitorPage() {
  return (
    <>
      <Link href="/app" className="text-[13.5px] text-muted hover:text-ink">
        Monitors
      </Link>
      <div className="mt-2">
        <PageTitle title="Add a monitor" sub="The first check runs as soon as you save." />
      </div>
      <div className="mt-8">
        <MonitorForm initial={MONITOR_DEFAULTS} />
      </div>
    </>
  );
}
