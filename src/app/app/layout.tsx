import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Logo } from "@/components/brand";
import { Nav } from "@/components/app/nav";
import { DEMO } from "@/db/seed";
import { requireWorkspace } from "@/server/auth";
import { kickTick } from "@/server/jobs";
import { openIncidents } from "@/server/queries";
import { logout } from "../(auth)/actions";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  const { conn, workspace } = await requireWorkspace();
  const open = await openIncidents(conn, workspace.id);
  kickTick();
  const isDemo = workspace.id === DEMO.workspaceId;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pt-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/app" aria-label="Nabd home">
              <Logo />
            </Link>
            <span className="hidden h-5 w-px bg-rule sm:block" aria-hidden />
            <span className="hidden truncate text-[14px] text-ink-2 sm:block">{workspace.name}</span>
          </div>
          <form action={logout}>
            <button type="submit" className="text-[13.5px] text-muted hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
        <div className="mx-auto max-w-6xl px-2 sm:px-4">
          <Nav openIncidents={open.length} />
        </div>
      </header>
      {isDemo ? (
        <div className="border-b border-rule bg-card">
          <p className="mx-auto max-w-6xl px-4 py-2 text-[13px] leading-relaxed text-ink-2 sm:px-6">
            Demo workspace. These monitors check real sites every five minutes; the demo target fails at 01:20 and 13:20 UTC. History from before{" "}
            {workspace.sampleBefore ? workspace.sampleBefore.toISOString().slice(0, 10) : "launch"} is sample data, shown faded. Visitors share this workspace, and it resets nightly.
          </p>
        </div>
      ) : null}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-[98px] max-w-6xl items-start px-4 pt-3 sm:px-6">
          <Logo />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="h-8 w-48 animate-pulse rounded bg-rule-2" />
        <div className="mt-8 h-96 animate-pulse rounded-panel bg-rule-2" />
      </main>
    </div>
  );
}
