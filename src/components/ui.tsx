import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ComponentProps, ReactNode } from "react";
import type { MonitorState } from "@/db/schema";

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition-[background-color,color,border-color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 select-none";
const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2",
  outline: "border border-rule bg-card text-ink hover:border-ink-2/50",
  ghost: "text-ink-2 hover:bg-rule-2 hover:text-ink",
  danger: "border border-down/30 bg-card text-down hover:bg-down-soft",
};
const sizes: Record<ButtonSize, string> = {
  sm: "h-8 rounded-control px-3 text-[13px]",
  md: "h-10 rounded-control px-4 text-[14px]",
  lg: "h-12 rounded-control px-5 text-[15px]",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) {
  return cn(base, variants[variant], sizes[size], extra);
}

export function Button({ variant = "primary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

const field =
  "w-full rounded-control border border-rule bg-card px-3 text-[14.5px] text-ink placeholder:text-faint transition-colors focus:border-ink focus:outline-none aria-[invalid=true]:border-down";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-24 py-2.5 leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(field, "h-10 pe-8", className)} {...props} />;
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? <span className="text-[12.5px] text-down">{error}</span> : hint ? <span className="text-[12.5px] leading-snug text-muted">{hint}</span> : null}
    </label>
  );
}

export const STATE: Record<MonitorState | "paused", { label: string; labelAr: string; dot: string; text: string; soft: string }> = {
  up: { label: "Up", labelAr: "يعمل", dot: "bg-up", text: "text-up", soft: "bg-up-soft" },
  degraded: { label: "Slow", labelAr: "بطيء", dot: "bg-slow", text: "text-slow", soft: "bg-slow-soft" },
  down: { label: "Down", labelAr: "متوقف", dot: "bg-down", text: "text-down", soft: "bg-down-soft" },
  pending: { label: "Waiting for first check", labelAr: "بانتظار أول فحص", dot: "bg-idle", text: "text-muted", soft: "bg-rule-2" },
  paused: { label: "Paused", labelAr: "متوقف مؤقتًا", dot: "bg-idle", text: "text-muted", soft: "bg-rule-2" },
};

export function StateDot({ state, className, live }: { state: keyof typeof STATE; className?: string; live?: boolean }) {
  return (
    <span className={cn("relative inline-flex size-2.5 shrink-0 rounded-full", STATE[state].dot, className)} aria-hidden>
      {live && state === "down" ? <span className="absolute inset-0 animate-beat rounded-full bg-down" /> : null}
    </span>
  );
}

export function StatePill({ state, ar }: { state: keyof typeof STATE; ar?: boolean }) {
  const s = STATE[state];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium", s.soft, s.text)}>
      <StateDot state={state} />
      {ar ? s.labelAr : s.label}
    </span>
  );
}

export function PageTitle({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.015em] sm:text-[28px]">{title}</h1>
        {sub ? <div className="mt-1 text-[14.5px] text-muted">{sub}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-panel border border-rule bg-card", className)} {...props} />;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-panel border border-dashed border-rule px-6 py-12 text-center">
      <p className="text-[16px] font-medium">{title}</p>
      {children ? <div className="mx-auto mt-1.5 max-w-md text-[14px] leading-relaxed text-muted">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 animate-spin", className)} aria-hidden>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-control bg-down-soft px-3 py-2.5 text-[14px] text-down">
      {children}
    </p>
  );
}
