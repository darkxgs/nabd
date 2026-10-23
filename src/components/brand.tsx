import { cn } from "./ui";

/** Three ticks of different heights: one beat of the strip the whole product is built around. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" className={cn("size-[18px]", className)} aria-hidden>
      <rect x="2" y="7" width="3" height="9" rx="1" fill="currentColor" opacity="0.45" />
      <rect x="7.5" y="2" width="3" height="14" rx="1" fill="currentColor" />
      <rect x="13" y="10" width="3" height="6" rx="1" fill="#d6391f" />
    </svg>
  );
}

export function Logo({ className, inverse }: { className?: string; inverse?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", inverse ? "text-white" : "text-ink", className)}>
      <Mark />
      <span className="text-[18px] leading-none font-semibold tracking-[-0.02em]">nabd</span>
    </span>
  );
}
