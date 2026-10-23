"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

export const NAV = [
  { href: "/app", label: "Monitors" },
  { href: "/app/incidents", label: "Incidents" },
  { href: "/app/status-pages", label: "Status pages" },
  { href: "/app/alerts", label: "Alerts" },
  { href: "/app/settings", label: "Settings" },
] as const;

export function Nav({ openIncidents }: { openIncidents: number }) {
  const path = usePathname();
  return (
    <nav aria-label="App" className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
      {NAV.map(({ href, label }) => {
        const active = href === "/app" ? path === "/app" || path.startsWith("/app/monitors") : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-[14px] transition-colors",
              active ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {label}
            {href === "/app/incidents" && openIncidents > 0 ? (
              <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-down px-1 text-[11px] font-semibold text-white tnum">{openIncidents}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
