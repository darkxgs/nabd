import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { SettingsForm } from "@/components/app/settings-form";
import { PageTitle, Panel } from "@/components/ui";
import { users } from "@/db/schema";
import { isDemoWorkspace } from "@/lib/demo";
import { TIMEZONES } from "@/lib/time";
import { requireWorkspace } from "@/server/auth";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="h-[40vh] animate-pulse rounded-panel bg-rule-2" />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  await connection();
  const { db, workspace, session } = await requireWorkspace();
  const [user] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, session.userId));
  const zones = TIMEZONES.includes(workspace.timezone as (typeof TIMEZONES)[number]) ? [...TIMEZONES] : [workspace.timezone, ...TIMEZONES];
  return (
    <>
      <PageTitle title="Settings" />
      <Panel className="mt-8 p-6">
        <h2 className="text-[17px] font-semibold">Workspace</h2>
        <div className="mt-5">
          <SettingsForm
            name={workspace.name}
            timezone={workspace.timezone}
            zones={zones}
            disabledReason={isDemoWorkspace(workspace.id) ? "The shared demo's settings are read-only. Create a free account for your own workspace." : undefined}
          />
        </div>
      </Panel>
      <Panel className="mt-6 p-6">
        <h2 className="text-[17px] font-semibold">Your account</h2>
        <dl className="mt-4 grid max-w-xl gap-3 text-[14px]">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Name</dt>
            <dd>{user?.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Email</dt>
            <dd>{user?.email}</dd>
          </div>
        </dl>
      </Panel>
    </>
  );
}
