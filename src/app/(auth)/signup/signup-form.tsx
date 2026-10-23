"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Field, Input, Spinner } from "@/components/ui";
import { signup } from "../actions";

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, null);
  const tz = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (tz.current) tz.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }, []);
  const f = state?.fields ?? {};
  const v = state?.values ?? {};
  return (
    <form action={action} className="mt-8 grid gap-4">
      <input ref={tz} type="hidden" name="timezone" defaultValue="UTC" />
      <Field label="Your name" error={f.name}>
        <Input name="name" autoComplete="name" defaultValue={v.name} aria-invalid={!!f.name} required />
      </Field>
      <Field label="Work email" error={f.email} hint="Outage alerts go here until you add Slack, Discord or a webhook.">
        <Input name="email" type="email" autoComplete="email" defaultValue={v.email} aria-invalid={!!f.email} required />
      </Field>
      <Field label="Password" error={f.password} hint="At least 8 characters.">
        <Input name="password" type="password" autoComplete="new-password" aria-invalid={!!f.password} required />
      </Field>
      <Field label="Workspace name" error={f.workspaceName} hint="Usually your company or agency.">
        <Input name="workspaceName" defaultValue={v.workspaceName} aria-invalid={!!f.workspaceName} required />
      </Field>
      <Button type="submit" size="lg" className="mt-2" disabled={pending}>
        {pending ? <Spinner /> : null}
        Create workspace
      </Button>
    </form>
  );
}
