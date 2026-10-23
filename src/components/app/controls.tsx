"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { buttonClass, cn, Spinner } from "@/components/ui";

/** A row of radio buttons that reads as one control: "5 min | 10 | 15". */
export function Segmented<T extends string | number>({
  name,
  value,
  onChange,
  options,
  className,
  disabled,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex justify-self-start rounded-control border border-rule bg-well p-0.5", disabled && "opacity-60", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label
            key={String(o.value)}
            className={cn(
              "relative flex h-8 min-w-11 cursor-pointer items-center justify-center rounded-[4px] px-3 text-[13.5px] transition-[background-color,color,box-shadow] duration-150 has-focus-visible:outline-2 has-focus-visible:outline-ink",
              on ? "bg-card font-medium text-ink shadow-[0_0_0_1px_var(--color-rule),0_1px_2px_rgb(20_24_30/0.06)]" : "text-muted hover:text-ink",
              disabled && "cursor-default",
            )}
          >
            <input type="radio" name={name} value={String(o.value)} checked={on} onChange={() => onChange(o.value)} disabled={disabled} className="sr-only" />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

/** On/off switch. The thumb travels on a slight overshoot, like a physical toggle settling. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-45",
        checked ? "bg-up" : "bg-idle",
      )}
    >
      <span
        className="absolute start-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgb(20_24_30/0.25)] transition-transform duration-[260ms] ease-[cubic-bezier(0.3,1.4,0.6,1)]"
        style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

/**
 * Destructive actions ask twice without a browser dialog: the first press arms
 * the button for a few seconds, the second one acts.
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel,
  size = "sm",
  className,
  disabled,
}: {
  onConfirm: () => Promise<unknown> | void;
  children: ReactNode;
  confirmLabel: string;
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 4000);
          return;
        }
        window.clearTimeout(timer.current);
        start(async () => {
          await onConfirm();
          setArmed(false);
        });
      }}
      className={cn(buttonClass(armed ? "primary" : "danger", size), armed && "bg-down hover:bg-down", className)}
    >
      {pending ? <Spinner /> : null}
      {armed ? confirmLabel : children}
    </button>
  );
}

/** Runs a server action from a button and shows its answer next to it for a few seconds. */
export function useRunner() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; summary?: string } | void>) =>
    start(async () => {
      const r = await fn();
      window.clearTimeout(timer.current);
      if (r && (r.error || r.message || r.summary)) {
        setNote({ ok: r.ok, text: r.error ?? r.summary ?? r.message ?? "" });
        timer.current = window.setTimeout(() => setNote(null), 6000);
      } else setNote(null);
    });
  return { pending, note, run };
}

export function Note({ note, className }: { note: { ok: boolean; text: string } | null; className?: string }) {
  if (!note) return null;
  return (
    <span role="status" className={cn("text-[13px] leading-snug", note.ok ? "text-up" : "text-down", className)}>
      {note.text}
    </span>
  );
}

/**
 * Submits a form to a server action without React's automatic form reset, so a
 * validation error never wipes what someone typed. Returns the last result.
 */
export function useFormAction<S>(fn: (prev: S | null, form: FormData) => Promise<S>, onDone?: (result: S, form: HTMLFormElement) => void) {
  const [state, setState] = useState<S | null>(null);
  const [pending, start] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const data = new FormData(el);
    start(async () => {
      const r = await fn(state, data);
      setState(r);
      onDone?.(r, el);
    });
  };
  return [state, onSubmit, pending] as const;
}
