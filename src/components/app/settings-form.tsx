"use client";

import { useState } from "react";
import { saveSettings, type ActionResult } from "@/app/app/actions";
import { buttonClass, Field, FormError, Notice, Input, Select, Spinner } from "@/components/ui";
import { useFormAction } from "./controls";

export function SettingsForm({ name, timezone, zones, disabledReason }: { name: string; timezone: string; zones: string[]; disabledReason?: string }) {
  const [state, onSubmit, pending] = useFormAction<ActionResult>(saveSettings);
  const [tz, setTz] = useState(timezone);
  const fields = state && !state.ok ? state.fields : undefined;
  const now = new Date();
  const preview = (() => {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    } catch {
      return "";
    }
  })();
  return (
    <form onSubmit={onSubmit} className="grid max-w-xl gap-5">
      <fieldset disabled={!!disabledReason} className="grid min-w-0 gap-5">
        <Field label="Workspace name" error={fields?.name} hint="Shown in alerts and at the top of the dashboard.">
          <Input name="name" defaultValue={name} maxLength={80} aria-invalid={!!fields?.name} />
        </Field>
        <Field label="Time zone" error={fields?.timezone} hint={preview ? `Dates and times on the dashboard and status pages use it. It's ${preview} there now.` : undefined}>
          <Select name="timezone" value={tz} onChange={(e) => setTz(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center gap-3">
          <button type="submit" className={buttonClass("primary", "md")} disabled={pending}>
            {pending ? <Spinner /> : null}
            Save
          </button>
          {state?.ok ? <span className="text-[13.5px] text-up">{state.message}</span> : null}
        </div>
      </fieldset>
      {disabledReason ? <Notice>{disabledReason}</Notice> : <FormError>{state && !state.ok && !fields ? state.error : null}</FormError>}
    </form>
  );
}
