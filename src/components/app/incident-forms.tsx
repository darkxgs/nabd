"use client";

import { useState } from "react";
import { acknowledge, createIncident, postUpdate, type ActionResult } from "@/app/app/actions";
import { buttonClass, Field, FormError, Notice, Input, Spinner, Textarea } from "@/components/ui";
import { Segmented, useFormAction, useRunner } from "./controls";

type State = "investigating" | "identified" | "monitoring" | "resolved";

const STATE_OPTIONS: { value: State; label: string }[] = [
  { value: "investigating", label: "Investigating" },
  { value: "identified", label: "Identified" },
  { value: "monitoring", label: "Monitoring" },
  { value: "resolved", label: "Resolved" },
];

const HINTS: Record<State, string> = {
  investigating: "You know something is wrong and you're looking into it.",
  identified: "You know the cause and you're working on a fix.",
  monitoring: "A fix is out and you're watching to make sure it holds.",
  resolved: "It's over. This closes the incident.",
};

export function AcknowledgeButton({ id }: { id: string }) {
  const { pending, run } = useRunner();
  return (
    <button type="button" className={buttonClass("primary", "sm")} disabled={pending} onClick={() => run(() => acknowledge(id))}>
      {pending ? <Spinner /> : null}
      Acknowledge
    </button>
  );
}

/** Posts an update to the incident's timeline (and the public status page). */
export function UpdateComposer({ incidentId, current, resolved, disabledReason }: { incidentId: string; current: State; resolved: boolean; disabledReason?: string }) {
  const [state, onSubmit, pending] = useFormAction<ActionResult>(postUpdate, (r, el) => {
    if (r.ok) el.reset();
  });
  const [next, setNext] = useState<State>(resolved ? "resolved" : current === "investigating" ? "identified" : current);
  const [arabic, setArabic] = useState(false);
  const fields = state && !state.ok ? state.fields : undefined;
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <input type="hidden" name="incidentId" value={incidentId} />
      <fieldset disabled={!!disabledReason} className="grid min-w-0 gap-4">
        {resolved ? (
          <input type="hidden" name="state" value="resolved" />
        ) : (
          <div className="grid gap-1.5">
            <Segmented name="state" value={next} onChange={setNext} options={STATE_OPTIONS} className="flex-wrap self-start" disabled={!!disabledReason} />
            <span className="text-[12.5px] text-muted">{HINTS[next]}</span>
          </div>
        )}
        <Field label={resolved ? "Add a note, like what caused it and what changed" : "Update"} error={fields?.body}>
          <Textarea name="body" required maxLength={2000} placeholder={resolved ? "The payment provider rotated an API key; we now alert on 401s from them." : "We've found the cause and are rolling out a fix."} aria-invalid={!!fields?.body} />
        </Field>
        {arabic ? (
          <Field label="بالعربية (اختياري)" error={fields?.bodyAr} hint="Shown when someone reads the status page in Arabic.">
            <Textarea name="bodyAr" dir="rtl" lang="ar" maxLength={2000} className="font-arabic" />
          </Field>
        ) : (
          <button type="button" onClick={() => setArabic(true)} className="justify-self-start text-[13.5px] text-ink-2 underline underline-offset-4 hover:text-ink">
            Add an Arabic version
          </button>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClass("primary", "md")} disabled={pending}>
            {pending ? <Spinner /> : null}
            {!resolved && next === "resolved" ? "Post and resolve" : "Post update"}
          </button>
          {state?.ok ? <span className="text-[13.5px] text-up">{state.message}</span> : null}
        </div>
      </fieldset>
      {disabledReason ? <Notice>{disabledReason}</Notice> : <FormError>{state && !state.ok && !fields ? state.error : null}</FormError>}
    </form>
  );
}

export function NewIncidentForm() {
  const [state, onSubmit, pending] = useFormAction<ActionResult>(createIncident);
  const [st, setSt] = useState<Exclude<State, "resolved">>("investigating");
  const fields = state && !state.ok ? state.fields : undefined;
  return (
    <form onSubmit={onSubmit} className="grid max-w-2xl gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Title" error={fields?.title} hint="What customers will read, like “Card payments failing”.">
          <Input name="title" required maxLength={120} aria-invalid={!!fields?.title} />
        </Field>
        <Field label="العنوان بالعربية (اختياري)" error={fields?.titleAr}>
          <Input name="titleAr" dir="rtl" lang="ar" maxLength={120} className="font-arabic" />
        </Field>
      </div>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Status</span>
        <Segmented name="state" value={st} onChange={setSt} options={STATE_OPTIONS.filter((o) => o.value !== "resolved") as { value: Exclude<State, "resolved">; label: string }[]} className="flex-wrap self-start" />
        <span className="text-[12.5px] text-muted">{HINTS[st]}</span>
      </div>
      <Field label="First update" error={fields?.body}>
        <Textarea name="body" required maxLength={2000} placeholder="Some card payments are failing at checkout. We're working with the payment provider." aria-invalid={!!fields?.body} />
      </Field>
      <Field label="بالعربية (اختياري)" error={fields?.bodyAr}>
        <Textarea name="bodyAr" dir="rtl" lang="ar" maxLength={2000} className="font-arabic" />
      </Field>
      <p className="text-[13.5px] leading-relaxed text-muted">It shows at the top of every published status page in this workspace until you resolve it.</p>
      <div className="flex items-center gap-3">
        <button type="submit" className={buttonClass("primary", "md")} disabled={pending}>
          {pending ? <Spinner /> : null}
          Post incident
        </button>
      </div>
      <FormError>{state && !state.ok && !fields ? state.error : null}</FormError>
    </form>
  );
}
