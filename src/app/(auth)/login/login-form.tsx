"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, FormError, Input, Spinner } from "@/components/ui";
import { demoLogin, login } from "../actions";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action, pending] = useActionState(login, null);
  return (
    <div className="mt-8">
      <form action={demoLogin}>
        <input type="hidden" name="next" value={next} />
        <DemoButton />
      </form>
      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        Opens a workspace that watches Seif Ashraf&apos;s live projects, plus a test page that fails twice a day. Other visitors share it.
      </p>

      <div className="my-8 flex items-center gap-3 text-[13px] text-faint">
        <span className="h-px flex-1 bg-rule" />
        or with your account
        <span className="h-px flex-1 bg-rule" />
      </div>

      <form action={action} className="grid gap-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" defaultValue={state?.values?.email} required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormError>{state?.error}</FormError>
        <Button type="submit" variant="outline" size="lg" disabled={pending}>
          {pending ? <Spinner /> : null}
          Sign in
        </Button>
      </form>
    </div>
  );
}

function DemoButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? <Spinner /> : null}
      Open the demo workspace
    </Button>
  );
}
